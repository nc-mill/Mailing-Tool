# P12 Editor šablon: implementační plán

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Implementační plán P12 (editor šablon) z 31. 7. 2026, sepsaný před
> začátkem stavby. Zachycuje, co se tehdy plánovalo, ne dnešní podobu kódu.
> **Postaveno:** editor je v `apps/web/src/features/editor`, **od 4. 8. 2026 se ale přestavuje**, viz `docs/superpowers/plans/2026-08-04-editor-wysiwyg.md`.
> **Zaškrtávátka nikdo neodškrtával**, prázdné políčko tady tedy neznamená nedodělek.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

> **Pro agentní pracovníky:** POVINNÁ PODŘÍZENÁ DOVEDNOST: použij `superpowers:subagent-driven-development` (doporučeno) nebo `superpowers:executing-plans` a proveď plán úkol po úkolu. Kroky mají zaškrtávací syntaxi (`- [ ]`) kvůli sledování postupu.

**Cíl:** Dodat vlastní tenký editor e-mailových šablon nad blokovým dokumentem z P08: svislý seznam sekcí s přidáváním bloků mezi ně, přesouvání myší i klávesnicí, panel vlastností generovaný z descriptorů, bohatý text s pevným panelem a vkládáním personalizace, náhled pro počítač, mobil, tmavý režim, textovou verzi a zdroj, testovací odeslání a namespace i18n `editor`.

**Architektura:** Dokument je neměnná datová struktura. Všechny operace nad ním (vložení, přesun, duplikace, smazání, změna vlastnosti, podmínka zobrazení) jsou **čisté funkce bez Reactu** v `apps/web/src/features/editor/model`, takže se dají testovat bez prohlížeče. Nad nimi stojí drobný store postavený na `useSyncExternalStore` s historií pro vrácení akce. Panel vlastností se **negeneruje z kódu, ale z dat**: každý typ bloku má descriptor se skupinami vlastností a jeden ovládací prvek na druh vlastnosti. Přidání bloku je tak jeden datový soubor plus jedna vykreslovací funkce. Přetahování je tenká vrstva nad `@dnd-kit`, kterou jde vypnout jedním přepínačem; klávesová cesta je **vlastní a na knihovně nezávislá**, protože WCAG 2.2 kritérium 2.5.7 je závazné a `@dnd-kit` ho samo o sobě nesplní. Editor nemá vlastní renderer: náhled si nechá vyrobit HTML na serveru přes `POST /api/v1/templates/{id}/preview` (P08) a zobrazí ho v komponentě K6 z `@mlain/ui` (P05).

**Technologie:** TypeScript, React 19 v Next.js 16 App Router, Tailwind CSS 4, shadcn/ui z `@mlain/ui`, `next-intl` s ICU, Tiptap 3 pro bohatý text, `@dnd-kit` pro přetahování, Vitest 4 s jsdom a Testing Library, Playwright 1.62 s `@axe-core/playwright`.

---

## 0. Než začneš: povinná četba a hranice

### 0.1 Co si přečti

| Dokument | Kapitoly |
|---|---|
| `docs/superpowers/plans/2026-07-31-rozdeleni-implementacnich-planu.md` | celý, hlavně 1.1, 2 (S3, S4, S11), 5 (P12), 7 |
| `docs/superpowers/specs/parts/03-obsah.md` | 3.1 (celá, hlavně 3.1.2 až 3.1.10), 3.2, **3.3 celá**, 3.7.2, 3.7.3, 3.7.5, 3.8.1, 3.8.2, 3.11, 4.2, 5.1 až 5.5, 8 |
| `docs/superpowers/specs/parts/06-ui-ux.md` | 4.4, 4.5, 5.4, 7.1, 7.2, **8.5.1, 8.5.2**, 9.2, 9.3, 11.3, 12, 13.1, 14, 15 |
| `docs/superpowers/plans/2026-07-31-p05-design-system-i18n-skorapka.md` | celý (konvence, mapa souborů, K6) |
| `docs/superpowers/plans/2026-07-31-p08-sablony-model-renderer.md` | celý, jakmile existuje. Blokový model, JSON Schema, endpointy šablon |

### 0.2 Jediné řídicí pravidlo

> **Každý soubor v repozitáři má právě jeden plán, který ho smí vytvořit a měnit. Ostatní plány ho jen čtou.**

Tenhle plán **nevlastní blokový model** (P08), **nevlastní komponenty** (P05), **nevlastní kontrakt Liquidu** (P02) a **nevlastní AI asistenta** (P15). Když se během práce ukáže, že něco z toho chybí nebo je jinak, **nedopisuje se to tady**: zapíše se to do kapitoly 9 jako požadavek na cizí plán a editor se obejde přes vrstvu portů z úkolu 12.

Úplný seznam vlastněných souborů je v kapitole 8. Mimo ně plán nesahá. Jediná výjimka je popsaná v 0.4.

### 0.3 Předpoklady, které musí platit, než tenhle plán začne

P12 běží ve vlně 2, tedy po smergování P05 a P08 do `main`. Ověř tyhle věci **před prvním úkolem**. Když některá chybí, doplň ji do jejího plánu a P12 spusť potom; neopravuj to za běhu.

| # | Co musí existovat | Kde | Vlastní |
|---|---|---|---|
| E1 | `packages/ui` s primitivy (`button`, `input`, `select`, `dialog`, `tabs`, `tooltip`, `popover`, `dropdown-menu`, `command`, `switch`, `label`, `skeleton`, `badge`) a pomůckou `cn` | `@mlain/ui/components/*`, `@mlain/ui/lib/cn` | P05 |
| E2 | Komponenta **K6 náhled e-mailu** `EmailPreview({ html, title, width?, dark?, labels?, className? })`, uvnitř `<iframe sandbox="" srcdoc referrerPolicy="no-referrer">` a s CSP v `srcdoc` | `@mlain/ui/patterns/email-preview` | P05 |
| E3 | Oblast `aria-live` aplikace s hookem `useAnnouncer(): { polite(msg): void; assertive(msg): void }` | `@mlain/ui/a11y` | P05 |
| E4 | Stavy obrazovek S4, S9, S11, S12, S13, S15 a `Alert` jako komponenty, exportované z **adresářového** barrelu | `@mlain/ui/patterns/states` | P05 |
| E5 | Toast s vrácením akce | `@mlain/ui/patterns/toast` | P05 |
| E6 | `packages/i18n` s načítáním namespace ze souborů `messages/{locale}/<namespace>.json` a CI jobem `i18n-check` | `@mlain/i18n` | P05 |
| E7 | Skořápka `apps/web/src/app/[locale]/w/[workspaceSlug]/layout.tsx` a registr navigace s položkou Šablony | `apps/web` | P05 |
| E8 | Typy blokového dokumentu, `document.v1.schema.json` a převody cest `toMergePath`, `toCatalogPath`, `toLiquidRoots` | `@mlain/emails/document/types`, `@mlain/emails/paths` | P08 |
| E9 | Endpointy `GET/PATCH /api/v1/templates/{id}`, `POST .../preview`, `POST .../validate` | `apps/web/src/server/routes/templates.router.ts` | P08 |
| E10 | Katalog polí `getFieldCatalog(ctx: WorkspaceContext): Promise<FieldCatalog>` z **veřejné plochy domény**, ne z hluboké podcesty | `@mlain/core/contacts` | P07 |
| E11 | Validátor `validateLiquid(source, ctx)` s `ctx.level` a typ `LiquidIssue`, spustitelné i v prohlížeči | `@mlain/contracts/liquid` | P02 |
| E12 | Čtení identity v serverové komponentě: `requireUser(nextPath)`, `getWorkspaceAccess(slug)`, `hasPermission`, `apiFetch` | `@/lib/identity/*`, `@/lib/api-client/fetch` | P06 |
| E13 | Konfigurace testovacího běhu `apps/web`: `environment: 'jsdom'`, `plugins: [react()]`, `include` se vzorem `src/**/*.test.{ts,tsx}` a `setupFiles`, který registruje `cleanup()` v `afterEach` | `apps/web/vitest.config.ts`, `apps/web/vitest.setup.ts` | **P01** |

**E2, E3, E8, E10, E11 a E13 ověř spuštěním, ne čtením.** Jednořádkový import v `node -e` nebo v prázdném testu stačí; předpoklad ověřený grepem je přesně ta chyba, před kterou varuje kapitola 7 řídicího dokumentu.

**E13 je nejtišší z nich.** Kdyby konfigurace zůstala v původní podobě `{ environment: 'node', include: ['test/**/*.test.ts'] }`, žádný test tohohle plánu by do vzoru nespadl, `vitest run` by skončil **zeleně a s návratovým kódem nula** a každý krok „spusť test, musí spadnout" by místo červeného testu vypsal, že žádné testy nejsou. To vypadá jako úspěch a je to horší než selhání. Proto ho úkol 1 neověřuje očima, ale testem, který si plán píše sám (`apps/web/test/p12/test-runner.test.ts`) a který leží uvnitř **starého** vzoru `test/**`, takže se spustí i tehdy, když se nespustí nic jiného.

**Co se změnilo proti dřívějšímu znění a proč** (aby to nikdo nevrátil zpátky):

- `sandbox="allow-same-origin"` je **stažené bez náhrady**. Vrátilo by rámci původ aplikace a oslabilo izolaci bez zisku, protože skripty v něm stejně neběží. Odchozí požadavky blokuje CSP uvnitř `srcdoc`, ne atribut `sandbox`.
- `useAnnounce()` se jmenuje `useAnnouncer()` a vrací objekt: kritérium 54 potřebuje zdvořilé oznámení, chyba potřebuje důrazné, a jeden řetězcový parametr to nerozliší.
- Funkce `validateDocument` v kontraktech **není a nebude**. Druhou úroveň gramatiky dělá týž `validateLiquid` s `level: "compiled"`. Klientskou validaci dokumentu si skládá tenhle plán v úkolu 24.
- Katalog polí se importuje z `@mlain/core/contacts`. Hluboká podcesta `@mlain/core/contacts/fields` se přes zástupný znak v mapě `exports` rozřeší na `src/contacts/fields/index.ts`, což není soubor katalogu.

### 0.4 Jediná výjimka z vlastnictví souborů

`apps/web/package.json` vlastní P01. P12 do něj přidá **jen řádky se závislostmi** z kapitoly 2 příkazem `pnpm --filter @mlain/web add …` a nic jiného. Žádné skripty, žádnou změnu `exports`, žádnou změnu konfigurace. Když se plán provádí ve worktree paralelně s jiným plánem, který dělá totéž, řeší se konflikt v `package.json` a `pnpm-lock.yaml` opakováním instalace, ne ručním slučováním.

### 0.5 Git

Commit kroky provádí **hlavní agent**. Subagent, který úkol provádí, píše soubory a spouští testy, gitu se nedotýká. Plán se provádí ve vlastním worktree založeném z `HEAD`, na vlastní větvi.

---

## 1. Rozhodnutí, která tenhle plán udělal sám

Sedmnáct míst, kde se zdroje rozcházely nebo mlčely. Kdo plán provádí, se jimi řídí a nevymýšlí je znovu.

| # | Věc | Rozhodnutí | Důvod |
|---|---|---|---|
| R1 | Kdo vlastní descriptory bloků | **P12.** `packages/emails` zůstává netknutý. | Descriptor je popis panelu vlastností, tedy věc editoru. Model, JSON Schema a renderer jsou P08. Proti rozjetí obou stran stojí test z úkolu 9, který každý descriptor validuje proti `document.v1.schema.json`. |
| R2 | Klávesa pro přesun bloku | **`Alt + ↑/↓`**, `Ctrl + ↑/↓` je alias. | Část 6, 8.5.1 uvádí `Alt`, část 3, 5.5 uvádí `Ctrl`. Interakci vlastní část 6, takže `Alt` je hlavní. Alias smiřuje obě znění a stojí dva řádky v mapě kláves. |
| R3 | Jak se blok dostane do sloupce a ven | **`Alt + →`** vloží blok do sousedního sloupce nebo kontejneru, **`Alt + ←`** ho vysune o úroveň výš, za rodiče. | Část 6, 8.5.1, bod 2 to výslovně vyžaduje navrhnout. Vodorovné šipky jsou jediná bezkolizní volba a drží symetrii s pohybem po stromu. |
| R4 | Model fokusu na plátně | Plátno je **strom s roving tabindex** (`role="tree"`, položky `role="treeitem"` s `aria-level`, `aria-posinset`, `aria-setsize`). Jeden `Tab` dovnitř, jeden `Tab` ven. | Dokument má až 300 bloků, takže 300 tabstopů je nepoužitelné. Část 6, 11.3 vyžaduje, aby se dalo dostat dovnitř **i ven**. Šipky uvnitř stromu jsou standardní vzor, který čtečky znají. |
| R5 | Klávesnice versus `@dnd-kit` | Registruje se **jen `PointerSensor`**. `KeyboardSensor` se nepoužije. | Část 6, 8.5.1: klávesová cesta se navrhuje od nuly a nedědí se po knihovně. Simulované tažení z klávesnice navíc neumí přesun mezi úrovněmi z R3. |
| R6 | Kde se zadává náhradní hodnota a formát data | V **inspektoru žetonu personalizace**, ne v panelu vlastností bloku. | Model je drží na uzlu `var` (3.1.5), ne na bloku. Panel bloku by musel adresovat n-tý žeton v textu, což je horší rozhraní i horší kód. Rozhodnutí z 3.3.5 tím zůstává splněné: hodnota je strukturovaný atribut, ne text v šabloně. |
| R7 | Editace bohatého textu | Bohatý text se edituje **v panelu vlastností**, plátno je vybíratelný náhled bez `contenteditable`. Enter nebo dvojklik na bloku přenese fokus do textového pole v panelu. | Ušetří koordinaci fokusu mezi stromem plátna a Tiptapem, což je jinak největší zdroj chyb přístupnosti. Odpovídá nákresu v části 6, 8.5.1, kde je text vlastností v pravém panelu. Vratné rozhodnutí: přesun editace na plátno je pozdější změna jedné komponenty. |
| R8 | Věrnost plátna | Plátno kreslí **přiblížení**, závazný vzhled je náhled. | Skutečné e-mailové HTML se vyrábí na serveru (P08) a vyžádat si ho po každém úhozu není možné. Náhled jede stejným kódem jako odeslání (3.11.1), takže věrnost je zaručená tam, kde na ní záleží. |
| R9 | Namespace a klíče i18n | Namespace **`editor`**. Klíče, které část 3, 5.4 píše jako `templates.editor.*`, jsou v katalogu jako `editor.*`. | Uzávěr S4 řídicího dokumentu dělí katalogy po doménách a `templates` není namespace žádného plánu. Znění textů se nemění, mění se jen prefix. |
| R10 | Český název pro merge tag | **„Personalizace".** V UI se nikdy neobjeví „doplňovaný údaj", „slučovací značka" ani „merge tag" česky. | Rozhodnutí zadavatele kvůli návaznosti na slovník, který uživatelé znají z Ecomailu. Část 3, 5.4 už ho v klíči `liquid.tokenTooltip` používá. **Je to v rozporu se slovníkem části 6, 9.2**, viz požadavek P05-R2 v kapitole 9. Hlídá to test z úkolu 27. |
| R11 | Stav editoru | Vlastní store nad `useSyncExternalStore`, **žádná nová knihovna**. | Operace nad dokumentem jsou čisté funkce, které se testují bez DOM. Redux ani zustand by nepřidaly nic, co plán potřebuje, a přidaly by závislost do sdíleného balíku. |
| R12 | Načítání editoru | `next/dynamic` s `ssr: false`. | Kritérium 82 části 6 zakazuje editor, grafy a query builder v základním balíku. |
| R13 | Odkud editor bere data | **Čtení přes serverovou komponentu** (šablona a katalog polí), **zápis přes REST** (`PATCH`, `preview`, `validate`, `test-send`). Vše přes vrstvu portů. Identitu serverová komponenta získává hotovými pomůckami P06 (`requireUser`, `getWorkspaceAccess`) a kontext projektu jedinou legitimní továrnou `createWorkspaceContext` z P04. | Katalog polí se podle P07 vyzvedává **importem v procesu, ne přes REST**, a endpoint, který by vracel sloučený katalog prvotřídních i vlastních polí, neexistuje; `GET /api/v1/contact-fields` vrací jen vlastní pole v jiném tvaru. Zápis musí jít přes API kvůli optimistickému zámku `if_design_hash` a kvůli tomu, že totéž API používá i AI asistent (P15). Porty umožňují testovat editor bez běžícího backendu. |
| R14 | Degradovaný režim | Konstanta `EDITOR_DND_ENABLED` v `features/editor/config.ts`, ne proměnná prostředí. | Zapnutí a vypnutí je změna jednoho řádku. Nová proměnná prostředí by znamenala sáhnout do zod schématu konfigurace, které vlastní P01. |
| R15 | Vrácení akce | Dokud je fokus uvnitř Tiptapu, `Ctrl+Z` patří Tiptapu. Jinde patří dokumentu (historie 50 kroků). | Dvě historie vedle sebe jsou nevyhnutelné, protože Tiptap si vlastní vede. Dělící čára podle fokusu je jediná, které uživatel rozumí bez vysvětlování. |
| R16 | Minimální seznam šablon | Patří do P12 (úkol 28, krok 4). | Žádný plán ho nevlastní a bez něj se do editoru nedá prokliknout, takže by plán skončil polotovarem. Kdyby ho někdo převzal, vypadne z úkolu 28 soubor `templates/page.tsx` beze zbytku. |
| R17 | Český název pro merge tag versus slovník P05 | **Spor je uzavřený ve prospěch „Personalizace".** P05 má slovo `personalizace` **mimo** `BANNED_CS` a zakazuje `placeholder`, `slučovací značka`, `doplňovaný údaj` i `merge tag`, tedy přesně to, co žádá R10. | Rozhodnutí zadavatele z 1. 8. 2026. Dřívější znění tohohle plánu tvrdilo, že job `i18n-check` na katalogu `editor` shodí build; to **neplatí** a neplatilo ani v době zápisu, protože kontrola slovníku ten výraz nikdy nehlídala. Tvrzení bylo opravené, viz kapitola 9. |

---

## 2. Knihovny a licence

Licence a verze ověřené příkazem `npm view <balíček> license version` **31. 7. 2026**, nezávisle na tvrzení specifikace. Projekt je MIT, povolené licence produkčních závislostí jsou MIT, Apache-2.0, BSD a ISC. **GPL, LGPL a AGPL jsou zakázané** a hlídá to job `licenses-node`.

### 2.1 Nové produkční závislosti `apps/web`

| Balíček | Verze | Licence | K čemu |
|---|---|---|---|
| `@tiptap/react` | 3.29.2 | **MIT** | React vazba editoru bohatého textu |
| `@tiptap/core` | 3.29.2 | **MIT** | jádro |
| `@tiptap/pm` | 3.29.2 | **MIT** | ProseMirror v jednom balíčku |
| `@tiptap/extension-document` | 3.29.2 | **MIT** | kořen schématu |
| `@tiptap/extension-paragraph` | 3.29.2 | **MIT** | uzel `p` |
| `@tiptap/extension-text` | 3.29.2 | **MIT** | textový uzel |
| `@tiptap/extension-bold` | 3.29.2 | **MIT** | tučně |
| `@tiptap/extension-italic` | 3.29.2 | **MIT** | kurzíva |
| `@tiptap/extension-underline` | 3.29.2 | **MIT** | podtržení |
| `@tiptap/extension-strike` | 3.29.2 | **MIT** | přeškrtnutí |
| `@tiptap/extension-link` | 3.29.2 | **MIT** | odkaz |
| `@tiptap/extension-list` | 3.29.2 | **MIT** | `BulletList`, `OrderedList`, `ListItem` |
| `@tiptap/extension-hard-break` | 3.29.2 | **MIT** | uzel `br` |
| `@tiptap/extensions` | 3.29.2 | **MIT** | `UndoRedo`, `Placeholder`, `CharacterCount` |
| `@dnd-kit/core` | 6.3.1 | **MIT** | přetahování |
| `@dnd-kit/sortable` | 10.0.0 | **MIT** | řazení v seznamu |
| `@dnd-kit/utilities` | 3.2.2 | **MIT** | pomůcka `CSS.Transform` |

### 2.1b Nová vývojová závislost `apps/web`

| Balíček | Verze | Licence | K čemu |
|---|---|---|---|
| `intl-messageformat` | 11.2.13 | **BSD-3-Clause** | ostrá kontrola tvarů plurálu v testu katalogu (úkol 27) |

Je to tranzitivní závislost `next-intl`, ale do `devDependencies` se přidá výslovně, aby test
nezávisel na tvaru stromu závislostí. Totéž udělal P05 u `@mlain/i18n`. BSD-3-Clause je na seznamu
povolených licencí produkčních i vývojových závislostí.

**Ověřeno k 1. 8. 2026 příkazem `npm view <balíček> license version`:** všech sedmnáct produkčních
závislostí z 2.1 vrátilo `MIT`, `intl-messageformat@11.2.13` vrátil `BSD-3-Clause`.
U `@maily-to/core` nevrátil `npm view` pole `license` vůbec, což je přesně důvod zamítnutí z 2.3.

**Ověřeno k 31. 7. 2026:** `@tiptap/extensions@3.29.2` skutečně exportuje `UndoRedo`, `Placeholder` a `CharacterCount` (kontrola obsahu tarballu, ne dokumentace). `@tiptap/extension-list@3.29.2` exportuje `BulletList`, `OrderedList` a `ListItem`. V Tiptapu 3 se historie jmenuje `UndoRedo` a bydlí v `@tiptap/extensions`; balíček `@tiptap/extension-history` sice existuje, ale používat se nemá.

**`StarterKit` se nepoužije.** Přinesl by nadpisy, citace, bloky kódu a vodorovné čáry, tedy uzly, které blokový model nezná a které by šlo do dokumentu propašovat vložením ze schránky. Schéma se skládá výslovně z uzlů, které `RichText` z 3.1.5 povoluje, a nic víc.

**`@dnd-kit/core` má poslední vydání z prosince 2024.** Podle pravidla vlastního rozhraní (část 6, 13.2) se používá jen zevnitř `features/editor/components/canvas/dnd/`, jeho typy neunikají ven a výměna za nativní HTML5 přetahování je změna dvou souborů.

### 2.2 Balíčky, které se používají a už v repozitáři jsou

`@mlain/ui`, `@mlain/i18n`, `@mlain/emails` (jen typy a JSON Schema), `@mlain/contracts` (validátor Liquidu), `@mlain/core` (katalog polí, čtení šablony v serverové komponentě), `zod` (validace odpovědí portů), `ajv` (test shody descriptorů se schématem, vývojová závislost přebraná z P08).

### 2.3 Odmítnuté

| Knihovna | Licence | Proč ne |
|---|---|---|
| `@usewaypoint/email-builder` | MIT | Zamítnuto věcně po spuštění (část 3, 3.3.1). V balíčku není editor, jen `Reader`. |
| GrapesJS | BSD-3 | Zamítnuto jako druhá volba (3.3.3). Zůstává dokumentovanou náhradní cestou, kdyby se vlastní editor ukázal jako slepá ulička. |
| `@maily-to/core` | pole `license` prázdné, v balíčku není LICENSE | Neprojde licenční bránou. |
| `react-frame-component` | MIT | Zbytečná vrstva nad `<iframe srcdoc>`, K6 ji nepoužívá. |

---

## 3. Mapa souborů

```
apps/web/src/features/editor/
├── config.ts                             EDITOR_DND_ENABLED, limity, prodlevy
├── index.ts                              jediný export: EditorShell (cíl dynamického importu)
├── model/
│   ├── document-types.ts                 přemostění typů, výchozích hodnot a newBlockId
│   │                                     z @mlain/emails, jediné místo dotyku s P08
│   ├── field-catalog.ts                  typy katalogu a převody cest z @mlain/emails/paths
│   ├── tree.ts                           findBlock, blockAt, flatten, canContain + test
│   ├── ops.ts                            insert, remove, move, duplicate, patchProps, setVisibility + test
│   ├── moves.ts                          moveDelta, moveOut, moveIn + test
│   ├── factory.ts                        createBlock z descriptoru + test
│   ├── validate-client.ts                volání checkSemantics z P08 a pointer na blok + test
│   ├── issue-codes.ts                    kódy nálezů, ke kterým katalog musí mít text
│   └── richtext.ts                       RichText ↔ Tiptap JSON + test
├── descriptors/
│   ├── types.ts                          BlockDescriptor, PropDescriptor, ControlProps
│   ├── common.ts                         společné vlastnosti obsahových bloků
│   ├── section.ts columns.ts column.ts heading.ts text.ts image.ts
│   ├── button.ts divider.ts spacer.ts social.ts footer.ts html.ts
│   ├── theme.ts                          descriptor motivu
│   ├── registry.ts                       BLOCK_DESCRIPTORS, PALETTE
│   └── registry.schema.test.ts           shoda descriptorů s JSON Schema P08
├── state/
│   ├── editor-store.ts                   store, výběr, historie + test
│   └── use-editor.ts                     hooky nad storem
├── ports/
│   ├── types.ts                          EditorPorts
│   ├── http-ports.ts                     implementace nad REST API
│   ├── fake-ports.ts                     dvojník pro testy a Playwright
│   └── server-ports.ts                   čtení v serverové komponentě
├── keyboard/
│   ├── operations.ts                     registr operací + klávesy + test rovnocennosti
│   ├── run-operation.ts                  provedení operace nad storem + oznámení jako data
│   └── use-canvas-keyboard.ts            navigace stromem, přesuny, oznamování + test
├── autosave/
│   ├── use-autosave.ts                   prodleva, if_design_hash, stav uložení + test
│   └── use-unload-guard.ts               beforeunload podle kritéria 7
└── components/
    ├── editor-shell.tsx                  třípanelové rozložení, stavy obrazovky
    ├── header/save-status.tsx  header/editor-header.tsx
    ├── palette/block-palette.tsx
    ├── canvas/canvas.tsx  block-node.tsx  block-toolbar.tsx  insert-between.tsx
    ├── canvas/block-preview.tsx          přiblížení bloku na plátně, rozcestník podle typu
    ├── canvas/dnd/dnd-canvas.tsx  sortable-block.tsx
    ├── properties/properties-panel.tsx  prop-field.tsx  theme-panel.tsx
    ├── properties/controls/*.tsx         dvanáct ovládacích prvků podle druhu vlastnosti
    ├── richtext/rich-text-field.tsx  toolbar.tsx
    ├── richtext/personalization-extension.ts  personalization-node-view.tsx
    ├── richtext/personalization-menu.tsx  token-inspector.tsx  field-labels.tsx
    ├── issues/issue-bar.tsx  use-validation.ts
    ├── preview/preview-pane.tsx  preview-toolbar.tsx  audience-picker.tsx
    └── test-send/test-send-dialog.tsx

apps/web/src/app/[locale]/w/[workspaceSlug]/templates/
├── page.tsx                              minimální seznam šablon (R16), serverová komponenta
├── create-template.tsx                   klientská akce „vytvořit šablonu" a prázdný stav
└── [templateId]/
    ├── page.tsx                          serverová komponenta, čtení šablony a katalogu polí
    └── editor-client.tsx                 dynamický import editoru s ssr: false

apps/web/e2e/editor/
├── keyboard.spec.ts                      kritérium 54, přesun bez myši a oznámení pozice
├── preview.spec.ts                       kritérium 55, kontakt bez jména
└── a11y.spec.ts                          axe nad editorem

apps/web/test/p12/
└── test-runner.test.ts                   pojistka E13: leží ve STARÉM vzoru test/**,
                                          takže se spustí i tehdy, když se kvůli špatné
                                          konfiguraci nespustí nic jiného

packages/i18n/messages/cs/editor.json
packages/i18n/messages/en/editor.json
```

**`apps/web/vitest.config.ts` a `apps/web/vitest.setup.ts` v tomhle seznamu schválně nejsou.** Vlastní je P01 a tenhle plán si je nesmí nárokovat ani s podmínkou „jen pokud ještě neexistuje": P01 běží první, takže by se ta podmínka nikdy nesplnila a soubor by měl dva vlastníky podle pořadí. Viz předpoklad E13.

---

## 4. Konvence, které platí v celém plánu

| Věc | Pravidlo |
|---|---|
| Soubory | `kebab-case.ts`, React komponenta `PascalCase` uvnitř souboru s `kebab-case.tsx` názvem |
| Importy | Vždy podcesta, ale **na tu úroveň, kterou mapa `exports` cílového balíčku skutečně vystavuje**. Kořenový import `@mlain/ui` ani `@mlain/contracts` neexistuje, oba plány klíč `"."` odstranily a skončí to chybou `ERR_PACKAGE_PATH_NOT_EXPORTED` už při sestavení. U `@mlain/ui` platí `./components/*` na soubor (`@mlain/ui/components/button`), ale `./patterns/*` na **adresář** (`@mlain/ui/patterns/states`, nikdy `patterns/states/alert`) a `./a11y` bez hvězdičky. U `@mlain/core` platí `@mlain/core/<domena>`, hlouběji ne. Barrel se nezakládá (uzávěr S11). Jediný barrel v tomhle plánu je `features/editor/index.ts`, protože je to cíl dynamického importu. |
| Barvy a rozestupy | Jen tokeny z `@mlain/ui`. `bg-blue-500` v komponentě je chyba. |
| Texty | Žádný český ani anglický literál v komponentě. Všechno přes `useTranslations('editor')`. Výjimka: `data-testid`. |
| Tlačítka | Primární akce nikdy nemá `disabled` (kritérium 18 části 6). Místo zašedlého tlačítka se ukáže důvod. |
| Dlouhá pomlčka | Znak U+2014 se nesmí objevit v katalogu ani v kódu. Hlídá test v úkolu 27. |
| Testy během práce | Jen změněné a nové soubory. |
| Kam patří test | **Vedle zdroje**, tedy `src/features/editor/**/<jméno>.test.ts` nebo `.tsx`. Vzor `include` v konfiguraci P01 zní `['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}']`. Jediná výjimka je pojistka `apps/web/test/p12/test-runner.test.ts`, která leží ve starém vzoru schválně. |
| Testy na konci | Kompletní série v úkolu 30. |
| Commit | Po každém úkolu jeden commit, zpráva anglicky, prefix `feat(editor):`, `test(editor):` nebo `fix(editor):`. |

**Příkazy, které se opakují:**

```bash
# jeden testovací soubor
pnpm --filter @mlain/web exec vitest run src/features/editor/model/tree.test.ts

# všechny jednotkové testy editoru
pnpm --filter @mlain/web exec vitest run src/features/editor

# typová kontrola a lint
pnpm --filter @mlain/web typecheck
pnpm --filter @mlain/web lint

# testy v prohlížeči
pnpm --filter @mlain/web exec playwright test e2e/editor
```

---

## 5. Rozsah MVP 0, závazně

Tabulka z části 3, 3.3.3 je **strop, ne návrh**. Co je vpravo, se v tomhle plánu nedělá, ani když to vypadá jako maličkost.

| Je v MVP 0 | Není v MVP 0 |
|---|---|
| Svislý seznam sekcí, přidání bloku tlačítkem „+" mezi bloky | Volné plátno, absolutní pozicování |
| Přesouvání bloků přetažením a **klávesnicí** | Přetahování z palety na libovolné místo |
| Panel vlastností generovaný z descriptorů | Ručně navržený panel pro každý typ |
| Bohatý text s pevným panelem: tučně, kurzíva, podtržení, přeškrtnutí, odkaz, odrážkový a číslovaný seznam, vložení personalizace | Tabulky, obrázky uvnitř textu, vlastní styly |
| Náhled pro počítač, mobil, tmavý režim, textovou verzi a zdroj | Simulace Outlooku |
| Testovací odeslání na 1 až 5 adres | Hromadné testovací odeslání, A/B varianty |
| Podmínka zobrazení bloku výběrem pole a operátoru | Psaní `{% if %}` rukou kdekoliv kromě bloku `html` |

**Blok `repeat` se v paletě nenabízí** (kritérium 8d části 3), ale dokument, který ho obsahuje, se v editoru otevře, zobrazí jako zamčený placeholder a uloží beze ztráty dat. Totéž platí pro neznámý typ bloku (kritérium 5).

---

## 6. Úkoly
### Úkol 1: Kostra, závislosti a přemostění typů z P08

**Soubory:**
- Create: `apps/web/test/p12/test-runner.test.ts`
- Create: `apps/web/src/features/editor/config.ts`
- Create: `apps/web/src/features/editor/model/document-types.ts`
- Create: `apps/web/src/features/editor/model/document-types.test.ts`

- [ ] **Krok 1: Ověř předpoklady E1 až E13 spuštěním**

Import, ne grep. Mapa `exports` je jediná autorita nad tím, co z balíčku vůbec jde vytáhnout, a chyba se pozná až jejím dotazem.

```bash
cd /Users/petr/Projects/Mailing_Tool
node --input-type=module -e "
  // Musí projít: tohle jsou cesty, které mapy exports skutečně vystavují.
  await import('@mlain/emails/document/types');
  await import('@mlain/emails/paths');
  await import('@mlain/contracts/liquid');
  await import('@mlain/core/contacts');
  await import('@mlain/core/templates');
  await import('@mlain/ui/patterns/states');
  await import('@mlain/ui/patterns/email-preview');
  await import('@mlain/ui/a11y');
  await import('@mlain/ui/lib/cn');
  console.log('ok');
"
node --input-type=module -e "
  // Musí SPADNOUT. Kdyby některý z těch importů prošel, znamená to, že se
  // někdo vrátil ke kořenovému exportu nebo k hluboké podcestě, a plán by
  // se opíral o tvar, který jinde v repozitáři neplatí.
  const musiSpadnout = [
    '@mlain/ui', '@mlain/contracts',
    '@mlain/ui/patterns/states/alert', '@mlain/core/contacts/fields',
  ];
  for (const specifier of musiSpadnout) {
    let prosel = false;
    try { await import(specifier); prosel = true; } catch { /* očekávané */ }
    if (prosel) { console.error('NESMÍ jít naimportovat: ' + specifier); process.exit(1); }
  }
  console.log('ok, žádná zakázaná cesta se nerozřešila');
"
ls packages/emails/schema/document.v1.schema.json
ls packages/i18n/messages/cs
```

Expected: obojí `ok`, cesta ke schématu existuje, adresář katalogů existuje. Když něco chybí nebo se naopak rozřeší zakázaná cesta, **zastav se** a zapiš to jako požadavek do kapitoly 9; nedoplňuj cizí balíček.

- [ ] **Krok 1b: Napiš pojistku běhu testů a spusť ji**

Tenhle test leží v `apps/web/test/p12/`, tedy uvnitř **starého** vzoru `test/**`. Je to schválně: musí se spustit i tehdy, když se kvůli špatnému `include` nespustí ani jeden test tohohle plánu. Bez něj by se plán rozeběhl na konfiguraci, ve které kroky „spusť test, musí spadnout" hlásí nula testů, návratový kód nula a zelenou sérii. Neptá se plánu ani zdrojáku, ale **živé konfigurace**.

```ts
// apps/web/test/p12/test-runner.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = path.resolve(import.meta.dirname, '../..');

/** Všechny testovací soubory, které tenhle plán zakládá pod `src/`. */
function editorTestFiles(dir: string): string[] {
  let found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found = found.concat(editorTestFiles(full));
    else if (/\.test\.tsx?$/.test(entry.name)) found.push(path.relative(webRoot, full));
  }
  return found;
}

/** Escapuje znaky, které mají v regulárním výrazu vlastní význam. */
function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Převod glob vzoru Vitestu na regulární výraz. Stačí na `**`, `*` a `{a,b}`,
 * což jsou jediné konstrukce, které se v `include` vyskytují.
 *
 * Jde znak po znaku schválně. Varianta složená z postupných `replace` potřebuje
 * zástupný znak, kterým se `**` odloží stranou, aby ho nesežral následující
 * převod `*`; takový znak se musí volit tak, aby se nemohl objevit ve vstupu,
 * a je to zbytečná past. Tahle podoba žádný zástupný znak nemá.
 */
function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const rest = pattern.slice(i);
    if (rest.startsWith('**/')) { source += '(?:[^/]+/)*'; i += 2; continue; }
    if (rest.startsWith('*')) { source += '[^/]*'; continue; }
    if (rest.startsWith('{')) {
      const close = pattern.indexOf('}', i);
      const options = pattern.slice(i + 1, close).split(',').map(escapeLiteral);
      source += `(?:${options.join('|')})`;
      i = close;
      continue;
    }
    source += escapeLiteral(rest[0]);
  }
  return new RegExp(`^${source}$`);
}

describe('konfigurace testů apps/web unese testy P12', () => {
  it('vzor include pokrývá každý testovací soubor editoru', async () => {
    const config = (await import('../../vitest.config.js')).default;
    const include: string[] = config.test?.include ?? [];
    const patterns = include.map(globToRegExp);
    const editorDir = path.join(webRoot, 'src/features/editor');
    const files = editorTestFiles(editorDir);

    // Prázdný seznam by test proměnil v ozdobu: prošel by, i kdyby include byl prázdný.
    expect(files.length, 'pod src/features/editor nejsou žádné testy, něco je špatně').toBeGreaterThan(0);

    const nepokryte = files.filter((file) => !patterns.some((pattern) => pattern.test(file)));
    expect(
      nepokryte,
      `mimo include: ${nepokryte.join(', ')}. Bez nich série skončí zeleně a nulou, aniž se cokoli spustilo.`,
    ).toEqual([]);
  });

  it('běží v jsdom a má plugin React, jinak render() nemá kde renderovat', async () => {
    const config = (await import('../../vitest.config.js')).default;
    expect(config.test?.environment).toBe('jsdom');
    expect(config.plugins?.length ?? 0).toBeGreaterThan(0);
  });

  it('setupFiles registruje úklid po každém testu', async () => {
    const config = (await import('../../vitest.config.js')).default;
    const setupFiles: string[] = config.test?.setupFiles ?? [];
    expect(setupFiles.length, 'bez setupFiles zůstane render z předchozího testu v dokumentu').toBeGreaterThan(0);
    // Prázdný setup je stejná vada jako žádný. Automatický úklid
    // @testing-library/react se registruje jen při globals: true, a bez
    // cleanup() padne každý druhý render na „Found multiple elements with
    // the role". Vypadalo by to jako chyba testu, ne konfigurace.
    const setup = readFileSync(path.join(webRoot, 'vitest.setup.ts'), 'utf8');
    expect(setup).toContain('cleanup');
    expect(setup).toContain('afterEach');
  });
});
```

Run: `pnpm --filter @mlain/web exec vitest run test/p12/test-runner.test.ts`
Expected: PASS, 3 testy. **Když spadne, plán tady končí** a oprava patří do P01 (předpoklad E13), ne sem. Konfiguraci si tenhle plán nesmí přepsat ani doplnit.

- [ ] **Krok 2: Nainstaluj závislosti**

```bash
pnpm --filter @mlain/web add @tiptap/react@3.29.2 @tiptap/core@3.29.2 @tiptap/pm@3.29.2 \
  @tiptap/extension-document@3.29.2 @tiptap/extension-paragraph@3.29.2 @tiptap/extension-text@3.29.2 \
  @tiptap/extension-bold@3.29.2 @tiptap/extension-italic@3.29.2 @tiptap/extension-underline@3.29.2 \
  @tiptap/extension-strike@3.29.2 @tiptap/extension-link@3.29.2 @tiptap/extension-list@3.29.2 \
  @tiptap/extension-hard-break@3.29.2 @tiptap/extensions@3.29.2 \
  @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2
pnpm --filter @mlain/web add -D intl-messageformat@11.2.13
pnpm exec license-checker --production --json --onlyunknown | head -5
```

Expected: instalace projde, kontrola licencí nevypíše žádný balíček s neznámou licencí.

- [ ] **Krok 3: Napiš test přemostění typů**

```ts
// apps/web/src/features/editor/model/document-types.test.ts
import { describe, expect, it } from 'vitest';
import { CONTENT_TYPES, emptyDocument, isKnownType } from './document-types';

describe('document-types', () => {
  it('zná devět obsahových typů bloků', () => {
    expect([...CONTENT_TYPES].sort()).toEqual([
      'button', 'divider', 'footer', 'heading', 'html', 'image', 'social', 'spacer', 'text',
    ]);
  });

  it('repeat je známý typ, přestože se v paletě nenabízí', () => {
    expect(isKnownType('repeat')).toBe(true);
    expect(isKnownType('carousel')).toBe(false);
  });

  it('prázdný dokument má schemaVersion 1 a jednu sekci', () => {
    const doc = emptyDocument('cs');
    expect(doc.schemaVersion).toBe(1);
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].type).toBe('section');
    expect(doc.meta.language).toBe('cs');
  });

  it('prázdný dokument splňuje tvrdé požadavky schématu, ne jen tvar typu', () => {
    // Prázdný motiv a prázdné props by prošly typem a spadly až ve validaci
    // na serveru. Kořen schématu vyžaduje osm klíčů motivu, sekce vyžaduje
    // props i children a obojí má additionalProperties: false.
    const doc = emptyDocument('cs');
    expect(Object.keys(doc.theme).sort()).toEqual([
      'canvasBackground', 'colors', 'contentBackground', 'contentWidth',
      'darkMode', 'fonts', 'radius', 'typography',
    ]);
    expect(doc.blocks[0].id).toMatch(/^b_[0-9a-z]{12}$/);
    expect(doc.blocks[0].props).toHaveProperty('padding');
    expect(doc.blocks[0].children).toEqual([]);
  });
});
```

- [ ] **Krok 4: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/model/document-types.test.ts`
Expected: FAIL, `Failed to resolve import "./document-types"`.

- [ ] **Krok 5: Napiš přemostění a konfiguraci**

```ts
// apps/web/src/features/editor/model/document-types.ts
// Podcesta je `document/types`, ne `document`: mapa exports balíčku @mlain/emails
// zní `"./*": "./src/*.ts"`, takže `@mlain/emails/document` by mířilo na
// `src/document.ts`, což je adresář, ne soubor.
import { blockDefaults, DEFAULT_THEME, KNOWN_BLOCK_TYPES } from '@mlain/emails/document/defaults';
import { BLOCK_ID_PATTERN, isBlockId, newBlockId } from '@mlain/emails/document/ids';
import type {
  ColorRef, Document, InlineNode, Padding, RichNode, RichText, Theme, VisibilityCondition,
} from '@mlain/emails/document/types';

export type { ColorRef, Document, InlineNode, Padding, RichNode, RichText, Theme, VisibilityCondition };
export { BLOCK_ID_PATTERN, blockDefaults, DEFAULT_THEME, isBlockId, KNOWN_BLOCK_TYPES, newBlockId };

/**
 * Strukturální pohled na blok. Editor záměrně nepracuje s diskriminovaným sjednocením z P08:
 * operace nad stromem jsou na typu bloku nezávislé a znalost typů drží descriptory.
 * Index signature nese neznámé vlastnosti beze ztráty, což vyžaduje kritérium 5 části 3.
 */
export type EditorBlock = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: EditorBlock[];
  visibleWhen?: VisibilityCondition | null;
  [key: string]: unknown;
};

export type EditorDocument = Omit<Document, 'blocks'> & { blocks: EditorBlock[] };

/**
 * Nález v šabloně, jak ho vidí editor.
 *
 * Bydlí tady, tedy u ostatních sdílených typů, a ne u klientské validace, protože
 * ho potřebuje store (úkol 11) dřív, než validace vůbec vznikne (úkol 24).
 * Dvě definice téhož tvaru na dvou místech se vždycky rozejdou; nejpravděpodobněji
 * v tom, jestli je `message` povinné, a projevilo by se to jako prázdný řádek
 * v pruhu nálezů u nálezu z klienta.
 *
 * `message` je nepovinné schválně: klientská validace vrací **kód a parametry**,
 * ne hotovou větu, aby šla přeložit. Hotový text nese jen odpověď serveru
 * u kódu, který editor nezná (kritérium 76 části 6).
 */
export type EditorIssue = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  /** JSON Pointer na uzel dokumentu, například `/blocks/0/children/1/props/alt`. */
  pointer?: string;
  /** Blok, na který se v pruhu nálezů proklikne. Odvozený z `pointer`. */
  blockId?: string;
  params?: Record<string, string | number>;
  message?: string;
};

export const CONTENT_TYPES = [
  'heading', 'text', 'image', 'button', 'divider', 'spacer', 'html', 'social', 'footer',
] as const;

export const CONTAINER_TYPES = ['section', 'columns', 'column', 'repeat'] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/**
 * Seznam známých typů se **nepíše podruhé**. `KNOWN_BLOCK_TYPES` vlastní P08 a je
 * to tentýž seznam, proti kterému validuje JSON Schema. Vlastní kopie by se s ním
 * dřív nebo později rozešla a projevilo by se to jako blok, který editor pokládá
 * za neznámý, přestože ho model zná.
 */
export function isKnownType(type: string): boolean {
  return KNOWN_BLOCK_TYPES.includes(type);
}

/**
 * Nejmenší dokument, který **projde schématem**. Prázdný motiv ani prázdné `props`
 * to nesplní: kořen vyžaduje osm klíčů motivu a `sectionBlock` vyžaduje `props`
 * i `children`, přičemž obojí má `additionalProperties: false`. Výchozí hodnoty
 * proto pocházejí z P08, ne z ruční kopie.
 */
export function emptyDocument(language: string): EditorDocument {
  return {
    schemaVersion: 1,
    meta: { name: '', previewText: '', language },
    theme: DEFAULT_THEME,
    blocks: [{ id: newBlockId(), type: 'section', props: { ...blockDefaults('section') }, children: [] }],
  } as EditorDocument;
}
```

```ts
// apps/web/src/features/editor/config.ts
/** Vypnutím se editor přepne do degradovaného režimu podle části 3, 3.3.3: bloky se přesouvají
 *  jen klávesnicí a tlačítky v ovládání bloku. Editor zůstane plně použitelný. */
export const EDITOR_DND_ENABLED = true;

export const AUTOSAVE_DEBOUNCE_MS = 1500;
export const UNLOAD_GUARD_MS = 2000;      // kritérium 7 části 6
export const HISTORY_LIMIT = 50;
export const MAX_BLOCKS = 300;            // část 3, 3.1.2
export const MAX_DOCUMENT_BYTES = 512 * 1024;
export const MAX_SECTIONS = 60;
export const PREVIEW_WIDTHS = { desktop: 700, mobile: 375 } as const;
```

- [ ] **Krok 6: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/model/document-types.test.ts`
Expected: PASS, 4 testy.

- [ ] **Krok 7: Commit**

```bash
git add apps/web/test/p12 apps/web/src/features/editor apps/web/package.json pnpm-lock.yaml
git commit -m "feat(editor): scaffold editor feature folder and document type bridge"
```

**`apps/web/vitest.config.ts` ani `vitest.setup.ts` v `git add` nejsou a nebudou.** Vlastní je P01.

---

### Úkol 2: Průchod stromem a gramatika vnořování

**Soubory:**
- Create: `apps/web/src/features/editor/model/tree.ts`
- Create: `apps/web/src/features/editor/model/tree.test.ts`

- [ ] **Krok 1: Napiš test**

```ts
// apps/web/src/features/editor/model/tree.test.ts
import { describe, expect, it } from 'vitest';
import type { EditorDocument } from './document-types';
import { blockAt, canContain, childrenOf, findBlock, flatten, typeAt } from './tree';

const doc: EditorDocument = {
  schemaVersion: 1,
  meta: { name: 'T', previewText: '', language: 'cs' },
  theme: {},
  blocks: [
    { id: 'b_s1', type: 'section', props: {}, children: [
      { id: 'b_h1', type: 'heading', props: {} },
      { id: 'b_c1', type: 'columns', props: {}, children: [
        { id: 'b_col1', type: 'column', props: {}, children: [{ id: 'b_t1', type: 'text', props: {} }] },
        { id: 'b_col2', type: 'column', props: {}, children: [] },
      ] },
    ] },
    { id: 'b_s2', type: 'section', props: {}, children: [] },
  ],
} as EditorDocument;

describe('tree', () => {
  it('najde blok a jeho cestu', () => {
    expect(findBlock(doc, 'b_t1')?.path).toEqual([0, 1, 0, 0]);
    expect(findBlock(doc, 'b_s2')?.path).toEqual([1]);
    expect(findBlock(doc, 'b_x')).toBeUndefined();
  });

  it('vrací blok podle cesty a typ podle cesty', () => {
    expect(blockAt(doc, [0, 1])?.id).toBe('b_c1');
    expect(typeAt(doc, [])).toBe('$root');
    expect(typeAt(doc, [0, 1, 0])).toBe('column');
  });

  it('vrací potomky, kořen jako pole sekcí', () => {
    expect(childrenOf(doc, []).map((b) => b.id)).toEqual(['b_s1', 'b_s2']);
    expect(childrenOf(doc, [0, 1]).map((b) => b.id)).toEqual(['b_col1', 'b_col2']);
  });

  it('zplošťuje strom v pořadí, ve kterém se kreslí, s úrovní a pozicí', () => {
    const flat = flatten(doc);
    expect(flat.map((i) => i.block.id)).toEqual(
      ['b_s1', 'b_h1', 'b_c1', 'b_col1', 'b_t1', 'b_col2', 'b_s2'],
    );
    expect(flat[0]).toMatchObject({ level: 1, index: 0, siblings: 2 });
    expect(flat.find((i) => i.block.id === 'b_t1')).toMatchObject({ level: 4, index: 0, siblings: 1 });
  });

  it('vynucuje gramatiku vnořování z části 3, 3.1.2', () => {
    expect(canContain('$root', 'section')).toBe(true);
    expect(canContain('$root', 'heading')).toBe(false);
    expect(canContain('section', 'columns')).toBe(true);
    expect(canContain('section', 'column')).toBe(false);
    expect(canContain('section', 'section')).toBe(false);
    expect(canContain('columns', 'column')).toBe(true);
    expect(canContain('columns', 'text')).toBe(false);
    expect(canContain('column', 'columns')).toBe(false);   // pravidlo S2
    expect(canContain('column', 'text')).toBe(true);
    expect(canContain('repeat', 'text')).toBe(true);
    expect(canContain('repeat', 'repeat')).toBe(false);    // pravidlo S15
    expect(canContain('text', 'text')).toBe(false);
    expect(canContain('section', 'neznamy')).toBe(false);
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/model/tree.test.ts`
Expected: FAIL, `Failed to resolve import "./tree"`.

- [ ] **Krok 3: Napiš implementaci**

```ts
// apps/web/src/features/editor/model/tree.ts
import { CONTENT_TYPES, type EditorBlock, type EditorDocument } from './document-types';

export type Path = number[];

export type FlatItem = {
  block: EditorBlock;
  path: Path;
  level: number;      // 1 = sekce
  index: number;      // pozice mezi sourozenci, od nuly
  siblings: number;   // počet sourozenců včetně sebe
};

const CONTENT = new Set<string>(CONTENT_TYPES);

const ALLOWED: Record<string, (child: string) => boolean> = {
  $root: (c) => c === 'section',
  section: (c) => c === 'columns' || c === 'repeat' || CONTENT.has(c),
  columns: (c) => c === 'column',
  column: (c) => CONTENT.has(c),
  repeat: (c) => CONTENT.has(c),
};

export function canContain(parentType: string, childType: string): boolean {
  const rule = ALLOWED[parentType];
  return rule ? rule(childType) : false;
}

export function childrenOf(doc: EditorDocument, path: Path): EditorBlock[] {
  if (path.length === 0) return doc.blocks;
  return blockAt(doc, path)?.children ?? [];
}

export function blockAt(doc: EditorDocument, path: Path): EditorBlock | undefined {
  let list: EditorBlock[] | undefined = doc.blocks;
  let block: EditorBlock | undefined;
  for (const index of path) {
    block = list?.[index];
    if (!block) return undefined;
    list = block.children;
  }
  return block;
}

export function typeAt(doc: EditorDocument, path: Path): string {
  if (path.length === 0) return '$root';
  return blockAt(doc, path)?.type ?? '$unknown';
}

export function findBlock(
  doc: EditorDocument,
  id: string,
): { block: EditorBlock; path: Path } | undefined {
  const walk = (list: EditorBlock[], prefix: Path): { block: EditorBlock; path: Path } | undefined => {
    for (let i = 0; i < list.length; i += 1) {
      const block = list[i];
      const path = [...prefix, i];
      if (block.id === id) return { block, path };
      const found = block.children ? walk(block.children, path) : undefined;
      if (found) return found;
    }
    return undefined;
  };
  return walk(doc.blocks, []);
}

export function flatten(doc: EditorDocument): FlatItem[] {
  const out: FlatItem[] = [];
  const walk = (list: EditorBlock[], prefix: Path, level: number) => {
    list.forEach((block, index) => {
      const path = [...prefix, index];
      out.push({ block, path, level, index, siblings: list.length });
      if (block.children) walk(block.children, path, level + 1);
    });
  };
  walk(doc.blocks, [], 1);
  return out;
}
```

**Vlastní generátor id bloku se nepíše.** Identitu bloku podle části 3, 3.1.3 vlastní P08
v `@mlain/emails/document/ids` a vystavuje `newBlockId()`, `isBlockId()` i `BLOCK_ID_PATTERN`.
Druhá implementace téhož vzoru je přesně ta dvojice čísel na dvou místech, která se dřív nebo
později rozejde, a projevilo by se to jako blok, který API odmítne s chybou schématu. Editor si
ho tedy jen reexportuje přes `model/document-types.ts`, kde je i zbytek dotyku s P08.

- [ ] **Krok 4: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/model/tree.test.ts`
Expected: PASS, 5 testů.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/model
git commit -m "feat(editor): add document tree helpers and nesting grammar"
```

---

### Úkol 3: Operace nad dokumentem

**Soubory:**
- Create: `apps/web/src/features/editor/model/ops.ts`
- Create: `apps/web/src/features/editor/model/ops.test.ts`

- [ ] **Krok 1: Napiš test**

```ts
// apps/web/src/features/editor/model/ops.test.ts
import { describe, expect, it } from 'vitest';
import type { EditorDocument } from './document-types';
import {
  countBlocks, duplicateBlock, insertBlock, moveBlock, patchProps, removeBlock, setVisibility,
} from './ops';
import { findBlock } from './tree';

const base = (): EditorDocument => ({
  schemaVersion: 1,
  meta: { name: 'T', previewText: '', language: 'cs' },
  theme: {},
  blocks: [
    { id: 'b_s1', type: 'section', props: {}, children: [
      { id: 'b_h1', type: 'heading', props: { level: 2 } },
      { id: 'b_t1', type: 'text', props: {} },
      { id: 'b_c1', type: 'columns', props: {}, children: [
        { id: 'b_col1', type: 'column', props: {}, children: [] },
        { id: 'b_col2', type: 'column', props: {}, children: [] },
      ] },
    ] },
  ],
} as EditorDocument);

let counter = 0;
const gen = () => `b_fixed${String(counter += 1).padStart(6, '0')}`;

describe('ops', () => {
  it('vloží blok na zadané místo a původní dokument nezmění', () => {
    const doc = base();
    const next = insertBlock(doc, [0], 1, { id: 'b_new', type: 'divider', props: {} });
    expect(next.blocks[0].children?.map((b) => b.id)).toEqual(['b_h1', 'b_new', 'b_t1', 'b_c1']);
    expect(doc.blocks[0].children).toHaveLength(3);
  });

  it('odmítne vložení, které porušuje gramatiku', () => {
    expect(() => insertBlock(base(), [0, 2, 0], 0, { id: 'b_x', type: 'columns', props: {} }))
      .toThrow(/content_nested_columns/);
  });

  it('odebere blok a vrátí ho i s cestou', () => {
    const result = removeBlock(base(), 'b_t1');
    expect(result?.removed.id).toBe('b_t1');
    expect(result?.path).toEqual([0, 1]);
    expect(findBlock(result!.doc, 'b_t1')).toBeUndefined();
  });

  it('přesune blok dolů ve stejné úrovni a srovná index po odebrání', () => {
    const next = moveBlock(base(), 'b_h1', { parent: [0], index: 2 });
    expect(next?.blocks[0].children?.map((b) => b.id)).toEqual(['b_t1', 'b_h1', 'b_c1']);
  });

  it('přesune blok do sloupce', () => {
    const next = moveBlock(base(), 'b_h1', { parent: [0, 2, 0], index: 0 });
    expect(findBlock(next!, 'b_h1')?.path).toEqual([0, 1, 0, 0]);
  });

  it('odmítne přesun do vlastního podstromu', () => {
    expect(moveBlock(base(), 'b_c1', { parent: [0, 2, 0], index: 0 })).toBeNull();
  });

  it('odmítne přesun, který porušuje gramatiku', () => {
    expect(moveBlock(base(), 'b_c1', { parent: [0, 2, 0], index: 0 })).toBeNull();
    expect(moveBlock(base(), 'b_h1', { parent: [], index: 0 })).toBeNull();
  });

  it('duplikuje podstrom s novými identifikátory a vloží ho hned za původní', () => {
    counter = 0;
    const result = duplicateBlock(base(), 'b_c1', gen);
    const ids = result!.doc.blocks[0].children!.map((b) => b.id);
    expect(ids).toEqual(['b_h1', 'b_t1', 'b_c1', 'b_fixed000001']);
    const copy = findBlock(result!.doc, 'b_fixed000001')!.block;
    expect(copy.children!.map((c) => c.id)).toEqual(['b_fixed000002', 'b_fixed000003']);
  });

  it('nedovolí duplikovat patičku, protože dokument smí mít jen jednu', () => {
    const doc = insertBlock(base(), [0], 0, { id: 'b_f1', type: 'footer', props: {} });
    expect(duplicateBlock(doc, 'b_f1', gen)).toBeNull();
  });

  it('mění vlastnosti bez dotyku ostatních bloků', () => {
    const next = patchProps(base(), 'b_h1', { level: 1, align: 'center' });
    expect(findBlock(next, 'b_h1')?.block.props).toEqual({ level: 1, align: 'center' });
    expect(findBlock(next, 'b_t1')?.block.props).toEqual({});
  });

  it('nastaví a zruší podmínku zobrazení', () => {
    const withCond = setVisibility(base(), 'b_t1', { field: 'contact.city', op: 'present' });
    expect(findBlock(withCond, 'b_t1')?.block.visibleWhen).toEqual({ field: 'contact.city', op: 'present' });
    const without = setVisibility(withCond, 'b_t1', null);
    expect(findBlock(without, 'b_t1')?.block.visibleWhen).toBeNull();
  });

  it('podmínku na patičce odmítne, pravidlo S14', () => {
    const doc = insertBlock(base(), [0], 0, { id: 'b_f1', type: 'footer', props: {} });
    expect(() => setVisibility(doc, 'b_f1', { field: 'contact.city', op: 'present' }))
      .toThrow(/content_condition_on_unsubscribe/);
  });

  it('spočítá bloky včetně vnořených', () => {
    expect(countBlocks(base())).toBe(6);
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/model/ops.test.ts`
Expected: FAIL, `Failed to resolve import "./ops"`.

- [ ] **Krok 3: Napiš implementaci**

```ts
// apps/web/src/features/editor/model/ops.ts
import type { EditorBlock, EditorDocument, VisibilityCondition } from './document-types';
import { newBlockId } from './document-types';
import { blockAt, canContain, childrenOf, findBlock, type Path, typeAt } from './tree';

export class EditorOpError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'EditorOpError';
  }
}

export type MoveTarget = { parent: Path; index: number };

function replaceChildren(
  doc: EditorDocument,
  path: Path,
  update: (list: EditorBlock[]) => EditorBlock[],
): EditorDocument {
  if (path.length === 0) return { ...doc, blocks: update(doc.blocks) };
  const [head, ...rest] = path;
  const blocks = doc.blocks.map((block, index) => {
    if (index !== head) return block;
    return replaceIn(block, rest, update);
  });
  return { ...doc, blocks };
}

function replaceIn(
  block: EditorBlock,
  path: Path,
  update: (list: EditorBlock[]) => EditorBlock[],
): EditorBlock {
  if (path.length === 0) return { ...block, children: update(block.children ?? []) };
  const [head, ...rest] = path;
  const children = (block.children ?? []).map((child, index) =>
    index === head ? replaceIn(child, rest, update) : child);
  return { ...block, children };
}

export function insertBlock(
  doc: EditorDocument,
  parent: Path,
  index: number,
  block: EditorBlock,
): EditorDocument {
  const parentType = typeAt(doc, parent);
  if (!canContain(parentType, block.type)) {
    throw new EditorOpError(
      parentType === 'column' && block.type === 'columns' ? 'content_nested_columns'
      : parentType === 'repeat' && block.type === 'repeat' ? 'content_nested_repeat'
      : 'content_block_not_allowed_here',
    );
  }
  return replaceChildren(doc, parent, (list) => {
    const next = [...list];
    next.splice(Math.max(0, Math.min(index, list.length)), 0, block);
    return next;
  });
}

export function removeBlock(
  doc: EditorDocument,
  id: string,
): { doc: EditorDocument; removed: EditorBlock; path: Path } | null {
  const found = findBlock(doc, id);
  if (!found) return null;
  const parent = found.path.slice(0, -1);
  const index = found.path[found.path.length - 1];
  const next = replaceChildren(doc, parent, (list) => list.filter((_, i) => i !== index));
  return { doc: next, removed: found.block, path: found.path };
}

function adjustAfterRemoval(target: MoveTarget, removed: Path): MoveTarget | null {
  const isInside = target.parent.length >= removed.length
    && removed.every((value, i) => target.parent[i] === value);
  if (isInside) return null;
  const parent = [...target.parent];
  const depth = removed.length - 1;
  const sameBranch = removed.slice(0, depth).every((value, i) => parent[i] === value);
  if (sameBranch && parent.length > depth && parent[depth] > removed[depth]) parent[depth] -= 1;
  let index = target.index;
  const sameParent = target.parent.length === depth
    && removed.slice(0, depth).every((value, i) => target.parent[i] === value);
  if (sameParent && index > removed[depth]) index -= 1;
  return { parent, index };
}

export function moveBlock(doc: EditorDocument, id: string, target: MoveTarget): EditorDocument | null {
  const found = findBlock(doc, id);
  if (!found) return null;
  const removed = removeBlock(doc, id);
  if (!removed) return null;
  const adjusted = adjustAfterRemoval(target, removed.path);
  if (!adjusted) return null;
  if (!canContain(typeAt(removed.doc, adjusted.parent), found.block.type)) return null;
  return insertBlock(removed.doc, adjusted.parent, adjusted.index, removed.removed);
}

function cloneWithNewIds(block: EditorBlock, gen: () => string): EditorBlock {
  const copy: EditorBlock = { ...block, id: gen() };
  if (block.children) copy.children = block.children.map((child) => cloneWithNewIds(child, gen));
  return copy;
}

export function duplicateBlock(
  doc: EditorDocument,
  id: string,
  gen: () => string = newBlockId,
): { doc: EditorDocument; newId: string } | null {
  const found = findBlock(doc, id);
  if (!found) return null;
  if (found.block.type === 'footer') return null;    // pravidlo S3: nejvýše jedna patička
  const copy = cloneWithNewIds(found.block, gen);
  const parent = found.path.slice(0, -1);
  const index = found.path[found.path.length - 1] + 1;
  return { doc: insertBlock(doc, parent, index, copy), newId: copy.id };
}

function mapBlock(
  doc: EditorDocument,
  id: string,
  update: (block: EditorBlock) => EditorBlock,
): EditorDocument {
  const walk = (list: EditorBlock[]): EditorBlock[] => list.map((block) => {
    if (block.id === id) return update(block);
    return block.children ? { ...block, children: walk(block.children) } : block;
  });
  return { ...doc, blocks: walk(doc.blocks) };
}

export function patchProps(
  doc: EditorDocument,
  id: string,
  patch: Record<string, unknown>,
): EditorDocument {
  return mapBlock(doc, id, (block) => ({ ...block, props: { ...block.props, ...patch } }));
}

export function setVisibility(
  doc: EditorDocument,
  id: string,
  condition: VisibilityCondition | null,
): EditorDocument {
  const found = findBlock(doc, id);
  if (!found) return doc;
  if (condition && (found.block.type === 'footer')) {
    throw new EditorOpError('content_condition_on_unsubscribe');
  }
  if (condition && (found.block.type === 'columns' || found.block.type === 'column')) {
    throw new EditorOpError('content_condition_not_allowed_here');
  }
  return mapBlock(doc, id, (block) => ({ ...block, visibleWhen: condition }));
}

export function countBlocks(doc: EditorDocument): number {
  const walk = (list: EditorBlock[]): number =>
    list.reduce((sum, block) => sum + 1 + (block.children ? walk(block.children) : 0), 0);
  return walk(doc.blocks);
}

export { blockAt, childrenOf, findBlock };
```

- [ ] **Krok 4: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/model/ops.test.ts`
Expected: PASS, 13 testů.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/model
git commit -m "feat(editor): add immutable document operations"
```

---

### Úkol 4: Přesuny pro klávesnici, včetně cesty do sloupce a ven

**Soubory:**
- Create: `apps/web/src/features/editor/model/moves.ts`
- Create: `apps/web/src/features/editor/model/moves.test.ts`

Tohle je jádro splnění WCAG 2.2, kritéria 2.5.7. Tažení bloku myší umí čtyři věci: posunout výš, posunout níž, vložit do sloupce a vytáhnout ze sloupce. Klávesnice musí umět **všechny čtyři**, ne jen první dvě.

- [ ] **Krok 1: Napiš test**

```ts
// apps/web/src/features/editor/model/moves.test.ts
import { describe, expect, it } from 'vitest';
import type { EditorDocument } from './document-types';
import { moveDelta, moveIn, moveOut } from './moves';

const doc: EditorDocument = {
  schemaVersion: 1,
  meta: { name: 'T', previewText: '', language: 'cs' },
  theme: {},
  blocks: [
    { id: 'b_s1', type: 'section', props: {}, children: [
      { id: 'b_h1', type: 'heading', props: {} },
      { id: 'b_c1', type: 'columns', props: {}, children: [
        { id: 'b_col1', type: 'column', props: {}, children: [{ id: 'b_t1', type: 'text', props: {} }] },
        { id: 'b_col2', type: 'column', props: {}, children: [] },
      ] },
      { id: 'b_d1', type: 'divider', props: {} },
    ] },
    { id: 'b_s2', type: 'section', props: {}, children: [] },
  ],
} as EditorDocument;

describe('moves', () => {
  it('posune blok o jednu pozici mezi sourozenci', () => {
    expect(moveDelta(doc, 'b_h1', 1)).toEqual({ parent: [0], index: 1 });
    expect(moveDelta(doc, 'b_d1', -1)).toEqual({ parent: [0], index: 1 });
  });

  it('na kraji úrovně vrátí null, aby šlo oznámit, že to nejde', () => {
    expect(moveDelta(doc, 'b_h1', -1)).toBeNull();
    expect(moveDelta(doc, 'b_d1', 1)).toBeNull();
    expect(moveDelta(doc, 'b_t1', 1)).toBeNull();
  });

  it('vysune blok ze sloupce do sekce, hned za blok se sloupci', () => {
    expect(moveOut(doc, 'b_t1')).toEqual({ parent: [0], index: 2 });
  });

  it('sekci vysunout nejde, kořen jiné sekce nepobere', () => {
    expect(moveOut(doc, 'b_s1')).toBeNull();
    expect(moveOut(doc, 'b_h1')).toBeNull();
  });

  it('zasune blok do posledního sloupce předchozího sourozence', () => {
    expect(moveIn(doc, 'b_d1')).toEqual({ parent: [0, 1, 1], index: 0 });
  });

  it('zasune blok do prvního sloupce následujícího sourozence, když předchozí není', () => {
    expect(moveIn(doc, 'b_h1')).toEqual({ parent: [0, 1, 0], index: 1 });
  });

  it('když sousední blok není kontejner, zasunout nejde', () => {
    expect(moveIn(doc, 'b_t1')).toBeNull();
    expect(moveIn(doc, 'b_s2')).toBeNull();
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/model/moves.test.ts`
Expected: FAIL, `Failed to resolve import "./moves"`.

- [ ] **Krok 3: Napiš implementaci**

```ts
// apps/web/src/features/editor/model/moves.ts
import type { EditorDocument } from './document-types';
import type { MoveTarget } from './ops';
import { blockAt, canContain, childrenOf, findBlock, type Path, typeAt } from './tree';

/** Posun o jednu pozici mezi sourozenci. Na kraji vrací null, aby volající mohl oznámit mez. */
export function moveDelta(doc: EditorDocument, id: string, delta: -1 | 1): MoveTarget | null {
  const found = findBlock(doc, id);
  if (!found) return null;
  const parent = found.path.slice(0, -1);
  const index = found.path[found.path.length - 1];
  const target = index + delta;
  if (target < 0 || target >= childrenOf(doc, parent).length) return null;
  return { parent, index: target };
}

/** Vysunutí o úroveň výš: najde nejbližšího předka, který blok pobere, a vloží ho hned za jeho potomka. */
export function moveOut(doc: EditorDocument, id: string): MoveTarget | null {
  const found = findBlock(doc, id);
  if (!found) return null;
  for (let cut = found.path.length - 1; cut >= 1; cut -= 1) {
    const parent = found.path.slice(0, cut - 1);
    if (canContain(typeAt(doc, parent), found.block.type)) {
      return { parent, index: found.path[cut - 1] + 1 };
    }
  }
  return null;
}

function intoContainer(
  doc: EditorDocument,
  containerPath: Path,
  childType: string,
  atEnd: boolean,
): MoveTarget | null {
  const container = blockAt(doc, containerPath);
  if (!container) return null;
  if (canContain(container.type, childType)) {
    const children = container.children ?? [];
    return { parent: containerPath, index: atEnd ? children.length : 0 };
  }
  if (container.type === 'columns') {
    const columns = container.children ?? [];
    if (columns.length === 0) return null;
    const columnIndex = atEnd ? columns.length - 1 : 0;
    const column = columns[columnIndex];
    if (!canContain(column.type, childType)) return null;
    return {
      parent: [...containerPath, columnIndex],
      index: atEnd ? (column.children ?? []).length : 0,
    };
  }
  return null;
}

/** Zasunutí do sousedního kontejneru: nejdřív do předchozího sourozence na konec, jinak do dalšího na začátek. */
export function moveIn(doc: EditorDocument, id: string): MoveTarget | null {
  const found = findBlock(doc, id);
  if (!found) return null;
  const parent = found.path.slice(0, -1);
  const index = found.path[found.path.length - 1];
  const siblings = childrenOf(doc, parent);
  if (index > 0) {
    const target = intoContainer(doc, [...parent, index - 1], found.block.type, true);
    if (target) return target;
  }
  if (index < siblings.length - 1) {
    const target = intoContainer(doc, [...parent, index + 1], found.block.type, false);
    if (target) return target;
  }
  return null;
}
```

- [ ] **Krok 4: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/model/moves.test.ts`
Expected: PASS, 7 testů.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/model
git commit -m "feat(editor): add keyboard move targets including column entry and exit"
```

---

### Úkol 5: Typy descriptorů a společné vlastnosti

**Soubory:**
- Create: `apps/web/src/features/editor/descriptors/types.ts`
- Create: `apps/web/src/features/editor/descriptors/common.ts`
- Create: `apps/web/src/features/editor/descriptors/common.test.ts`

Tohle je nejdůležitější soubor celého plánu. Polovina objemu editoru je panel vlastností a **negeneruje se z kódu, ale z těchhle dat.** Přidání dalšího typu bloku je pak jeden descriptor plus jedna vykreslovací funkce, ne nový formulář.

- [ ] **Krok 1: Napiš test**

```ts
// apps/web/src/features/editor/descriptors/common.test.ts
import { describe, expect, it } from 'vitest';
import { COMMON_DEFAULTS, contentGroups, PROP_KINDS } from './common';

describe('common descriptors', () => {
  it('zná dvanáct druhů vlastností', () => {
    expect([...PROP_KINDS].sort()).toEqual([
      'asset', 'code', 'color', 'link', 'number', 'padding',
      'richtext', 'select', 'socialItems', 'text', 'toggle', 'visibility',
    ]);
  });

  it('společné skupiny obsahují odsazení, pozadí, skrytí na mobilu a podmínku zobrazení', () => {
    const keys = contentGroups().flatMap((g) => g.props.map((p) => p.key));
    expect(keys).toEqual(['padding', 'backgroundColor', 'hideOnMobile', 'visibleWhen']);
  });

  it('patička nedostane podmínku zobrazení, pravidlo S14', () => {
    const keys = contentGroups({ visibility: false }).flatMap((g) => g.props.map((p) => p.key));
    expect(keys).not.toContain('visibleWhen');
  });

  it('výchozí odsazení odpovídá tabulce z části 3, 3.2', () => {
    expect(COMMON_DEFAULTS.padding).toEqual({ top: 0, right: 24, bottom: 16, left: 24 });
    expect(COMMON_DEFAULTS.backgroundColor).toBeNull();
    expect(COMMON_DEFAULTS.hideOnMobile).toBe(false);
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/descriptors/common.test.ts`
Expected: FAIL, `Failed to resolve import "./common"`.

- [ ] **Krok 3: Napiš typy**

```ts
// apps/web/src/features/editor/descriptors/types.ts

/** Klíč v namespace `editor`. Píše se bez prefixu, komponenta volá useTranslations('editor'). */
export type I18nKey = string;

export type EditorIconName =
  | 'heading' | 'text' | 'image' | 'button' | 'divider' | 'spacer'
  | 'columns2' | 'columns3' | 'social' | 'footer' | 'code' | 'section' | 'repeat' | 'unknown';

export type PropDescriptor =
  | { kind: 'color'; key: string; label: I18nKey; allowThemeRef: true; nullable?: boolean; hint?: I18nKey }
  | { kind: 'number'; key: string; label: I18nKey; min: number; max: number; step: number;
      unit: 'px' | '%' | 'x'; nullable?: boolean; hint?: I18nKey;
      /** Hodnota, kterou vlastnost dostane při vypnutí. Výchozí je null, `image.width` má "full". */
      nullValue?: unknown }
  | { kind: 'select'; key: string; label: I18nKey;
      options: Array<{ value: string | number; label: I18nKey }>; hint?: I18nKey }
  | { kind: 'toggle'; key: string; label: I18nKey; hint?: I18nKey }
  | { kind: 'padding'; key: string; label: I18nKey }
  | { kind: 'richtext'; key: string; label: I18nKey; allowLists: boolean; singleParagraph?: boolean }
  | { kind: 'asset'; key: string; label: I18nKey; nullable?: boolean; hint?: I18nKey }
  | { kind: 'link'; key: string; label: I18nKey; trackableKey?: string }
  | { kind: 'text'; key: string; label: I18nKey; maxLength: number; hint?: I18nKey }
  | { kind: 'code'; key: string; label: I18nKey; maxLength: number; permission: 'templates:write_html' }
  | { kind: 'socialItems'; key: string; label: I18nKey; max: number }
  | { kind: 'visibility'; key: 'visibleWhen'; label: I18nKey };

export type PropGroup = { label: I18nKey; props: PropDescriptor[] };

export type BlockDescriptor = {
  type: string;
  label: I18nKey;
  icon: EditorIconName;
  /** false u `column`, `repeat` a neznámých bloků: v paletě se nenabízejí. */
  inPalette: boolean;
  groups: PropGroup[];
  defaults: Record<string, unknown>;
  /** Klíče vlastností, u kterých se v panelu ukáže ikona s textem `hint.outlookIgnored`. */
  outlookHints?: string[];
};
```

```ts
// apps/web/src/features/editor/descriptors/common.ts
import type { PropDescriptor, PropGroup } from './types';

export const PROP_KINDS = [
  'color', 'number', 'select', 'toggle', 'padding', 'richtext',
  'asset', 'link', 'text', 'code', 'socialItems', 'visibility',
] as const;

export const ALIGN_OPTIONS = [
  { value: 'left', label: 'value.align.left' },
  { value: 'center', label: 'value.align.center' },
  { value: 'right', label: 'value.align.right' },
];

export const FONT_STACK_OPTIONS = [
  { value: 'system', label: 'value.font.system' },
  { value: 'arial', label: 'value.font.arial' },
  { value: 'helvetica', label: 'value.font.helvetica' },
  { value: 'verdana', label: 'value.font.verdana' },
  { value: 'tahoma', label: 'value.font.tahoma' },
  { value: 'trebuchet', label: 'value.font.trebuchet' },
  { value: 'georgia', label: 'value.font.georgia' },
  { value: 'times', label: 'value.font.times' },
  { value: 'courier', label: 'value.font.courier' },
];

export const PADDING_PROP: PropDescriptor = { kind: 'padding', key: 'padding', label: 'prop.padding' };

export const BACKGROUND_PROP: PropDescriptor = {
  kind: 'color', key: 'backgroundColor', label: 'prop.backgroundColor', allowThemeRef: true, nullable: true,
};

export const HIDE_ON_MOBILE_PROP: PropDescriptor = {
  kind: 'toggle', key: 'hideOnMobile', label: 'prop.hideOnMobile', hint: 'hint.outlookIgnored',
};

export const VISIBILITY_PROP: PropDescriptor = {
  kind: 'visibility', key: 'visibleWhen', label: 'prop.visibleWhen',
};

export const COMMON_DEFAULTS = {
  padding: { top: 0, right: 24, bottom: 16, left: 24 },
  backgroundColor: null,
  hideOnMobile: false,
} as const;

/** Skupiny, které má každý obsahový blok. `visibility: false` je jen patička (pravidlo S14). */
export function contentGroups(options: { visibility?: boolean } = {}): PropGroup[] {
  const groups: PropGroup[] = [
    { label: 'group.layout', props: [PADDING_PROP, BACKGROUND_PROP, HIDE_ON_MOBILE_PROP] },
  ];
  if (options.visibility !== false) {
    groups.push({ label: 'group.visibility', props: [VISIBILITY_PROP] });
  }
  return groups;
}
```

- [ ] **Krok 4: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/descriptors/common.test.ts`
Expected: PASS, 4 testy.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/descriptors
git commit -m "feat(editor): add property descriptor types and shared property groups"
```
---

### Úkol 6: Descriptory kontejnerů a textových bloků

**Soubory:**
- Create: `apps/web/src/features/editor/descriptors/section.ts`, `columns.ts`, `column.ts`, `heading.ts`, `text.ts`, `image.ts`

Descriptory jsou **data, ne kód**. Hodnoty se opisují z katalogu bloků v části 3, 3.2, sloupec po sloupci. Test z úkolu 8 pak ověří, že se neopsaly špatně.

- [ ] **Krok 1: Napiš descriptory kontejnerů**

```ts
// apps/web/src/features/editor/descriptors/section.ts
import { BACKGROUND_PROP, PADDING_PROP, VISIBILITY_PROP } from './common';
import type { BlockDescriptor } from './types';

export const SECTION_DESCRIPTOR: BlockDescriptor = {
  type: 'section',
  label: 'block.section',
  icon: 'section',
  inPalette: true,
  groups: [
    { label: 'group.style', props: [
      BACKGROUND_PROP,
      { kind: 'color', key: 'outerBackgroundColor', label: 'prop.outerBackgroundColor', allowThemeRef: true, nullable: true },
      { kind: 'asset', key: 'backgroundImageAssetId', label: 'prop.backgroundImage', nullable: true },
      { kind: 'select', key: 'backgroundPosition', label: 'prop.backgroundPosition', options: [
        { value: 'top', label: 'value.position.top' },
        { value: 'center', label: 'value.position.center' },
        { value: 'bottom', label: 'value.position.bottom' },
      ] },
      { kind: 'toggle', key: 'roundedTop', label: 'prop.roundedTop', hint: 'hint.outlookIgnored' },
      { kind: 'toggle', key: 'roundedBottom', label: 'prop.roundedBottom', hint: 'hint.outlookIgnored' },
    ] },
    { label: 'group.layout', props: [
      PADDING_PROP,
      { kind: 'toggle', key: 'fullWidth', label: 'prop.fullWidth' },
    ] },
    { label: 'group.visibility', props: [VISIBILITY_PROP] },
  ],
  defaults: {
    backgroundColor: null,
    outerBackgroundColor: null,
    backgroundImageAssetId: null,
    backgroundPosition: 'center',
    padding: { top: 24, right: 24, bottom: 24, left: 24 },
    fullWidth: false,
    roundedTop: false,
    roundedBottom: false,
  },
  outlookHints: ['roundedTop', 'roundedBottom'],
};
```

```ts
// apps/web/src/features/editor/descriptors/columns.ts
import type { BlockDescriptor } from './types';

export const COLUMNS_DESCRIPTOR: BlockDescriptor = {
  type: 'columns',
  label: 'block.columns',
  icon: 'columns2',
  inPalette: true,
  groups: [
    { label: 'group.layout', props: [
      { kind: 'select', key: 'layout', label: 'prop.layout', options: [
        { value: '1-1', label: 'value.layout.1-1' },
        { value: '1-2', label: 'value.layout.1-2' },
        { value: '2-1', label: 'value.layout.2-1' },
        { value: '1-1-1', label: 'value.layout.1-1-1' },
        { value: '2-1-1', label: 'value.layout.2-1-1' },
        { value: '1-1-2', label: 'value.layout.1-1-2' },
      ] },
      { kind: 'number', key: 'gap', label: 'prop.gap', min: 0, max: 48, step: 2, unit: 'px' },
      { kind: 'select', key: 'verticalAlign', label: 'prop.verticalAlign', options: [
        { value: 'top', label: 'value.valign.top' },
        { value: 'middle', label: 'value.valign.middle' },
        { value: 'bottom', label: 'value.valign.bottom' },
      ] },
    ] },
    { label: 'group.mobile', props: [
      { kind: 'toggle', key: 'stackOnMobile', label: 'prop.stackOnMobile', hint: 'hint.outlookIgnored' },
      { kind: 'select', key: 'stackOrder', label: 'prop.stackOrder', options: [
        { value: 'normal', label: 'value.stackOrder.normal' },
        { value: 'reverse', label: 'value.stackOrder.reverse' },
      ] },
    ] },
  ],
  defaults: { layout: '1-1', gap: 16, stackOnMobile: true, stackOrder: 'normal', verticalAlign: 'top' },
};
```

```ts
// apps/web/src/features/editor/descriptors/column.ts
import { BACKGROUND_PROP, PADDING_PROP } from './common';
import type { BlockDescriptor } from './types';

/** V paletě není: sloupec vzniká jen jako potomek bloku `columns`. */
export const COLUMN_DESCRIPTOR: BlockDescriptor = {
  type: 'column',
  label: 'block.column',
  icon: 'columns2',
  inPalette: false,
  groups: [
    { label: 'group.style', props: [
      PADDING_PROP,
      BACKGROUND_PROP,
      { kind: 'number', key: 'borderRadius', label: 'prop.borderRadius', min: 0, max: 32, step: 1, unit: 'px', hint: 'hint.outlookIgnored' },
    ] },
  ],
  defaults: { padding: { top: 0, right: 0, bottom: 0, left: 0 }, backgroundColor: null, borderRadius: 0 },
  outlookHints: ['borderRadius'],
};
```

- [ ] **Krok 2: Napiš descriptory textových bloků a obrázku**

```ts
// apps/web/src/features/editor/descriptors/heading.ts
import { ALIGN_OPTIONS, COMMON_DEFAULTS, contentGroups, FONT_STACK_OPTIONS } from './common';
import type { BlockDescriptor } from './types';

export const HEADING_DESCRIPTOR: BlockDescriptor = {
  type: 'heading',
  label: 'block.heading',
  icon: 'heading',
  inPalette: true,
  groups: [
    { label: 'group.content', props: [
      { kind: 'richtext', key: 'content', label: 'prop.content', allowLists: false, singleParagraph: true },
      { kind: 'select', key: 'level', label: 'prop.level', options: [
        { value: 1, label: 'value.level.1' },
        { value: 2, label: 'value.level.2' },
        { value: 3, label: 'value.level.3' },
      ] },
    ] },
    { label: 'group.style', props: [
      { kind: 'color', key: 'color', label: 'prop.color', allowThemeRef: true },
      { kind: 'select', key: 'align', label: 'prop.align', options: ALIGN_OPTIONS },
      { kind: 'select', key: 'fontFamily', label: 'prop.fontFamily', options: FONT_STACK_OPTIONS },
      { kind: 'number', key: 'fontSize', label: 'prop.fontSize', min: 12, max: 48, step: 1, unit: 'px', nullable: true },
      { kind: 'select', key: 'fontWeight', label: 'prop.fontWeight', options: [
        { value: 400, label: 'value.weight.400' },
        { value: 600, label: 'value.weight.600' },
        { value: 700, label: 'value.weight.700' },
      ] },
      { kind: 'number', key: 'lineHeight', label: 'prop.lineHeight', min: 1, max: 2, step: 0.05, unit: 'x', nullable: true },
      { kind: 'number', key: 'letterSpacing', label: 'prop.letterSpacing', min: -1, max: 4, step: 0.5, unit: 'px', hint: 'hint.outlookIgnored' },
    ] },
    ...contentGroups(),
  ],
  defaults: {
    ...COMMON_DEFAULTS,
    level: 2,
    content: [{ t: 'p', children: [] }],
    color: 'text.default',
    align: 'left',
    fontFamily: null,
    fontSize: null,
    fontWeight: 700,
    lineHeight: null,
    letterSpacing: 0,
  },
  outlookHints: ['letterSpacing'],
};
```

```ts
// apps/web/src/features/editor/descriptors/text.ts
import { ALIGN_OPTIONS, COMMON_DEFAULTS, contentGroups, FONT_STACK_OPTIONS } from './common';
import type { BlockDescriptor } from './types';

export const TEXT_DESCRIPTOR: BlockDescriptor = {
  type: 'text',
  label: 'block.text',
  icon: 'text',
  inPalette: true,
  groups: [
    { label: 'group.content', props: [
      { kind: 'richtext', key: 'content', label: 'prop.content', allowLists: true },
    ] },
    { label: 'group.style', props: [
      { kind: 'color', key: 'color', label: 'prop.color', allowThemeRef: true },
      { kind: 'color', key: 'linkColor', label: 'prop.linkColor', allowThemeRef: true },
      { kind: 'select', key: 'align', label: 'prop.align', options: [
        ...ALIGN_OPTIONS,
        { value: 'justify', label: 'value.align.justify' },
      ] },
      { kind: 'select', key: 'fontFamily', label: 'prop.fontFamily', options: FONT_STACK_OPTIONS },
      { kind: 'number', key: 'fontSize', label: 'prop.fontSize', min: 10, max: 32, step: 1, unit: 'px', nullable: true },
      { kind: 'number', key: 'lineHeight', label: 'prop.lineHeight', min: 1, max: 2.5, step: 0.05, unit: 'x', nullable: true },
    ] },
    ...contentGroups(),
  ],
  defaults: {
    ...COMMON_DEFAULTS,
    content: [{ t: 'p', children: [] }],
    color: 'text.default',
    linkColor: 'link.default',
    align: 'left',
    fontFamily: null,
    fontSize: null,
    lineHeight: null,
  },
};
```

```ts
// apps/web/src/features/editor/descriptors/image.ts
import { ALIGN_OPTIONS, COMMON_DEFAULTS, contentGroups } from './common';
import type { BlockDescriptor } from './types';

export const IMAGE_DESCRIPTOR: BlockDescriptor = {
  type: 'image',
  label: 'block.image',
  icon: 'image',
  inPalette: true,
  groups: [
    { label: 'group.content', props: [
      { kind: 'asset', key: 'assetId', label: 'prop.asset' },
      { kind: 'text', key: 'alt', label: 'prop.alt', maxLength: 200, hint: 'hint.altRequired' },
      { kind: 'toggle', key: 'decorative', label: 'prop.decorative', hint: 'hint.decorative' },
      { kind: 'link', key: 'href', label: 'prop.href', trackableKey: 'trackable' },
    ] },
    { label: 'group.style', props: [
      { kind: 'number', key: 'width', label: 'prop.width', min: 20, max: 640, step: 10, unit: 'px', nullable: true, nullValue: 'full' },
      { kind: 'select', key: 'align', label: 'prop.align', options: ALIGN_OPTIONS },
      { kind: 'number', key: 'borderRadius', label: 'prop.borderRadius', min: 0, max: 32, step: 1, unit: 'px', nullable: true, hint: 'hint.outlookIgnored' },
      { kind: 'asset', key: 'darkVariantAssetId', label: 'prop.darkVariant', nullable: true, hint: 'hint.darkVariant' },
    ] },
    ...contentGroups(),
  ],
  defaults: {
    ...COMMON_DEFAULTS,
    assetId: null,
    alt: '',
    decorative: false,
    width: 'full',
    align: 'center',
    href: null,
    trackable: true,
    borderRadius: null,
    darkVariantAssetId: null,
  },
  outlookHints: ['borderRadius'],
};
```

- [ ] **Krok 3: Typová kontrola**

Run: `pnpm --filter @mlain/web typecheck`
Expected: PASS, žádná chyba.

- [ ] **Krok 4: Commit**

```bash
git add apps/web/src/features/editor/descriptors
git commit -m "feat(editor): add descriptors for containers, heading, text and image"
```

---

### Úkol 7: Descriptory zbývajících bloků, registr a paleta

**Soubory:**
- Create: `apps/web/src/features/editor/descriptors/button.ts`, `divider.ts`, `spacer.ts`, `social.ts`, `footer.ts`, `html.ts`
- Create: `apps/web/src/features/editor/descriptors/registry.ts`
- Create: `apps/web/src/features/editor/descriptors/registry.test.ts`

- [ ] **Krok 1: Napiš test registru**

```ts
// apps/web/src/features/editor/descriptors/registry.test.ts
import { describe, expect, it } from 'vitest';
import { CONTENT_TYPES } from '../model/document-types';
import { BLOCK_DESCRIPTORS, descriptorFor, PALETTE } from './registry';

describe('registry', () => {
  it('má descriptor pro každý známý typ bloku kromě repeat', () => {
    const types = Object.keys(BLOCK_DESCRIPTORS).sort();
    expect(types).toEqual([...CONTENT_TYPES, 'column', 'columns', 'section'].sort());
  });

  it('paleta neobsahuje repeat ani column, kritérium 8d části 3', () => {
    const types = PALETTE.flatMap((group) => group.entries.map((e) => e.type));
    expect(types).not.toContain('repeat');
    expect(types).not.toContain('column');
  });

  it('každá položka palety odkazuje na existující descriptor', () => {
    for (const group of PALETTE) {
      for (const entry of group.entries) expect(BLOCK_DESCRIPTORS[entry.type]).toBeDefined();
    }
  });

  it('dvousloupcový a třísloupcový blok jsou dvě položky nad jedním typem', () => {
    const columns = PALETTE.flatMap((g) => g.entries).filter((e) => e.type === 'columns');
    expect(columns.map((e) => e.preset?.layout)).toEqual(['1-1', '1-1-1']);
  });

  it('neznámý typ dostane zamčený descriptor bez vlastností', () => {
    const unknown = descriptorFor('carousel');
    expect(unknown.inPalette).toBe(false);
    expect(unknown.groups).toEqual([]);
    expect(unknown.label).toBe('block.unknown');
  });

  it('patička nemá skupinu podmínky zobrazení, pravidlo S14', () => {
    const keys = BLOCK_DESCRIPTORS.footer.groups.flatMap((g) => g.props.map((p) => p.key));
    expect(keys).not.toContain('visibleWhen');
  });

  it('blok html má vlastnost chráněnou oprávněním', () => {
    const code = BLOCK_DESCRIPTORS.html.groups[0].props[0];
    expect(code).toMatchObject({ kind: 'code', permission: 'templates:write_html', maxLength: 20000 });
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/descriptors/registry.test.ts`
Expected: FAIL, `Failed to resolve import "./registry"`.

- [ ] **Krok 3: Napiš zbývající descriptory**

```ts
// apps/web/src/features/editor/descriptors/button.ts
import { ALIGN_OPTIONS, COMMON_DEFAULTS, contentGroups } from './common';
import type { BlockDescriptor } from './types';

export const BUTTON_DESCRIPTOR: BlockDescriptor = {
  type: 'button',
  label: 'block.button',
  icon: 'button',
  inPalette: true,
  groups: [
    { label: 'group.content', props: [
      { kind: 'richtext', key: 'label', label: 'prop.buttonLabel', allowLists: false, singleParagraph: true },
      { kind: 'link', key: 'href', label: 'prop.href', trackableKey: 'trackable' },
    ] },
    { label: 'group.style', props: [
      { kind: 'select', key: 'style', label: 'prop.buttonStyle', options: [
        { value: 'solid', label: 'value.buttonStyle.solid' },
        { value: 'outline', label: 'value.buttonStyle.outline' },
      ] },
      { kind: 'color', key: 'backgroundColor', label: 'prop.backgroundColor', allowThemeRef: true },
      { kind: 'color', key: 'textColor', label: 'prop.textColor', allowThemeRef: true },
      { kind: 'color', key: 'borderColor', label: 'prop.borderColor', allowThemeRef: true, nullable: true },
      { kind: 'select', key: 'borderWidth', label: 'prop.borderWidth', options: [
        { value: 0, label: 'value.borderWidth.0' },
        { value: 1, label: 'value.borderWidth.1' },
        { value: 2, label: 'value.borderWidth.2' },
      ] },
      { kind: 'number', key: 'borderRadius', label: 'prop.borderRadius', min: 0, max: 32, step: 1, unit: 'px', nullable: true, hint: 'hint.outlookRadius' },
      { kind: 'number', key: 'fontSize', label: 'prop.fontSize', min: 12, max: 24, step: 1, unit: 'px' },
    ] },
    { label: 'group.layout', props: [
      { kind: 'toggle', key: 'fullWidth', label: 'prop.fullWidth' },
      { kind: 'select', key: 'align', label: 'prop.align', options: ALIGN_OPTIONS },
      { kind: 'number', key: 'paddingX', label: 'prop.paddingX', min: 8, max: 48, step: 2, unit: 'px' },
      { kind: 'number', key: 'paddingY', label: 'prop.paddingY', min: 8, max: 48, step: 2, unit: 'px' },
    ] },
    ...contentGroups(),
  ],
  defaults: {
    ...COMMON_DEFAULTS,
    label: [{ t: 'p', children: [{ t: 's', v: 'Zjistit více' }] }],
    href: '',
    trackable: true,
    style: 'solid',
    backgroundColor: 'brand.primary',
    textColor: 'text.inverted',
    borderColor: null,
    borderWidth: 0,
    borderRadius: null,
    fullWidth: false,
    align: 'center',
    paddingX: 28,
    paddingY: 14,
    fontSize: 16,
  },
  outlookHints: ['borderRadius'],
};
```

```ts
// apps/web/src/features/editor/descriptors/divider.ts
import { ALIGN_OPTIONS, COMMON_DEFAULTS, contentGroups } from './common';
import type { BlockDescriptor } from './types';

export const DIVIDER_DESCRIPTOR: BlockDescriptor = {
  type: 'divider',
  label: 'block.divider',
  icon: 'divider',
  inPalette: true,
  groups: [
    { label: 'group.style', props: [
      { kind: 'color', key: 'color', label: 'prop.color', allowThemeRef: true },
      { kind: 'select', key: 'thickness', label: 'prop.thickness', options: [
        { value: 1, label: 'value.thickness.1' },
        { value: 2, label: 'value.thickness.2' },
        { value: 3, label: 'value.thickness.3' },
        { value: 4, label: 'value.thickness.4' },
      ] },
      { kind: 'select', key: 'style', label: 'prop.lineStyle', options: [
        { value: 'solid', label: 'value.lineStyle.solid' },
        { value: 'dashed', label: 'value.lineStyle.dashed' },
        { value: 'dotted', label: 'value.lineStyle.dotted' },
      ], hint: 'hint.outlookLineStyle' },
      { kind: 'number', key: 'width', label: 'prop.lineWidth', min: 10, max: 100, step: 5, unit: '%' },
      { kind: 'select', key: 'align', label: 'prop.align', options: ALIGN_OPTIONS },
    ] },
    ...contentGroups(),
  ],
  defaults: { ...COMMON_DEFAULTS, color: 'surface.subtle', thickness: 1, style: 'solid', width: 100, align: 'center' },
};
```

```ts
// apps/web/src/features/editor/descriptors/spacer.ts
import { COMMON_DEFAULTS, contentGroups } from './common';
import type { BlockDescriptor } from './types';

export const SPACER_DESCRIPTOR: BlockDescriptor = {
  type: 'spacer',
  label: 'block.spacer',
  icon: 'spacer',
  inPalette: true,
  groups: [
    { label: 'group.style', props: [
      { kind: 'number', key: 'height', label: 'prop.height', min: 4, max: 120, step: 4, unit: 'px' },
      { kind: 'number', key: 'heightMobile', label: 'prop.heightMobile', min: 4, max: 120, step: 4, unit: 'px', nullable: true, hint: 'hint.outlookIgnored' },
    ] },
    ...contentGroups(),
  ],
  defaults: { ...COMMON_DEFAULTS, height: 24, heightMobile: null },
  outlookHints: ['heightMobile'],
};
```

```ts
// apps/web/src/features/editor/descriptors/social.ts
import { ALIGN_OPTIONS, COMMON_DEFAULTS, contentGroups } from './common';
import type { BlockDescriptor } from './types';

export const SOCIAL_NETWORKS = [
  'facebook', 'instagram', 'x', 'linkedin', 'youtube', 'tiktok', 'threads',
  'pinterest', 'bluesky', 'mastodon', 'web', 'email',
] as const;

export const SOCIAL_DESCRIPTOR: BlockDescriptor = {
  type: 'social',
  label: 'block.social',
  icon: 'social',
  inPalette: true,
  groups: [
    { label: 'group.content', props: [
      { kind: 'socialItems', key: 'items', label: 'prop.socialItems', max: 8 },
    ] },
    { label: 'group.style', props: [
      { kind: 'select', key: 'iconStyle', label: 'prop.iconStyle', options: [
        { value: 'color', label: 'value.iconStyle.color' },
        { value: 'mono_dark', label: 'value.iconStyle.monoDark' },
        { value: 'mono_light', label: 'value.iconStyle.monoLight' },
      ] },
      { kind: 'number', key: 'iconSize', label: 'prop.iconSize', min: 16, max: 48, step: 2, unit: 'px' },
      { kind: 'number', key: 'gap', label: 'prop.gap', min: 0, max: 32, step: 2, unit: 'px' },
      { kind: 'select', key: 'align', label: 'prop.align', options: ALIGN_OPTIONS },
    ] },
    ...contentGroups(),
  ],
  defaults: { ...COMMON_DEFAULTS, items: [], iconStyle: 'color', iconSize: 28, gap: 12, align: 'center' },
};
```

```ts
// apps/web/src/features/editor/descriptors/footer.ts
import { COMMON_DEFAULTS, contentGroups } from './common';
import type { BlockDescriptor } from './types';

export const FOOTER_DESCRIPTOR: BlockDescriptor = {
  type: 'footer',
  label: 'block.footer',
  icon: 'footer',
  inPalette: true,
  groups: [
    { label: 'group.content', props: [
      { kind: 'richtext', key: 'senderInfo', label: 'prop.senderInfo', allowLists: false },
      { kind: 'toggle', key: 'showUnsubscribe', label: 'prop.showUnsubscribe', hint: 'hint.unsubscribeRequired' },
      { kind: 'text', key: 'unsubscribeLabel', label: 'prop.unsubscribeLabel', maxLength: 60 },
      { kind: 'toggle', key: 'showPreferences', label: 'prop.showPreferences' },
      { kind: 'text', key: 'preferencesLabel', label: 'prop.preferencesLabel', maxLength: 60 },
      { kind: 'toggle', key: 'showWebview', label: 'prop.showWebview' },
      { kind: 'text', key: 'webviewLabel', label: 'prop.webviewLabel', maxLength: 60 },
    ] },
    { label: 'group.style', props: [
      { kind: 'number', key: 'fontSize', label: 'prop.fontSize', min: 10, max: 16, step: 1, unit: 'px' },
      { kind: 'color', key: 'color', label: 'prop.color', allowThemeRef: true },
    ] },
    ...contentGroups({ visibility: false }),
  ],
  defaults: {
    ...COMMON_DEFAULTS,
    senderInfo: [{ t: 'p', children: [{ t: 'var', expr: 'workspace.sender_address' }] }],
    showUnsubscribe: true,
    unsubscribeLabel: 'Odhlásit se z odběru',
    showPreferences: true,
    preferencesLabel: 'Nastavit předvolby',
    showWebview: true,
    webviewLabel: 'Zobrazit v prohlížeči',
    fontSize: 12,
    color: 'text.muted',
  },
};
```

```ts
// apps/web/src/features/editor/descriptors/html.ts
import { COMMON_DEFAULTS, contentGroups } from './common';
import type { BlockDescriptor } from './types';

export const HTML_DESCRIPTOR: BlockDescriptor = {
  type: 'html',
  label: 'block.html',
  icon: 'code',
  inPalette: true,
  groups: [
    { label: 'group.content', props: [
      { kind: 'code', key: 'code', label: 'prop.code', maxLength: 20000, permission: 'templates:write_html' },
    ] },
    ...contentGroups(),
  ],
  defaults: { ...COMMON_DEFAULTS, code: '' },
};
```

- [ ] **Krok 4: Napiš registr a paletu**

```ts
// apps/web/src/features/editor/descriptors/registry.ts
import { BUTTON_DESCRIPTOR } from './button';
import { COLUMN_DESCRIPTOR } from './column';
import { COLUMNS_DESCRIPTOR } from './columns';
import { DIVIDER_DESCRIPTOR } from './divider';
import { FOOTER_DESCRIPTOR } from './footer';
import { HEADING_DESCRIPTOR } from './heading';
import { HTML_DESCRIPTOR } from './html';
import { IMAGE_DESCRIPTOR } from './image';
import { SECTION_DESCRIPTOR } from './section';
import { SOCIAL_DESCRIPTOR } from './social';
import { SPACER_DESCRIPTOR } from './spacer';
import { TEXT_DESCRIPTOR } from './text';
import type { BlockDescriptor, EditorIconName, I18nKey } from './types';

export const BLOCK_DESCRIPTORS: Record<string, BlockDescriptor> = {
  section: SECTION_DESCRIPTOR,
  columns: COLUMNS_DESCRIPTOR,
  column: COLUMN_DESCRIPTOR,
  heading: HEADING_DESCRIPTOR,
  text: TEXT_DESCRIPTOR,
  image: IMAGE_DESCRIPTOR,
  button: BUTTON_DESCRIPTOR,
  divider: DIVIDER_DESCRIPTOR,
  spacer: SPACER_DESCRIPTOR,
  social: SOCIAL_DESCRIPTOR,
  footer: FOOTER_DESCRIPTOR,
  html: HTML_DESCRIPTOR,
};

/**
 * Zamčený placeholder pro `repeat` a pro neznámý typ bloku. Nemá vlastnosti, takže se v panelu
 * nedá nic změnit, a dokument se uloží bajtově shodný (kritéria 5 a 8d části 3).
 */
export const LOCKED_DESCRIPTOR: BlockDescriptor = {
  type: '$unknown',
  label: 'block.unknown',
  icon: 'unknown',
  inPalette: false,
  groups: [],
  defaults: {},
};

export function descriptorFor(type: string): BlockDescriptor {
  return BLOCK_DESCRIPTORS[type] ?? { ...LOCKED_DESCRIPTOR, type };
}

export type PaletteEntry = {
  id: string;
  type: string;
  label: I18nKey;
  icon: EditorIconName;
  preset?: Record<string, unknown>;
};

export const PALETTE: Array<{ label: I18nKey; entries: PaletteEntry[] }> = [
  { label: 'palette.group.content', entries: [
    { id: 'heading', type: 'heading', label: 'block.heading', icon: 'heading' },
    { id: 'text', type: 'text', label: 'block.text', icon: 'text' },
    { id: 'image', type: 'image', label: 'block.image', icon: 'image' },
    { id: 'button', type: 'button', label: 'block.button', icon: 'button' },
    { id: 'divider', type: 'divider', label: 'block.divider', icon: 'divider' },
    { id: 'spacer', type: 'spacer', label: 'block.spacer', icon: 'spacer' },
    { id: 'social', type: 'social', label: 'block.social', icon: 'social' },
    { id: 'html', type: 'html', label: 'block.html', icon: 'code' },
    { id: 'footer', type: 'footer', label: 'block.footer', icon: 'footer' },
  ] },
  { label: 'palette.group.layout', entries: [
    { id: 'section', type: 'section', label: 'block.section', icon: 'section' },
    { id: 'columns-2', type: 'columns', label: 'block.columns2', icon: 'columns2', preset: { layout: '1-1' } },
    { id: 'columns-3', type: 'columns', label: 'block.columns3', icon: 'columns3', preset: { layout: '1-1-1' } },
  ] },
];
```

- [ ] **Krok 5: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/descriptors/registry.test.ts`
Expected: PASS, 7 testů.

- [ ] **Krok 6: Commit**

```bash
git add apps/web/src/features/editor/descriptors
git commit -m "feat(editor): add remaining block descriptors, registry and palette"
```

---

### Úkol 8: Pojistka proti rozjetí descriptorů a modelu

**Soubory:**
- Create: `apps/web/src/features/editor/descriptors/registry.schema.test.ts`

Descriptory vlastní P12, blokový model P08 (rozhodnutí R1). Dvě sady stejných čísel na dvou místech se **vždy** rozejdou, pokud je nehlídá stroj. Tenhle test je ten stroj: čte JSON Schema od P08 a porovnává s ním výchozí hodnoty i meze číselných vlastností. Ověřuje se spuštěním validátoru, ne hledáním řetězce.

- [ ] **Krok 1: Napiš test**

```ts
// apps/web/src/features/editor/descriptors/registry.schema.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { createBlock } from '../model/factory';
import { BLOCK_DESCRIPTORS } from './registry';

const schemaPath = resolve(
  import.meta.dirname, '../../../../../../packages/emails/schema/document.v1.schema.json',
);
type JsonSchemaNode = {
  $ref?: string;
  properties?: Record<string, JsonSchemaNode>;
  minimum?: number;
  maximum?: number;
};

const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
  $defs: Record<string, JsonSchemaNode>;
};

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validate = ajv.compile(schema);

/**
 * Kde v JSON Schema bydlí vlastnosti bloku.
 *
 * P08 pojmenoval samostatnou definici **jedinou**: `sectionProps`, protože na ni
 * odkazuje `sectionBlock` přes `$ref`. Všechny ostatní bloky mají schéma vlastností
 * vepsané přímo do `<typ>Block.properties.props`. Dřívější znění tohohle testu
 * hledalo `$defs.headingProps` a podobná jména; ta ve schématu nejsou, takže by
 * test spadl na chybějící definici u jedenácti bloků z dvanácti a vypadalo by to
 * jako vada descriptorů. Ověřeno čtením skutečného souboru, ne dohadem.
 *
 * `$ref` se rozřeší, protože právě u sekce vede na sourozeneckou definici.
 */
function propsSchemaOf(type: string): JsonSchemaNode | undefined {
  const block = schema.$defs[`${type}Block`];
  const props = block?.properties?.props;
  if (!props) return undefined;
  if (props.$ref) {
    const name = props.$ref.replace('#/$defs/', '');
    return schema.$defs[name];
  }
  return props;
}

function documentWith(type: string) {
  const block = createBlock(type);
  const inner = type === 'section' ? block
    : { ...createBlock('section'), children: [block] };
  return {
    schemaVersion: 1,
    meta: { name: 'Test', previewText: '', language: 'cs' },
    theme: {},
    blocks: [inner],
  };
}

describe('descriptory proti JSON Schema z P08', () => {
  it.each(Object.keys(BLOCK_DESCRIPTORS).filter((t) => t !== 'column'))(
    'blok %s vytvořený z descriptoru projde schématem',
    (type) => {
      const ok = validate(documentWith(type));
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
    },
  );

  it.each(Object.entries(BLOCK_DESCRIPTORS))(
    'meze číselných vlastností bloku %s odpovídají schématu',
    (type, descriptor) => {
      const def = propsSchemaOf(type);
      expect(def, `v JSON Schema chybí vlastnosti bloku ${type}`).toBeDefined();
      for (const group of descriptor.groups) {
        for (const prop of group.props) {
          if (prop.kind !== 'number') continue;
          const inSchema = def!.properties?.[prop.key];
          expect(inSchema, `${type}.${prop.key} není ve schématu`).toBeDefined();
          // Vlastnost s `nullValue` má ve schématu sjednocení typů, meze se u ní neporovnávají.
          if (prop.nullValue === undefined && (prop.unit === 'px' || prop.unit === '%')) {
            expect([prop.key, inSchema!.minimum]).toEqual([prop.key, prop.min]);
            expect([prop.key, inSchema!.maximum]).toEqual([prop.key, prop.max]);
          }
        }
      }
    },
  );

  it('každá vlastnost z descriptoru existuje ve schématu bloku', () => {
    for (const [type, descriptor] of Object.entries(BLOCK_DESCRIPTORS)) {
      const def = propsSchemaOf(type);
      expect(def, `v JSON Schema chybí vlastnosti bloku ${type}`).toBeDefined();
      const allowed = Object.keys(def!.properties ?? {});
      for (const group of descriptor.groups) {
        for (const prop of group.props) {
          if (prop.kind === 'visibility') continue;   // visibleWhen je na bloku, ne v props
          expect(allowed, `${type}.${prop.key}`).toContain(prop.key);
        }
      }
    }
  });

  it('sekce má vlastnosti v samostatné definici, ostatní bloky vepsané', () => {
    // Tenhle test nekontroluje descriptory, ale předpoklad, na kterém stojí
    // `propsSchemaOf`. Kdyby P08 tvar schématu změnil, spadne tady jedna
    // srozumitelná věta místo dvanácti nejasných.
    expect(schema.$defs.sectionBlock?.properties?.props?.$ref).toBe('#/$defs/sectionProps');
    expect(schema.$defs.headingBlock?.properties?.props?.$ref).toBeUndefined();
    expect(schema.$defs.headingBlock?.properties?.props?.properties).toBeDefined();
  });
});
```

- [ ] **Krok 2: Spusť test**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/descriptors/registry.schema.test.ts`
Expected: FAIL, `createBlock` ještě neexistuje. Test se zezelená až po úkolu 9.

- [ ] **Krok 3: Commit**

```bash
git add apps/web/src/features/editor/descriptors/registry.schema.test.ts
git commit -m "test(editor): add descriptor conformance test against block JSON schema"
```

---

### Úkol 9: Tovární funkce na nový blok

**Soubory:**
- Create: `apps/web/src/features/editor/model/factory.ts`
- Create: `apps/web/src/features/editor/model/factory.test.ts`

- [ ] **Krok 1: Napiš test**

```ts
// apps/web/src/features/editor/model/factory.test.ts
import { describe, expect, it } from 'vitest';
import { createBlock, createFromPaletteEntry } from './factory';
import { BLOCK_ID_PATTERN } from './document-types';

describe('factory', () => {
  it('vytvoří blok s identifikátorem podle vzoru a s výchozími hodnotami z descriptoru', () => {
    const block = createBlock('heading');
    expect(block.id).toMatch(BLOCK_ID_PATTERN);
    expect(block.type).toBe('heading');
    expect(block.props.level).toBe(2);
    expect(block.props.fontWeight).toBe(700);
  });

  it('sekce dostane prázdné pole potomků', () => {
    expect(createBlock('section').children).toEqual([]);
  });

  it('dvousloupcový blok dostane dva sloupce, třísloupcový tři', () => {
    expect(createBlock('columns').children).toHaveLength(2);
    expect(createBlock('columns', { layout: '1-1-1' }).children).toHaveLength(3);
    expect(createBlock('columns', { layout: '2-1-1' }).children).toHaveLength(3);
  });

  it('sloupce mají navzájem různé identifikátory', () => {
    const block = createBlock('columns');
    const ids = block.children!.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('položka palety s předvolbou ji vloží do vlastností', () => {
    const block = createFromPaletteEntry({
      id: 'columns-3', type: 'columns', label: 'block.columns3', icon: 'columns3',
      preset: { layout: '1-1-1' },
    });
    expect(block.props.layout).toBe('1-1-1');
    expect(block.children).toHaveLength(3);
  });

  it('neznámý typ vytvořit nejde', () => {
    expect(() => createBlock('carousel')).toThrow(/unknown block type/);
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/model/factory.test.ts`
Expected: FAIL, `Failed to resolve import "./factory"`.

- [ ] **Krok 3: Napiš implementaci**

```ts
// apps/web/src/features/editor/model/factory.ts
import { BLOCK_DESCRIPTORS, type PaletteEntry } from '../descriptors/registry';
import type { EditorBlock } from './document-types';
import { newBlockId } from './document-types';

const COLUMN_COUNT: Record<string, number> = {
  '1-1': 2, '1-2': 2, '2-1': 2, '1-1-1': 3, '2-1-1': 3, '1-1-2': 3,
};

export function createBlock(
  type: string,
  preset: Record<string, unknown> = {},
  gen: () => string = newBlockId,
): EditorBlock {
  const descriptor = BLOCK_DESCRIPTORS[type];
  if (!descriptor) throw new Error(`unknown block type: ${type}`);
  const block: EditorBlock = {
    id: gen(),
    type,
    props: structuredClone({ ...descriptor.defaults, ...preset }),
  };
  if (type === 'section' || type === 'column') block.children = [];
  if (type === 'columns') {
    const count = COLUMN_COUNT[String(block.props.layout)] ?? 2;
    block.children = Array.from({ length: count }, () => createBlock('column', {}, gen));
  }
  return block;
}

export function createFromPaletteEntry(entry: PaletteEntry, gen: () => string = newBlockId): EditorBlock {
  return createBlock(entry.type, entry.preset ?? {}, gen);
}
```

- [ ] **Krok 4: Spusť oba testy, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/model/factory.test.ts src/features/editor/descriptors/registry.schema.test.ts`
Expected: PASS. Když spadne test shody se schématem, **oprav descriptor, ne schéma**: schéma vlastní P08.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/model
git commit -m "feat(editor): create blocks from descriptor defaults"
```
---

### Úkol 10: Převod bohatého textu mezi modelem a Tiptapem

**Soubory:**
- Create: `apps/web/src/features/editor/model/richtext.ts`
- Create: `apps/web/src/features/editor/model/richtext.test.ts`

Model drží `RichText` jako omezený strom (3.1.5), Tiptap má svůj JSON. Převod je jediné místo, kde se ty dva tvary potkají. **Personalizace je v obou tvarech vlastní uzel**, nikdy text se závorkami, proto ji uživatel nemůže rozbít smazáním jedné závorky.

- [ ] **Krok 1: Napiš test**

```ts
// apps/web/src/features/editor/model/richtext.test.ts
import { describe, expect, it } from 'vitest';
import type { RichText } from './document-types';
import { richTextToTiptap, tiptapToRichText } from './richtext';

const sample: RichText = [
  { t: 'p', align: 'center', children: [
    { t: 's', v: 'Dobrý den, ' },
    { t: 'var', expr: 'contact.first_name_vocative', fallback: 'kolego' },
    { t: 's', v: ' a ', b: true, i: true },
    { t: 'a', href: 'https://shop.cz', trackable: true, children: [{ t: 's', v: 'nabídka' }] },
    { t: 'br' },
  ] },
  { t: 'ul', items: [[{ t: 's', v: 'první' }], [{ t: 's', v: 'druhá' }]] },
  { t: 'ol', items: [[{ t: 's', v: 'krok' }]] },
];

describe('richtext', () => {
  it('převede odstavec, zarovnání a značky', () => {
    const tiptap = richTextToTiptap(sample);
    expect(tiptap.type).toBe('doc');
    const paragraph = tiptap.content![0];
    expect(paragraph).toMatchObject({ type: 'paragraph', attrs: { align: 'center' } });
    expect(paragraph.content![2]).toMatchObject({
      type: 'text', text: ' a ', marks: [{ type: 'bold' }, { type: 'italic' }],
    });
  });

  it('personalizaci převede na vlastní uzel, ne na text', () => {
    const node = richTextToTiptap(sample).content![0].content![1];
    expect(node).toEqual({
      type: 'personalization',
      attrs: { expr: 'contact.first_name_vocative', fallback: 'kolego', dateFormat: null },
    });
  });

  it('odkaz převede na značku a zpět na uzel', () => {
    const back = tiptapToRichText(richTextToTiptap(sample));
    expect(back[0].children![3]).toEqual({
      t: 'a', href: 'https://shop.cz', trackable: true, children: [{ t: 's', v: 'nabídka' }] },
    );
  });

  it('sousední text pod jedním odkazem sloučí do jednoho uzlu', () => {
    const tiptap = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: 'https://x.cz', trackable: true } }] },
        { type: 'text', text: 'b', marks: [{ type: 'link', attrs: { href: 'https://x.cz', trackable: true } }, { type: 'bold' }] },
      ] }],
    };
    const rich = tiptapToRichText(tiptap);
    expect(rich[0].children).toEqual([
      { t: 'a', href: 'https://x.cz', trackable: true, children: [
        { t: 's', v: 'a' }, { t: 's', v: 'b', b: true },
      ] },
    ]);
  });

  it('okružní převod zachová dokument beze změny', () => {
    expect(tiptapToRichText(richTextToTiptap(sample))).toEqual(sample);
  });

  it('prázdný text dá jeden prázdný odstavec', () => {
    expect(tiptapToRichText({ type: 'doc', content: [] })).toEqual([{ t: 'p', children: [] }]);
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/model/richtext.test.ts`
Expected: FAIL, `Failed to resolve import "./richtext"`.

- [ ] **Krok 3: Napiš implementaci**

```ts
// apps/web/src/features/editor/model/richtext.ts
import type { InlineNode, RichNode, RichText } from './document-types';

type TiptapMark = { type: string; attrs?: Record<string, unknown> };
type TiptapNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  content?: TiptapNode[];
};

const MARK_BY_FLAG: Array<[keyof InlineNode & string, string]> = [
  ['b', 'bold'], ['i', 'italic'], ['u', 'underline'], ['strike', 'strike'],
];

function inlineToTiptap(node: InlineNode): TiptapNode[] {
  if (node.t === 'br') return [{ type: 'hardBreak' }];
  if (node.t === 'var') {
    return [{ type: 'personalization', attrs: {
      expr: node.expr, fallback: node.fallback ?? null, dateFormat: node.dateFormat ?? null,
    } }];
  }
  if (node.t === 'a') {
    const link: TiptapMark = { type: 'link', attrs: { href: node.href, trackable: node.trackable ?? true } };
    return node.children.flatMap((child) => inlineToTiptap(child).map((out) => (
      out.type === 'text' ? { ...out, marks: [link, ...(out.marks ?? [])] } : out
    )));
  }
  const marks = MARK_BY_FLAG.filter(([flag]) => node[flag] === true).map(([, type]) => ({ type }));
  const out: TiptapNode = { type: 'text', text: node.v };
  if (marks.length > 0) out.marks = marks;
  return [out];
}

function inlinesToTiptap(children: InlineNode[]): TiptapNode[] {
  return children.flatMap(inlineToTiptap);
}

export function richTextToTiptap(rich: RichText): TiptapNode {
  const content = rich.map((node): TiptapNode => {
    if (node.t === 'p') {
      const paragraph: TiptapNode = { type: 'paragraph', attrs: { align: node.align ?? null } };
      const inner = inlinesToTiptap(node.children);
      if (inner.length > 0) paragraph.content = inner;
      return paragraph;
    }
    const listType = node.t === 'ul' ? 'bulletList' : 'orderedList';
    return {
      type: listType,
      content: node.items.map((item) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', attrs: { align: null }, content: inlinesToTiptap(item) }],
      })),
    };
  });
  return { type: 'doc', content };
}

function tiptapInlines(nodes: TiptapNode[] = []): InlineNode[] {
  const out: InlineNode[] = [];
  for (const node of nodes) {
    if (node.type === 'hardBreak') { out.push({ t: 'br' }); continue; }
    if (node.type === 'personalization') {
      const item: InlineNode = { t: 'var', expr: String(node.attrs?.expr ?? '') };
      if (node.attrs?.fallback) item.fallback = String(node.attrs.fallback);
      if (node.attrs?.dateFormat) item.dateFormat = String(node.attrs.dateFormat) as InlineNode['dateFormat'];
      out.push(item);
      continue;
    }
    if (node.type !== 'text') continue;
    const link = node.marks?.find((mark) => mark.type === 'link');
    const text: InlineNode = { t: 's', v: node.text ?? '' };
    for (const [flag, type] of MARK_BY_FLAG) {
      if (node.marks?.some((mark) => mark.type === type)) (text as Record<string, unknown>)[flag] = true;
    }
    if (!link) { out.push(text); continue; }
    const href = String(link.attrs?.href ?? '');
    const trackable = link.attrs?.trackable !== false;
    const last = out[out.length - 1];
    if (last && last.t === 'a' && last.href === href && (last.trackable ?? true) === trackable) {
      last.children.push(text);
    } else {
      out.push({ t: 'a', href, trackable, children: [text] });
    }
  }
  return out;
}

export function tiptapToRichText(doc: TiptapNode): RichText {
  const nodes = (doc.content ?? []).map((node): RichNode | null => {
    if (node.type === 'paragraph') {
      const paragraph: RichNode = { t: 'p', children: tiptapInlines(node.content) };
      const align = node.attrs?.align;
      if (align && align !== 'left') (paragraph as { align?: string }).align = String(align);
      return paragraph;
    }
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      return {
        t: node.type === 'bulletList' ? 'ul' : 'ol',
        items: (node.content ?? []).map((item) => tiptapInlines(item.content?.[0]?.content)),
      } as RichNode;
    }
    return null;
  }).filter((node): node is RichNode => node !== null);
  return nodes.length > 0 ? nodes : [{ t: 'p', children: [] }];
}
```

- [ ] **Krok 4: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/model/richtext.test.ts`
Expected: PASS, 6 testů.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/model
git commit -m "feat(editor): convert rich text between document model and Tiptap"
```

---

### Úkol 11: Store editoru s výběrem a historií

**Soubory:**
- Create: `apps/web/src/features/editor/state/editor-store.ts`
- Create: `apps/web/src/features/editor/state/editor-store.test.ts`
- Create: `apps/web/src/features/editor/state/use-editor.ts`

- [ ] **Krok 1: Napiš test**

```ts
// apps/web/src/features/editor/state/editor-store.test.ts
import { describe, expect, it } from 'vitest';
import type { EditorDocument } from '../model/document-types';
import { createEditorStore } from './editor-store';

const doc = (): EditorDocument => ({
  schemaVersion: 1,
  meta: { name: 'T', previewText: '', language: 'cs' },
  theme: {},
  blocks: [{ id: 'b_s1', type: 'section', props: {}, children: [{ id: 'b_h1', type: 'heading', props: { level: 2 } }] }],
} as EditorDocument);

const gen = (() => { let n = 0; return () => `b_gen${String(n += 1).padStart(8, '0')}`; })();

describe('editor store', () => {
  it('začíná bez rozdělané změny a bez výběru', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    expect(store.getState().selectedId).toBeNull();
    expect(store.getState().isDirty).toBe(false);
  });

  it('oznámí odběratele při změně', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    let calls = 0;
    const stop = store.subscribe(() => { calls += 1; });
    store.select('b_h1');
    stop();
    store.select(null);
    expect(calls).toBe(1);
  });

  it('vloží blok, vybere ho a označí dokument za rozdělaný', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1', generateId: gen });
    const id = store.insertBlock('text', { parent: [0], index: 1 });
    expect(store.getState().selectedId).toBe(id);
    expect(store.getState().isDirty).toBe(true);
    expect(store.getState().document.blocks[0].children).toHaveLength(2);
  });

  it('vrátí a znovu provede poslední akci včetně výběru', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1', generateId: gen });
    store.select('b_h1');
    store.patchProps('b_h1', { level: 1 });
    store.undo();
    expect(store.getState().document.blocks[0].children![0].props.level).toBe(2);
    expect(store.getState().selectedId).toBe('b_h1');
    store.redo();
    expect(store.getState().document.blocks[0].children![0].props.level).toBe(1);
  });

  it('smazání jde vrátit i po změně výběru', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1', generateId: gen });
    store.removeBlock('b_h1');
    expect(store.getState().document.blocks[0].children).toHaveLength(0);
    store.undo();
    expect(store.getState().document.blocks[0].children![0].id).toBe('b_h1');
  });

  it('historie má strop a nejstarší krok zahazuje', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1', historyLimit: 3 });
    for (let i = 0; i < 5; i += 1) store.patchProps('b_h1', { level: (i % 3) + 1 });
    expect(store.getState().historyDepth).toBe(3);
  });

  it('po uložení zmizí rozdělaná změna a uloží se nový otisk', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    store.patchProps('b_h1', { level: 1 });
    store.markSaved('h2', 1_760_000_000_000);
    expect(store.getState().isDirty).toBe(false);
    expect(store.getState().designHash).toBe('h2');
    expect(store.getState().savedAt).toBe(1_760_000_000_000);
  });

  it('převzetí cizí verze při konfliktu vymaže historii', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    store.patchProps('b_h1', { level: 1 });
    store.replaceDocument(doc(), 'h9');
    expect(store.getState().historyDepth).toBe(0);
    expect(store.getState().isDirty).toBe(false);
    expect(store.getState().designHash).toBe('h9');
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/state/editor-store.test.ts`
Expected: FAIL, `Failed to resolve import "./editor-store"`.

- [ ] **Krok 3: Napiš implementaci**

```ts
// apps/web/src/features/editor/state/editor-store.ts
import { HISTORY_LIMIT } from '../config';
import { newBlockId } from '../model/document-types';
import type {
  EditorDocument, EditorIssue, Theme, VisibilityCondition,
} from '../model/document-types';
import { createBlock } from '../model/factory';
import { moveDelta, moveIn, moveOut } from '../model/moves';
import {
  countBlocks, duplicateBlock, insertBlock, type MoveTarget, moveBlock, patchProps, removeBlock,
  setVisibility,
} from '../model/ops';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

/** Typ nálezu se tady nedefinuje, bydlí v `model/document-types.ts` (úkol 1). */
export type { EditorIssue };

export type EditorState = {
  document: EditorDocument;
  selectedId: string | null;
  designHash: string;
  savedAt: number | null;
  status: SaveStatus;
  issues: EditorIssue[];
  isDirty: boolean;
  historyDepth: number;
  blockCount: number;
};

type Snapshot = { document: EditorDocument; selectedId: string | null };

export type EditorStore = ReturnType<typeof createEditorStore>;

export function createEditorStore(input: {
  document: EditorDocument;
  designHash: string;
  historyLimit?: number;
  generateId?: () => string;
}) {
  const historyLimit = input.historyLimit ?? HISTORY_LIMIT;
  const generateId = input.generateId ?? newBlockId;
  const listeners = new Set<() => void>();
  let past: Snapshot[] = [];
  let future: Snapshot[] = [];
  let savedDocument = input.document;

  let state: EditorState = {
    document: input.document,
    selectedId: null,
    designHash: input.designHash,
    savedAt: null,
    status: 'idle',
    issues: [],
    isDirty: false,
    historyDepth: 0,
    blockCount: countBlocks(input.document),
  };

  const emit = () => { listeners.forEach((listener) => listener()); };

  const set = (patch: Partial<EditorState>) => {
    const next = { ...state, ...patch };
    next.isDirty = next.document !== savedDocument;
    next.historyDepth = past.length;
    next.blockCount = countBlocks(next.document);
    state = next;
    emit();
  };

  const mutate = (
    change: (document: EditorDocument) => { document: EditorDocument; selectedId?: string | null } | null,
  ) => {
    const result = change(state.document);
    if (!result) return null;
    past = [...past, { document: state.document, selectedId: state.selectedId }].slice(-historyLimit);
    future = [];
    set({ document: result.document, selectedId: result.selectedId ?? state.selectedId });
    return result;
  };

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    select(id: string | null) { set({ selectedId: id }); },

    insertBlock(type: string, target: MoveTarget, preset: Record<string, unknown> = {}) {
      const block = createBlock(type, preset, generateId);
      mutate((document) => ({
        document: insertBlock(document, target.parent, target.index, block),
        selectedId: block.id,
      }));
      return block.id;
    },
    removeBlock(id: string) {
      mutate((document) => {
        const result = removeBlock(document, id);
        return result ? { document: result.doc, selectedId: null } : null;
      });
    },
    duplicateBlock(id: string) {
      let newId: string | null = null;
      mutate((document) => {
        const result = duplicateBlock(document, id, generateId);
        if (!result) return null;
        newId = result.newId;
        return { document: result.doc, selectedId: result.newId };
      });
      return newId;
    },
    moveBlock(id: string, target: MoveTarget) {
      return mutate((document) => {
        const next = moveBlock(document, id, target);
        return next ? { document: next, selectedId: id } : null;
      }) !== null;
    },
    moveByKeyboard(id: string, direction: 'up' | 'down' | 'out' | 'in') {
      const document = state.document;
      const target = direction === 'up' ? moveDelta(document, id, -1)
        : direction === 'down' ? moveDelta(document, id, 1)
        : direction === 'out' ? moveOut(document, id)
        : moveIn(document, id);
      if (!target) return false;
      return this.moveBlock(id, target);
    },
    patchProps(id: string, patch: Record<string, unknown>) {
      mutate((document) => ({ document: patchProps(document, id, patch) }));
    },
    setVisibility(id: string, condition: VisibilityCondition | null) {
      mutate((document) => ({ document: setVisibility(document, id, condition) }));
    },
    patchTheme(patch: Partial<Theme>) {
      mutate((document) => ({ document: { ...document, theme: { ...document.theme, ...patch } } }));
    },
    patchMeta(patch: Record<string, unknown>) {
      mutate((document) => ({ document: { ...document, meta: { ...document.meta, ...patch } } }));
    },

    undo() {
      const previous = past[past.length - 1];
      if (!previous) return;
      past = past.slice(0, -1);
      future = [{ document: state.document, selectedId: state.selectedId }, ...future];
      set({ document: previous.document, selectedId: previous.selectedId });
    },
    redo() {
      const next = future[0];
      if (!next) return;
      future = future.slice(1);
      past = [...past, { document: state.document, selectedId: state.selectedId }].slice(-historyLimit);
      set({ document: next.document, selectedId: next.selectedId });
    },

    setStatus(status: SaveStatus) { set({ status }); },
    setIssues(issues: EditorIssue[]) { set({ issues }); },
    markSaved(designHash: string, at: number) {
      savedDocument = state.document;
      set({ designHash, savedAt: at, status: 'saved' });
    },
    replaceDocument(document: EditorDocument, designHash: string) {
      past = [];
      future = [];
      savedDocument = document;
      set({ document, designHash, selectedId: null, status: 'idle' });
    },
  };
}
```

```tsx
// apps/web/src/features/editor/state/use-editor.ts
'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { EditorState, EditorStore } from './editor-store';

const StoreContext = createContext<EditorStore | null>(null);

export const EditorStoreProvider = StoreContext.Provider;

export function useEditorStore(): EditorStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useEditorStore must be used inside EditorStoreProvider');
  return store;
}

export function useEditorState<T>(selector: (state: EditorState) => T): T {
  const store = useEditorStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}
```

- [ ] **Krok 4: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/state/editor-store.test.ts`
Expected: PASS, 8 testů.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/state
git commit -m "feat(editor): add editor store with selection and undo history"
```

---

### Úkol 12: Vrstva portů

**Soubory:**
- Create: `apps/web/src/features/editor/ports/types.ts`, `http-ports.ts`, `fake-ports.ts`
- Create: `apps/web/src/features/editor/ports/http-ports.test.ts`

Editor nikde nevolá `fetch` přímo. Díky tomu jde celý otestovat bez běžícího backendu a plán není rukojmím toho, jestli P08 doručil endpoint.

- [ ] **Krok 1: Napiš test**

```ts
// apps/web/src/features/editor/ports/http-ports.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createHttpPorts } from './http-ports';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('http ports', () => {
  it('uloží dokument s optimistickým zámkem', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ design_hash: 'h2', updated_at: '2026-07-31T12:00:00Z' }));
    const ports = createHttpPorts({ baseUrl: '/api/v1', fetch: fetchMock });
    const result = await ports.save({ templateId: 't1', document: { blocks: [] } as never, ifDesignHash: 'h1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/templates/t1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toMatchObject({ if_design_hash: 'h1' });
    expect(result).toEqual({ ok: true, designHash: 'h2', updatedAt: '2026-07-31T12:00:00Z' });
  });

  it('z odpovědi 412 udělá konflikt s cizí verzí', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({ code: 'precondition_failed', design: { blocks: [] }, design_hash: 'h9' }, 412),
    );
    const ports = createHttpPorts({ baseUrl: '/api/v1', fetch: fetchMock });
    const result = await ports.save({ templateId: 't1', document: { blocks: [] } as never, ifDesignHash: 'h1' });
    expect(result).toEqual({ ok: false, conflict: true, document: { blocks: [] }, designHash: 'h9' });
  });

  it('když 412 aktuální verzi nenese, dotáhne ji, místo aby vrátila prázdno', async () => {
    // Dnešní obálka chyby je RFC 9457 bez `design`. Kdyby se port spolehl na to,
    // že tam je, konflikt by nesl `undefined` a tlačítko „Načíst novou verzi"
    // by uživateli šablonu vymazalo. Požadavek P08-R3 to má doplnit; do té doby
    // se aktuální stav dotáhne samostatným GET.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ code: 'precondition_failed', detail: 'changed' }, 412))
      .mockResolvedValueOnce(json({ design: { blocks: ['cizi'] }, design_hash: 'h9' }, 200));
    const ports = createHttpPorts({ baseUrl: '/api/v1', fetch: fetchMock });
    const result = await ports.save({ templateId: 't1', document: { blocks: [] } as never, ifDesignHash: 'h1' });
    expect(fetchMock.mock.calls[1][1].method).toBe('GET');
    expect(result).toEqual({ ok: false, conflict: true, document: { blocks: ['cizi'] }, designHash: 'h9' });
  });

  it('vytvoření šablony pošle jméno i dokument a vrátí id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ id: 'tmpl-9', name: 'Nová šablona' }, 201));
    const ports = createHttpPorts({ baseUrl: '/api/v1', fetch: fetchMock });
    const result = await ports.createTemplate({ name: 'Nová šablona', document: { blocks: [] } as never });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/templates');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({ name: 'Nová šablona', kind: 'campaign' });
    expect(result).toEqual({ id: 'tmpl-9' });
  });

  it('u testovacího odeslání vrátí kód i dobu čekání', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ code: 'rate_limited', retry_after: 900 }, 429));
    const ports = createHttpPorts({ baseUrl: '/api/v1', fetch: fetchMock });
    const result = await ports.testSend({
      templateId: 't1', recipients: ['a@b.cz'], addTestPrefix: true, previewData: { type: 'sample' },
    });
    expect(result).toEqual({ ok: false, code: 'rate_limited', retryAfter: 900, requestId: undefined });
  });

  it('neznámou chybu předá i s request_id, aby ji šlo zobrazit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({ code: 'teapot', detail: 'Nefunguje to.', request_id: 'req-1' }, 500),
    );
    const ports = createHttpPorts({ baseUrl: '/api/v1', fetch: fetchMock });
    await expect(ports.preview({ templateId: 't1', previewData: { type: 'sample' } }))
      .rejects.toMatchObject({ code: 'teapot', detail: 'Nefunguje to.', requestId: 'req-1' });
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/ports/http-ports.test.ts`
Expected: FAIL, `Failed to resolve import "./http-ports"`.

- [ ] **Krok 3: Napiš typy a implementaci**

```ts
// apps/web/src/features/editor/ports/types.ts
import type { EditorDocument } from '../model/document-types';

export type PreviewData =
  | { type: 'sample'; variant?: 'default' | 'no_name' }
  | { type: 'contact'; contactId: string };

export type SaveResult =
  | { ok: true; designHash: string; updatedAt: string }
  | { ok: false; conflict: true; document: EditorDocument; designHash: string };

export type PreviewResult = { html: string; text: string };

export type Finding = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  pointer?: string;
  block_id?: string;
  params?: Record<string, string | number>;
};

export type ContactSummary = { id: string; email: string; name: string };
export type AssetSummary = { id: string; url: string; name: string; width: number; height: number };

export class PortError extends Error {
  constructor(
    public readonly code: string,
    public readonly detail: string,
    public readonly requestId?: string,
    public readonly status?: number,
  ) {
    super(detail || code);
    this.name = 'PortError';
  }
}

export type EditorPorts = {
  /** `POST /api/v1/templates`. Vrací 201 s tělem šablony, z něhož editor potřebuje jen id. */
  createTemplate(input: { name: string; document: EditorDocument }): Promise<{ id: string }>;
  save(input: { templateId: string; document: EditorDocument; ifDesignHash: string }): Promise<SaveResult>;
  /**
   * Tmavý režim se **neposílá**. Náhled tmavého režimu kreslí komponenta K6
   * v prohlížeči přes `color-scheme` a barvy v `srcdoc`; server o něm nic neví
   * a jeho endpoint takový parametr nepřijímá. Kdyby se posílal, byl by to
   * okružní čas navíc při každém přepnutí přepínače, a to za nic.
   */
  preview(input: { templateId: string; previewData: PreviewData }): Promise<PreviewResult>;
  validate(input: { templateId: string }): Promise<{ findings: Finding[] }>;
  testSend(input: {
    templateId: string; recipients: string[]; addTestPrefix: boolean; previewData: PreviewData;
  }): Promise<{ ok: true } | { ok: false; code: string; retryAfter?: number; requestId?: string }>;
  searchContacts(query: string): Promise<ContactSummary[]>;
  randomContact(): Promise<ContactSummary | null>;
  listAssets(query?: string): Promise<AssetSummary[]>;
  uploadAsset(file: File): Promise<AssetSummary>;
};
```

```ts
// apps/web/src/features/editor/ports/http-ports.ts
import type {
  AssetSummary, ContactSummary, EditorPorts, Finding, PreviewData, PreviewResult, SaveResult,
} from './types';
import { PortError } from './types';

type Json = Record<string, unknown>;

export function createHttpPorts(options: {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}): EditorPorts {
  const baseUrl = options.baseUrl ?? '/api/v1';
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  const call = async (path: string, init: RequestInit): Promise<{ status: number; body: Json }> => {
    const response = await doFetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    const body = (await response.json().catch(() => ({}))) as Json;
    return { status: response.status, body };
  };

  const fail = (body: Json, status: number): never => {
    throw new PortError(
      String(body.code ?? 'unknown_error'),
      String(body.detail ?? ''),
      body.request_id ? String(body.request_id) : undefined,
      status,
    );
  };

  const ports: EditorPorts = {
    async createTemplate({ name, document }): Promise<{ id: string }> {
      const { status, body } = await call('/templates', {
        method: 'POST',
        body: JSON.stringify({ name, kind: 'campaign', document }),
      });
      if (status >= 400) fail(body, status);
      return { id: String(body.id) };
    },

    async save({ templateId, document, ifDesignHash }): Promise<SaveResult> {
      const { status, body } = await call(`/templates/${templateId}`, {
        method: 'PATCH',
        body: JSON.stringify({ design: document, if_design_hash: ifDesignHash }),
      });
      if (status === 412) {
        // Tělo odpovědi 412 je dnes obálka RFC 9457 **bez** aktuálního dokumentu:
        // vrací `type`, `title`, `status`, `detail`, `code`, `request_id`, nic víc.
        // Požadavek P08-R3 chce doplnit `design` a `design_hash`, ale spoléhat se
        // na to nejde: bez nich by konflikt nesl prázdný dokument a nabídka
        // „načíst novou verzi" by šablonu vymazala. Když v těle nejsou, dotáhne
        // se aktuální stav samostatným GET.
        if (body.design !== undefined && body.design_hash !== undefined) {
          return {
            ok: false, conflict: true,
            document: body.design as never,
            designHash: String(body.design_hash),
          };
        }
        const current = await call(`/templates/${templateId}`, { method: 'GET' });
        if (current.status >= 400) fail(current.body, current.status);
        return {
          ok: false, conflict: true,
          document: current.body.design as never,
          designHash: String(current.body.design_hash ?? ''),
        };
      }
      if (status >= 400) fail(body, status);
      return { ok: true, designHash: String(body.design_hash), updatedAt: String(body.updated_at) };
    },

    async preview({ templateId, previewData }): Promise<PreviewResult> {
      // `preview_data` je požadavek P08-R2. Endpoint dnes bere jen `render_data`
      // s hotovými daty a jinak sáhne po jedné vzorové sadě, takže varianta
      // `no_name` z kritéria 55 zatím projde jen přes dvojníka portů.
      const { status, body } = await call(`/templates/${templateId}/preview`, {
        method: 'POST',
        body: JSON.stringify({ preview_data: toSnake(previewData) }),
      });
      if (status >= 400) fail(body, status);
      return { html: String(body.html ?? ''), text: String(body.text ?? '') };
    },

    async validate({ templateId }): Promise<{ findings: Finding[] }> {
      const { status, body } = await call(`/templates/${templateId}/validate`, { method: 'POST', body: '{}' });
      if (status >= 400 && status !== 409 && status !== 422) fail(body, status);
      return { findings: (body.findings as Finding[]) ?? [] };
    },

    async testSend({ templateId, recipients, addTestPrefix, previewData }) {
      const { status, body } = await call(`/templates/${templateId}/test-send`, {
        method: 'POST',
        body: JSON.stringify({
          recipients, add_test_prefix: addTestPrefix, preview_data: toSnake(previewData),
        }),
      });
      if (status >= 400) {
        return {
          ok: false,
          code: String(body.code ?? 'unknown_error'),
          retryAfter: typeof body.retry_after === 'number' ? body.retry_after : undefined,
          requestId: body.request_id ? String(body.request_id) : undefined,
        };
      }
      return { ok: true };
    },

    async searchContacts(query: string): Promise<ContactSummary[]> {
      const { status, body } = await call(`/contacts?q=${encodeURIComponent(query)}&limit=10`, { method: 'GET' });
      if (status >= 400) fail(body, status);
      return ((body.data as Json[]) ?? []).map(toContact);
    },

    async randomContact(): Promise<ContactSummary | null> {
      const { status, body } = await call('/contacts?order=random&limit=1', { method: 'GET' });
      if (status >= 400) fail(body, status);
      const first = ((body.data as Json[]) ?? [])[0];
      return first ? toContact(first) : null;
    },

    async listAssets(query = ''): Promise<AssetSummary[]> {
      const { status, body } = await call(`/assets?q=${encodeURIComponent(query)}&limit=50`, { method: 'GET' });
      if (status >= 400) fail(body, status);
      return ((body.data as Json[]) ?? []).map((item) => ({
        id: String(item.id), url: String(item.url), name: String(item.file_name ?? ''),
        width: Number(item.width ?? 0), height: Number(item.height ?? 0),
      }));
    },

    async uploadAsset(file: File): Promise<AssetSummary> {
      const form = new FormData();
      form.append('file', file);
      const response = await doFetch(`${baseUrl}/assets`, { method: 'POST', body: form });
      const body = (await response.json().catch(() => ({}))) as Json;
      if (response.status >= 400) fail(body, response.status);
      return {
        id: String(body.id), url: String(body.url), name: String(body.file_name ?? file.name),
        width: Number(body.width ?? 0), height: Number(body.height ?? 0),
      };
    },
  };

  return ports;
}

function toContact(item: Json): ContactSummary {
  const first = String(item.first_name ?? '');
  const last = String(item.last_name ?? '');
  return { id: String(item.id), email: String(item.email), name: `${first} ${last}`.trim() };
}

function toSnake(data: PreviewData): Json {
  return data.type === 'contact'
    ? { type: 'contact', contact_id: data.contactId }
    : { type: 'sample', variant: data.variant ?? 'default' };
}
```

```ts
// apps/web/src/features/editor/ports/fake-ports.ts
import type { EditorDocument } from '../model/document-types';
import type { EditorPorts } from './types';

/** Dvojník pro jednotkové testy a pro Playwright, když backend neběží. */
export function createFakePorts(overrides: Partial<EditorPorts> = {}): EditorPorts {
  let hash = 'h1';
  let stored: EditorDocument | null = null;
  let created = 0;
  return {
    async createTemplate() {
      created += 1;
      return { id: `tmpl-${created}` };
    },
    async save({ document }) {
      stored = document;
      hash = `h${Number(hash.slice(1)) + 1}`;
      return { ok: true, designHash: hash, updatedAt: new Date().toISOString() };
    },
    async preview({ previewData }) {
      const name = previewData.type === 'sample' && previewData.variant === 'no_name' ? '' : 'Jana';
      return {
        html: `<html lang="cs"><body><p>Dobrý den, ${name || 'zákazníku'}</p></body></html>`,
        text: `Dobrý den, ${name || 'zákazníku'}`,
      };
    },
    async validate() { return { findings: [] }; },
    async testSend() { return { ok: true }; },
    async searchContacts() { return [{ id: 'c1', email: 'jana@example.cz', name: 'Jana Nováková' }]; },
    async randomContact() { return { id: 'c2', email: 'petr@example.cz', name: 'Petr Svoboda' }; },
    async listAssets() {
      return [{ id: 'a1', url: '/a/demo/w600.png', name: 'logo.png', width: 600, height: 200 }];
    },
    async uploadAsset(file) {
      return { id: 'a2', url: '/a/upload/w600.png', name: file.name, width: 600, height: 200 };
    },
    ...overrides,
    __stored: () => stored,
  } as EditorPorts;
}
```

- [ ] **Krok 4: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/ports/http-ports.test.ts`
Expected: PASS, 6 testů.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/ports
git commit -m "feat(editor): add editor ports with HTTP and fake implementations"
```

---

### Úkol 13: Automatické ukládání, optimistický zámek a pojistka při odchodu

**Soubory:**
- Create: `apps/web/src/features/editor/autosave/use-autosave.ts`
- Create: `apps/web/src/features/editor/autosave/use-autosave.test.tsx`
- Create: `apps/web/src/features/editor/autosave/use-unload-guard.ts`

Stav ukládání se zobrazuje **v hlavičce, nikdy toastem**: ukládá se nepřetržitě a toast by se objevoval každé dvě sekundy (část 6, 8.5.1).

- [ ] **Krok 1: Napiš test**

```tsx
// apps/web/src/features/editor/autosave/use-autosave.test.tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorDocument } from '../model/document-types';
import { createFakePorts } from '../ports/fake-ports';
import { createEditorStore } from '../state/editor-store';
import { useAutosave } from './use-autosave';

const doc = (): EditorDocument => ({
  schemaVersion: 1, meta: { name: 'T', previewText: '', language: 'cs' }, theme: {},
  blocks: [{ id: 'b_s1', type: 'section', props: {}, children: [{ id: 'b_h1', type: 'heading', props: {} }] }],
} as EditorDocument);

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); });

describe('useAutosave', () => {
  it('uloží až po prodlevě a nejvýš jednou za sérii úprav', async () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    const ports = createFakePorts();
    const save = vi.spyOn(ports, 'save');
    renderHook(() => useAutosave({ store, ports, templateId: 't1' }));

    act(() => { store.patchProps('b_h1', { level: 1 }); });
    act(() => { store.patchProps('b_h1', { level: 3 }); });
    expect(save).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(save).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(store.getState().status).toBe('saved'));
    expect(store.getState().isDirty).toBe(false);
  });

  it('při konfliktu přepne stav na conflict a dokument nepřepíše', async () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    const ports = createFakePorts({
      save: async () => ({ ok: false, conflict: true, document: doc(), designHash: 'h9' }),
    });
    renderHook(() => useAutosave({ store, ports, templateId: 't1' }));
    act(() => { store.patchProps('b_h1', { level: 1 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    await waitFor(() => expect(store.getState().status).toBe('conflict'));
    expect(store.getState().document.blocks[0].children![0].props.level).toBe(1);
  });

  it('po chybě to zkusí znovu a stav je error, ne ticho', async () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    let calls = 0;
    const ports = createFakePorts({
      save: async () => {
        calls += 1;
        if (calls === 1) throw new Error('offline');
        return { ok: true, designHash: 'h2', updatedAt: '2026-07-31T12:00:00Z' };
      },
    });
    renderHook(() => useAutosave({ store, ports, templateId: 't1' }));
    act(() => { store.patchProps('b_h1', { level: 1 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    await waitFor(() => expect(store.getState().status).toBe('error'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await waitFor(() => expect(store.getState().status).toBe('saved'));
    expect(calls).toBe(2);
  });

  it('flush uloží okamžitě, používá ho náhled a testovací odeslání', async () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    const ports = createFakePorts();
    const save = vi.spyOn(ports, 'save');
    const { result } = renderHook(() => useAutosave({ store, ports, templateId: 't1' }));
    act(() => { store.patchProps('b_h1', { level: 1 }); });
    await act(async () => { await result.current.flush(); });
    expect(save).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/autosave/use-autosave.test.tsx`
Expected: FAIL, `Failed to resolve import "./use-autosave"`.

- [ ] **Krok 3: Napiš implementaci**

```ts
// apps/web/src/features/editor/autosave/use-autosave.ts
'use client';

import { useCallback, useEffect, useRef } from 'react';
import { AUTOSAVE_DEBOUNCE_MS } from '../config';
import type { EditorPorts } from '../ports/types';
import type { EditorStore } from '../state/editor-store';

const RETRY_MS = 5000;

export function useAutosave(input: {
  store: EditorStore;
  ports: EditorPorts;
  templateId: string;
  onConflict?: (document: unknown, designHash: string) => void;
}) {
  const { store, ports, templateId, onConflict } = input;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);

  const persist = useCallback(async () => {
    const state = store.getState();
    if (!state.isDirty || running.current) return;
    running.current = true;
    store.setStatus('saving');
    try {
      const result = await ports.save({
        templateId,
        document: state.document,
        ifDesignHash: state.designHash,
      });
      if (result.ok) {
        store.markSaved(result.designHash, Date.parse(result.updatedAt) || Date.now());
      } else {
        store.setStatus('conflict');
        onConflict?.(result.document, result.designHash);
      }
    } catch {
      store.setStatus('error');
      timer.current = setTimeout(() => { void persist(); }, RETRY_MS);
    } finally {
      running.current = false;
    }
  }, [onConflict, ports, store, templateId]);

  useEffect(() => store.subscribe(() => {
    if (!store.getState().isDirty) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persist(); }, AUTOSAVE_DEBOUNCE_MS);
  }), [persist, store]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await persist();
  }, [persist]);

  return { flush };
}
```

```ts
// apps/web/src/features/editor/autosave/use-unload-guard.ts
'use client';

import { useEffect } from 'react';
import { UNLOAD_GUARD_MS } from '../config';
import type { EditorStore } from '../state/editor-store';

/**
 * Kritérium 7 části 6: dialog při odchodu se ukáže jen tehdy, když je neuložená změna mladší
 * než dvě sekundy, tedy dokud ji autosave nestihl odeslat. Jinak se neukazuje nikdy,
 * protože varování u operace, která na odchodu nezávisí, naučí uživatele zavírat všechna varování.
 */
export function useUnloadGuard(store: EditorStore, now: () => number = Date.now) {
  useEffect(() => {
    let dirtySince: number | null = null;
    const stop = store.subscribe(() => {
      const state = store.getState();
      if (state.isDirty && dirtySince === null) dirtySince = now();
      if (!state.isDirty) dirtySince = null;
    });
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtySince !== null && now() - dirtySince < UNLOAD_GUARD_MS) event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => { stop(); window.removeEventListener('beforeunload', onBeforeUnload); };
  }, [now, store]);
}
```

- [ ] **Krok 4: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/autosave/use-autosave.test.tsx`
Expected: PASS, 4 testy.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/autosave
git commit -m "feat(editor): add debounced autosave with optimistic lock and unload guard"
```

---

### Úkol 14: Registr operací a pojistka rovnocennosti myši a klávesnice

**Soubory:**
- Create: `apps/web/src/features/editor/keyboard/operations.ts`
- Create: `apps/web/src/features/editor/keyboard/operations.test.ts`

Část 6, 8.5.1, bod 4 žádá: **každá operace dostupná tažením musí být dostupná z klávesnice a žádná operace nesmí být jen v kontextové nabídce myši.** Slib bez vynucení je přání, ne ochrana, takže je operace jeden datový záznam a test hlídá, že má obojí.

- [ ] **Krok 1: Napiš test**

```ts
// apps/web/src/features/editor/keyboard/operations.test.ts
import { describe, expect, it } from 'vitest';
import { matchOperation, OPERATIONS, TOOLBAR_OPERATIONS } from './operations';

describe('registr operací', () => {
  it('každá operace má aspoň jednu klávesovou zkratku', () => {
    for (const operation of OPERATIONS) {
      expect(operation.keys.length, operation.id).toBeGreaterThan(0);
    }
  });

  it('každá operace v ovládání bloku má ikonu i zkratku, takže myš a klávesnice umí totéž', () => {
    for (const operation of TOOLBAR_OPERATIONS) {
      expect(operation.icon, operation.id).toBeDefined();
      expect(operation.keys.length, operation.id).toBeGreaterThan(0);
    }
    expect(TOOLBAR_OPERATIONS.map((o) => o.id)).toEqual(
      ['move-up', 'move-down', 'move-out', 'move-in', 'duplicate', 'delete'],
    );
  });

  it('každá deklarovaná zkratka se rozpozná zpátky na svou operaci', () => {
    for (const operation of OPERATIONS) {
      for (const key of operation.keys) {
        const parts = key.split('+');
        const event = {
          key: parts[parts.length - 1],
          altKey: parts.includes('Alt'),
          shiftKey: parts.includes('Shift'),
          ctrlKey: parts.includes('Mod'),
          metaKey: false,
        };
        expect(matchOperation(event), key).toBe(operation.id);
      }
    }
  });

  it('přesun je na Alt se šipkami a Ctrl je alias, obojí ze specifikace', () => {
    expect(matchOperation({ key: 'ArrowUp', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false }))
      .toBe('move-up');
    expect(matchOperation({ key: 'ArrowUp', altKey: false, ctrlKey: true, metaKey: false, shiftKey: false }))
      .toBe('move-up');
    expect(matchOperation({ key: 'ArrowRight', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false }))
      .toBe('move-in');
  });

  it('holá šipka posouvá výběr, ne blok', () => {
    expect(matchOperation({ key: 'ArrowDown', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }))
      .toBe('select-next');
  });

  it('neznámá kombinace se nerozpozná a nechá událost projít dál', () => {
    expect(matchOperation({ key: 'F5', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }))
      .toBeNull();
  });

  it('popisky operací jsou navzájem různé překladové klíče', () => {
    const labels = OPERATIONS.map((o) => o.labelKey);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/keyboard/operations.test.ts`
Expected: FAIL, `Failed to resolve import "./operations"`.

- [ ] **Krok 3: Napiš implementaci**

```ts
// apps/web/src/features/editor/keyboard/operations.ts
import type { I18nKey } from '../descriptors/types';

export type OperationId =
  | 'move-up' | 'move-down' | 'move-out' | 'move-in'
  | 'duplicate' | 'delete' | 'insert-after' | 'edit'
  | 'select-prev' | 'select-next' | 'select-parent' | 'select-child'
  | 'undo' | 'redo' | 'escape';

export type EditorOperation = {
  id: OperationId;
  labelKey: I18nKey;
  /** Zápis kláves. `Mod` je Ctrl nebo Cmd. */
  keys: string[];
  /** true = má tlačítko v ovládání bloku, tedy je dostupná i myší. */
  inToolbar: boolean;
  icon?: 'arrow-up' | 'arrow-down' | 'arrow-left' | 'arrow-right' | 'copy' | 'trash';
};

export const OPERATIONS: EditorOperation[] = [
  { id: 'move-up', labelKey: 'op.moveUp', keys: ['Alt+ArrowUp', 'Mod+ArrowUp'], inToolbar: true, icon: 'arrow-up' },
  { id: 'move-down', labelKey: 'op.moveDown', keys: ['Alt+ArrowDown', 'Mod+ArrowDown'], inToolbar: true, icon: 'arrow-down' },
  { id: 'move-out', labelKey: 'op.moveOut', keys: ['Alt+ArrowLeft'], inToolbar: true, icon: 'arrow-left' },
  { id: 'move-in', labelKey: 'op.moveIn', keys: ['Alt+ArrowRight'], inToolbar: true, icon: 'arrow-right' },
  { id: 'duplicate', labelKey: 'op.duplicate', keys: ['Mod+d'], inToolbar: true, icon: 'copy' },
  { id: 'delete', labelKey: 'op.delete', keys: ['Delete', 'Backspace'], inToolbar: true, icon: 'trash' },
  { id: 'insert-after', labelKey: 'op.insertAfter', keys: ['Mod+Enter'], inToolbar: false },
  { id: 'edit', labelKey: 'op.edit', keys: ['Enter'], inToolbar: false },
  { id: 'select-prev', labelKey: 'op.selectPrev', keys: ['ArrowUp'], inToolbar: false },
  { id: 'select-next', labelKey: 'op.selectNext', keys: ['ArrowDown'], inToolbar: false },
  { id: 'select-parent', labelKey: 'op.selectParent', keys: ['ArrowLeft'], inToolbar: false },
  { id: 'select-child', labelKey: 'op.selectChild', keys: ['ArrowRight'], inToolbar: false },
  { id: 'undo', labelKey: 'op.undo', keys: ['Mod+z'], inToolbar: false },
  { id: 'redo', labelKey: 'op.redo', keys: ['Mod+Shift+z'], inToolbar: false },
  { id: 'escape', labelKey: 'op.escape', keys: ['Escape'], inToolbar: false },
];

export const TOOLBAR_OPERATIONS = OPERATIONS.filter((operation) => operation.inToolbar);

export type KeyEventLike = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

function normalize(event: KeyEventLike): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key);
  return parts.join('+');
}

const BY_KEY = new Map<string, OperationId>();
for (const operation of OPERATIONS) {
  for (const key of operation.keys) BY_KEY.set(key, operation.id);
}

export function matchOperation(event: KeyEventLike): OperationId | null {
  return BY_KEY.get(normalize(event)) ?? null;
}
```

- [ ] **Krok 4: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/keyboard/operations.test.ts`
Expected: PASS, 7 testů.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/keyboard
git commit -m "feat(editor): add operation registry enforcing pointer and keyboard parity"
```

---

### Úkol 15: Provedení operace a oznámení nové pozice čtečce

**Soubory:**
- Create: `apps/web/src/features/editor/keyboard/run-operation.ts`
- Create: `apps/web/src/features/editor/keyboard/run-operation.test.ts`
- Create: `apps/web/src/features/editor/keyboard/use-canvas-keyboard.ts`

Kritérium 54 části 6 zní doslova: po přesunu z klávesnice se čtečce ohlásí nová pozice ve tvaru „Nadpis, pozice 3 z 7". Bez toho je klávesová cesta formálně splněná a prakticky nepoužitelná.

- [ ] **Krok 1: Napiš test**

```ts
// apps/web/src/features/editor/keyboard/run-operation.test.ts
import { describe, expect, it } from 'vitest';
import type { EditorDocument } from '../model/document-types';
import { createEditorStore } from '../state/editor-store';
import { runOperation } from './run-operation';

const doc = (): EditorDocument => ({
  schemaVersion: 1, meta: { name: 'T', previewText: '', language: 'cs' }, theme: {},
  blocks: [{ id: 'b_s1', type: 'section', props: {}, children: [
    { id: 'b_h1', type: 'heading', props: {} },
    { id: 'b_t1', type: 'text', props: {} },
    { id: 'b_c1', type: 'columns', props: {}, children: [
      { id: 'b_col1', type: 'column', props: {}, children: [] },
      { id: 'b_col2', type: 'column', props: {}, children: [] },
    ] },
  ] }],
} as EditorDocument);

const store = () => {
  const s = createEditorStore({ document: doc(), designHash: 'h1' });
  s.select('b_h1');
  return s;
};

describe('runOperation', () => {
  it('posun dolů oznámí typ bloku a novou pozici, kritérium 54', () => {
    const s = store();
    const result = runOperation(s, 'move-down');
    expect(result.announce).toEqual({
      key: 'a11y.blockMoved', params: { block: 'block.heading', position: 2, total: 3 },
    });
    expect(s.getState().document.blocks[0].children!.map((b) => b.id)).toEqual(['b_t1', 'b_h1', 'b_c1']);
  });

  it('na kraji úrovně oznámí důrazně, že dál to nejde, a dokument nezmění', () => {
    const s = store();
    const before = s.getState().document;
    const result = runOperation(s, 'move-up');
    // `tone: 'assertive'` není kosmetika. Zdvořilá oblast oznámení zařadí za
    // to, co čtečka právě čte, takže uživatel na kraji seznamu mačká klávesu
    // dál a nedozví se, že narazil.
    expect(result.announce).toEqual({
      key: 'a11y.moveBlocked', params: { block: 'block.heading' }, tone: 'assertive',
    });
    expect(s.getState().document).toBe(before);
  });

  it('úspěšný přesun se hlásí zdvořile, aby nepřerušil čtení', () => {
    const s = store();
    expect(runOperation(s, 'move-down').announce?.tone).toBeUndefined();
  });

  it('zasunutí do sloupce oznámí pozici uvnitř sloupce', () => {
    const s = store();
    s.select('b_t1');
    const result = runOperation(s, 'move-in');
    expect(result.announce).toEqual({
      key: 'a11y.blockMoved', params: { block: 'block.text', position: 1, total: 1 },
    });
  });

  it('duplikace vybere kopii a oznámí to', () => {
    const s = store();
    const result = runOperation(s, 'duplicate');
    expect(s.getState().selectedId).not.toBe('b_h1');
    expect(result.announce?.key).toBe('a11y.blockDuplicated');
  });

  it('smazání vrátí popis pro nabídku vrácení akce', () => {
    const s = store();
    const result = runOperation(s, 'delete');
    expect(result.undo).toBe(true);
    expect(s.getState().document.blocks[0].children).toHaveLength(2);
  });

  it('šipka dolů posune výběr na další blok v pořadí kreslení', () => {
    const s = store();
    runOperation(s, 'select-next');
    expect(s.getState().selectedId).toBe('b_t1');
    runOperation(s, 'select-next');
    runOperation(s, 'select-next');
    expect(s.getState().selectedId).toBe('b_col1');
  });

  it('šipka doleva vybere rodiče, doprava prvního potomka', () => {
    const s = store();
    s.select('b_col1');
    runOperation(s, 'select-parent');
    expect(s.getState().selectedId).toBe('b_c1');
    runOperation(s, 'select-child');
    expect(s.getState().selectedId).toBe('b_col1');
  });

  it('bez vybraného bloku se nic nestane a nic se neoznámí', () => {
    const s = store();
    s.select(null);
    expect(runOperation(s, 'move-down')).toEqual({});
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/keyboard/run-operation.test.ts`
Expected: FAIL, `Failed to resolve import "./run-operation"`.

- [ ] **Krok 3: Napiš implementaci**

```ts
// apps/web/src/features/editor/keyboard/run-operation.ts
import { descriptorFor } from '../descriptors/registry';
import { findBlock, flatten } from '../model/tree';
import type { EditorStore } from '../state/editor-store';
import type { OperationId } from './operations';

/**
 * Oznámení je **data, ne hotová věta**: klíč a parametry. Skládat řetězec tady
 * by porušilo kritérium 71 části 6 a znemožnilo překlad.
 *
 * `tone` rozhoduje, do které oblasti `aria-live` text půjde. `useAnnouncer()`
 * z P05 vrací dvě metody schválně: úspěšný přesun se hlásí zdvořile, aby
 * nepřerušil čtení, ale odmítnutí musí uživatel slyšet hned, jinak mačká
 * klávesu dál a nic se neděje. Výchozí hodnota je `polite`.
 */
export type Announcement = {
  key: string;
  params?: Record<string, string | number>;
  tone?: 'polite' | 'assertive';
};

export type OperationResult = {
  announce?: Announcement;
  /** true = akce se dá vrátit a volající na ni nabídne toast s vrácením. */
  undo?: boolean;
  /** true = fokus se má přesunout do panelu vlastností. */
  focusProperties?: boolean;
};

function position(store: EditorStore, id: string) {
  const item = flatten(store.getState().document).find((entry) => entry.block.id === id);
  return item ? { position: item.index + 1, total: item.siblings } : null;
}

export function runOperation(store: EditorStore, operation: OperationId): OperationResult {
  const state = store.getState();
  const id = state.selectedId;

  if (operation === 'undo') { store.undo(); return { announce: { key: 'a11y.undone' } }; }
  if (operation === 'redo') { store.redo(); return { announce: { key: 'a11y.redone' } }; }
  if (!id) return {};

  const found = findBlock(state.document, id);
  if (!found) return {};
  const label = descriptorFor(found.block.type).label;
  const flat = flatten(state.document);
  const index = flat.findIndex((entry) => entry.block.id === id);

  switch (operation) {
    case 'move-up':
    case 'move-down':
    case 'move-out':
    case 'move-in': {
      const direction = operation.slice(5) as 'up' | 'down' | 'out' | 'in';
      const moved = store.moveByKeyboard(id, direction);
      if (!moved) {
        return { announce: { key: 'a11y.moveBlocked', params: { block: label }, tone: 'assertive' } };
      }
      const place = position(store, id);
      return {
        announce: {
          key: 'a11y.blockMoved',
          params: { block: label, position: place?.position ?? 1, total: place?.total ?? 1 },
        },
      };
    }
    case 'duplicate': {
      const newId = store.duplicateBlock(id);
      if (!newId) {
        return { announce: { key: 'a11y.duplicateBlocked', params: { block: label }, tone: 'assertive' } };
      }
      return { announce: { key: 'a11y.blockDuplicated', params: { block: label } }, undo: true };
    }
    case 'delete': {
      store.removeBlock(id);
      return { announce: { key: 'a11y.blockDeleted', params: { block: label } }, undo: true };
    }
    case 'insert-after': {
      const parent = found.path.slice(0, -1);
      const at = found.path[found.path.length - 1] + 1;
      const type = found.block.type === 'section' ? 'section' : 'text';
      store.insertBlock(type, { parent, index: at });
      return { announce: { key: 'a11y.blockInserted', params: { block: descriptorFor(type).label } } };
    }
    case 'edit':
      return { focusProperties: true };
    case 'select-prev': {
      const target = flat[index - 1];
      if (target) store.select(target.block.id);
      return {};
    }
    case 'select-next': {
      const target = flat[index + 1];
      if (target) store.select(target.block.id);
      return {};
    }
    case 'select-parent': {
      const parentPath = found.path.slice(0, -1);
      if (parentPath.length === 0) return {};
      const parent = flat.find((entry) => entry.path.join('.') === parentPath.join('.'));
      if (parent) store.select(parent.block.id);
      return {};
    }
    case 'select-child': {
      const child = found.block.children?.[0];
      if (child) store.select(child.id);
      return {};
    }
    case 'escape':
      store.select(null);
      return {};
    default:
      return {};
  }
}
```

```ts
// apps/web/src/features/editor/keyboard/use-canvas-keyboard.ts
'use client';

import { useAnnouncer } from '@mlain/ui/a11y';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useCallback } from 'react';
import { useEditorStore } from '../state/use-editor';
import { matchOperation } from './operations';
import { runOperation } from './run-operation';

export function useCanvasKeyboard(options: { onFocusProperties: () => void; onUndoOffer: () => void }) {
  const store = useEditorStore();
  // `useAnnouncer()` vrací objekt se dvěma metodami, ne jednu funkci. Zdvořilá
  // oblast nepřeruší čtení, důrazná ano; odmítnutá operace musí být slyšet hned.
  const { assertive, polite } = useAnnouncer();
  const t = useTranslations('editor');

  return useCallback((event: KeyboardEvent<HTMLElement>) => {
    const operation = matchOperation(event);
    if (!operation) return;
    event.preventDefault();
    const result = runOperation(store, operation);
    if (result.announce) {
      const say = result.announce.tone === 'assertive' ? assertive : polite;
      say(t(result.announce.key, mapParams(t, result.announce.params)));
    }
    if (result.focusProperties) options.onFocusProperties();
    if (result.undo) options.onUndoOffer();
  }, [assertive, options, polite, store, t]);
}

/** Popisek bloku je překladový klíč, takže se přeloží dřív, než se vloží do věty. */
function mapParams(
  t: (key: string) => string,
  params?: Record<string, string | number>,
): Record<string, string | number> {
  if (!params) return {};
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = typeof value === 'string' && value.startsWith('block.') ? t(value) : value;
  }
  return out;
}
```

- [ ] **Krok 4: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/keyboard/run-operation.test.ts`
Expected: PASS, 9 testů.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/keyboard
git commit -m "feat(editor): run editor operations and announce new block position"
```
---

### Úkol 16: Plátno, ovládání bloku a tlačítko „+" mezi bloky

**Soubory:**
- Create: `apps/web/src/features/editor/components/canvas/canvas.tsx`, `block-node.tsx`, `block-toolbar.tsx`, `insert-between.tsx`
- Create: `apps/web/src/features/editor/components/canvas/canvas.test.tsx`

Plátno je **strom s roving tabindex** (rozhodnutí R4). Jeden `Tab` vejde na vybraný blok, další `Tab` vyjde do panelu vlastností. Uvnitř se chodí šipkami, přesouvá se `Alt` se šipkami.

- [ ] **Krok 1: Napiš test**

```tsx
// apps/web/src/features/editor/components/canvas/canvas.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../../../packages/i18n/messages/cs/editor.json';
import type { EditorDocument } from '../../model/document-types';
import { createEditorStore } from '../../state/editor-store';
import { EditorStoreProvider } from '../../state/use-editor';
import { Canvas } from './canvas';

const document = (): EditorDocument => ({
  schemaVersion: 1, meta: { name: 'T', previewText: '', language: 'cs' }, theme: {},
  blocks: [{ id: 'b_s1', type: 'section', props: {}, children: [
    { id: 'b_h1', type: 'heading', props: { content: [{ t: 'p', children: [{ t: 's', v: 'Letní výprodej' }] }] } },
    { id: 'b_t1', type: 'text', props: { content: [{ t: 'p', children: [{ t: 's', v: 'Text' }] }] } },
  ] }],
} as EditorDocument);

function setup() {
  const store = createEditorStore({ document: document(), designHash: 'h1' });
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <EditorStoreProvider value={store}>
        <Canvas canWriteHtml />
      </EditorStoreProvider>
    </NextIntlClientProvider>,
  );
  return store;
}

describe('Canvas', () => {
  it('kreslí strom s rolemi, úrovněmi a pozicemi', () => {
    setup();
    const tree = screen.getByRole('tree');
    expect(tree).toHaveAttribute('aria-label');
    const items = screen.getAllByRole('treeitem');
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveAttribute('aria-level', '2');
    expect(items[1]).toHaveAttribute('aria-posinset', '1');
    expect(items[1]).toHaveAttribute('aria-setsize', '2');
  });

  it('má jediný tabstop, takže se z plátna dá vyjít Tabem', () => {
    setup();
    const focusable = screen.getAllByRole('treeitem').filter((item) => item.tabIndex === 0);
    expect(focusable).toHaveLength(1);
  });

  it('kliknutí blok vybere a vybraný blok je označený pro čtečku', async () => {
    const store = setup();
    await userEvent.click(screen.getByTestId('block-b_t1'));
    expect(store.getState().selectedId).toBe('b_t1');
    expect(screen.getByTestId('block-b_t1')).toHaveAttribute('aria-selected', 'true');
  });

  it('Alt se šipkou dolů přesune vybraný blok', async () => {
    const store = setup();
    await userEvent.click(screen.getByTestId('block-b_h1'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(store.getState().document.blocks[0].children!.map((b) => b.id)).toEqual(['b_t1', 'b_h1']);
  });

  it('ovládání bloku nabízí všech šest operací také myší', async () => {
    setup();
    await userEvent.click(screen.getByTestId('block-b_h1'));
    const toolbar = screen.getByTestId('block-toolbar-b_h1');
    expect(toolbar.querySelectorAll('button')).toHaveLength(6);
  });

  it('tlačítko + mezi bloky otevře paletu a vloží blok na dané místo', async () => {
    const store = setup();
    await userEvent.click(screen.getByTestId('insert-after-b_h1'));
    await userEvent.click(screen.getByRole('menuitem', { name: /Oddělovač/ }));
    expect(store.getState().document.blocks[0].children!.map((b) => b.type))
      .toEqual(['heading', 'divider', 'text']);
  });

  it('neznámý blok se kreslí jako zamčený placeholder', () => {
    const store = createEditorStore({
      document: { ...document(), blocks: [{ id: 'b_s1', type: 'section', props: {}, children: [
        { id: 'b_x1', type: 'carousel', props: { foo: 1 } },
      ] }] } as EditorDocument,
      designHash: 'h1',
    });
    render(
      <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
        <EditorStoreProvider value={store}>
          <Canvas canWriteHtml />
        </EditorStoreProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('block-b_x1')).toHaveAttribute('data-locked', 'true');
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/canvas/canvas.test.tsx`
Expected: FAIL, `Failed to resolve import "./canvas"`.

- [ ] **Krok 3: Napiš komponenty**

```tsx
// apps/web/src/features/editor/components/canvas/canvas.tsx
'use client';

import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { EDITOR_DND_ENABLED } from '../../config';
import { useCanvasKeyboard } from '../../keyboard/use-canvas-keyboard';
import { flatten } from '../../model/tree';
import { useEditorState, useEditorStore } from '../../state/use-editor';
import { BlockNode } from './block-node';

export function Canvas({ canWriteHtml }: { canWriteHtml: boolean }) {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const document = useEditorState((state) => state.document);
  const selectedId = useEditorState((state) => state.selectedId);
  const propertiesRef = useRef<HTMLElement | null>(null);
  const onKeyDown = useCanvasKeyboard({
    onFocusProperties: () => {
      propertiesRef.current = window.document.getElementById('editor-properties');
      propertiesRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    },
    onUndoOffer: () => { window.dispatchEvent(new CustomEvent('editor:undo-offer')); },
  });

  const items = flatten(document);
  const focusId = selectedId ?? items[0]?.block.id ?? null;

  return (
    <div
      role="tree"
      aria-label={t('a11y.canvas')}
      aria-multiselectable={false}
      className="mx-auto flex w-full max-w-[720px] flex-col gap-1 p-6"
      onKeyDown={onKeyDown}
      data-dnd={EDITOR_DND_ENABLED ? 'on' : 'off'}
    >
      {items.map((item) => (
        <BlockNode
          key={item.block.id}
          item={item}
          isSelected={item.block.id === selectedId}
          isFocusStop={item.block.id === focusId}
          canWriteHtml={canWriteHtml}
          onSelect={() => store.select(item.block.id)}
        />
      ))}
    </div>
  );
}
```

```tsx
// apps/web/src/features/editor/components/canvas/block-node.tsx
'use client';

import { cn } from '@mlain/ui/lib/cn';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { descriptorFor } from '../../descriptors/registry';
import type { FlatItem } from '../../model/tree';
import { BlockPreview } from './block-preview';
import { BlockToolbar } from './block-toolbar';
import { InsertBetween } from './insert-between';

export function BlockNode(props: {
  item: FlatItem;
  isSelected: boolean;
  isFocusStop: boolean;
  canWriteHtml: boolean;
  onSelect: () => void;
}) {
  const { item, isSelected, isFocusStop, canWriteHtml, onSelect } = props;
  const t = useTranslations('editor');
  const descriptor = descriptorFor(item.block.type);
  const locked = descriptor.type === item.block.type && descriptor.groups.length === 0;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { if (isSelected) ref.current?.focus({ preventScroll: false }); }, [isSelected]);

  return (
    <div className="group relative" style={{ marginInlineStart: (item.level - 1) * 12 }}>
      <div
        ref={ref}
        role="treeitem"
        data-testid={`block-${item.block.id}`}
        data-locked={locked ? 'true' : undefined}
        aria-level={item.level}
        aria-posinset={item.index + 1}
        aria-setsize={item.siblings}
        aria-selected={isSelected}
        aria-label={`${t(descriptor.label)}`}
        tabIndex={isFocusStop ? 0 : -1}
        onClick={(event) => { event.stopPropagation(); onSelect(); }}
        onFocus={onSelect}
        className={cn(
          'rounded-md border border-transparent p-2 outline-none',
          isSelected && 'border-primary ring-2 ring-primary/40',
          locked && 'bg-muted text-muted-foreground',
        )}
      >
        {item.block.visibleWhen ? (
          <p className="mb-1 rounded bg-accent px-2 py-0.5 text-xs">
            {t('visibility.badge', {
              field: item.block.visibleWhen.field,
              op: t(`visibility.op.${item.block.visibleWhen.op}`),
            })}
          </p>
        ) : null}
        {locked
          ? <p className="text-sm">{t('block.lockedHint', { type: item.block.type })}</p>
          : <BlockPreview block={item.block} canWriteHtml={canWriteHtml} />}
      </div>
      {isSelected ? <BlockToolbar blockId={item.block.id} /> : null}
      <InsertBetween item={item} />
    </div>
  );
}
```

```tsx
// apps/web/src/features/editor/components/canvas/block-toolbar.tsx
'use client';

import { Button } from '@mlain/ui/components/button';
import { Tooltip } from '@mlain/ui/components/tooltip';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { TOOLBAR_OPERATIONS } from '../../keyboard/operations';
import { runOperation } from '../../keyboard/run-operation';
import { useEditorStore } from '../../state/use-editor';

const ICONS = {
  'arrow-up': ArrowUp, 'arrow-down': ArrowDown, 'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight, copy: Copy, trash: Trash2,
} as const;

/** Sada tlačítek se generuje z registru operací, takže myš nikdy nemá víc možností než klávesnice. */
export function BlockToolbar({ blockId }: { blockId: string }) {
  const t = useTranslations('editor');
  const store = useEditorStore();

  return (
    <div
      data-testid={`block-toolbar-${blockId}`}
      className="absolute -top-3 right-2 flex gap-1 rounded-md border bg-background p-1 shadow-sm"
    >
      {TOOLBAR_OPERATIONS.map((operation) => {
        const Icon = ICONS[operation.icon!];
        return (
          <Tooltip key={operation.id} content={`${t(operation.labelKey)} (${operation.keys[0]})`}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t(operation.labelKey)}
              onClick={(event) => { event.stopPropagation(); runOperation(store, operation.id); }}
            >
              <Icon aria-hidden className="size-4" />
            </Button>
          </Tooltip>
        );
      })}
    </div>
  );
}
```

```tsx
// apps/web/src/features/editor/components/canvas/insert-between.tsx
'use client';

import { Button } from '@mlain/ui/components/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger }
  from '@mlain/ui/components/dropdown-menu';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PALETTE } from '../../descriptors/registry';
import { canContain } from '../../model/tree';
import type { FlatItem } from '../../model/tree';
import { useEditorState, useEditorStore } from '../../state/use-editor';
import { typeAt } from '../../model/tree';

/** Přidání bloku tlačítkem mezi bloky. Nabízí se jen to, co gramatika na daném místě dovolí. */
export function InsertBetween({ item }: { item: FlatItem }) {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const document = useEditorState((state) => state.document);
  const parent = item.path.slice(0, -1);
  const parentType = typeAt(document, parent);
  const index = item.index + 1;

  return (
    <div className="flex h-4 items-center justify-center opacity-0 focus-within:opacity-100 group-hover:opacity-100">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            data-testid={`insert-after-${item.block.id}`}
            aria-label={t('insert.after', { block: t(`block.${item.block.type}`) })}
          >
            <Plus aria-hidden className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {PALETTE.map((group) => {
            const entries = group.entries.filter((entry) => canContain(parentType, entry.type));
            if (entries.length === 0) return null;
            return (
              <div key={group.label}>
                <DropdownMenuLabel>{t(group.label)}</DropdownMenuLabel>
                {entries.map((entry) => (
                  <DropdownMenuItem
                    key={entry.id}
                    onSelect={() => store.insertBlock(entry.type, { parent, index }, entry.preset ?? {})}
                  >
                    {t(entry.label)}
                  </DropdownMenuItem>
                ))}
              </div>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

- [ ] **Krok 4: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/canvas/canvas.test.tsx`
Expected: PASS, 7 testů. Test potřebuje katalog z úkolu 26; když se pouští dřív, vytvoř `packages/i18n/messages/cs/editor.json` s prázdným objektem a doplň ho v úkolu 26.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/components/canvas
git commit -m "feat(editor): render canvas tree with block toolbar and insert points"
```

---

### Úkol 17: Přiblížení bloku na plátně

**Soubory:**
- Create: `apps/web/src/features/editor/components/canvas/block-preview.tsx`
- Create: `apps/web/src/features/editor/components/canvas/block-preview.test.tsx`

Plátno kreslí **přiblížení, ne skutečné e-mailové HTML** (rozhodnutí R8). Závazný vzhled ukazuje náhled, který jede stejným kódem jako odeslání.

- [ ] **Krok 1: Napiš test**

```tsx
// apps/web/src/features/editor/components/canvas/block-preview.test.tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../../../packages/i18n/messages/cs/editor.json';
import { BlockPreview } from './block-preview';

const wrap = (ui: React.ReactNode) => render(
  <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>{ui}</NextIntlClientProvider>,
);

describe('BlockPreview', () => {
  it('nadpis kreslí jako text s úrovní', () => {
    wrap(<BlockPreview canWriteHtml block={{ id: 'b_1', type: 'heading', props: {
      level: 1, content: [{ t: 'p', children: [{ t: 's', v: 'Letní výprodej' }] }],
    } }} />);
    expect(screen.getByText('Letní výprodej')).toBeInTheDocument();
  });

  it('personalizaci kreslí jako žeton s popiskem, ne jako Liquid', () => {
    wrap(<BlockPreview canWriteHtml block={{ id: 'b_1', type: 'text', props: {
      content: [{ t: 'p', children: [{ t: 'var', expr: 'contact.greeting' }] }],
    } }} />);
    expect(screen.getByTestId('token')).toHaveTextContent('Oslovení');
    expect(screen.queryByText(/\{\{/)).toBeNull();
  });

  it('obrázek bez alt textu ukáže varování rovnou na plátně', () => {
    wrap(<BlockPreview canWriteHtml block={{ id: 'b_1', type: 'image', props: { assetId: 'a1', alt: '', decorative: false } }} />);
    expect(screen.getByTestId('missing-alt')).toBeInTheDocument();
  });

  it('blok html bez oprávnění ukáže vysvětlení, ne prázdno', () => {
    wrap(<BlockPreview canWriteHtml={false} block={{ id: 'b_1', type: 'html', props: { code: '<b>x</b>' } }} />);
    expect(screen.getByTestId('html-forbidden')).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/canvas/block-preview.test.tsx`
Expected: FAIL, `Failed to resolve import "./block-preview"`.

- [ ] **Krok 3: Napiš implementaci**

```tsx
// apps/web/src/features/editor/components/canvas/block-preview.tsx
'use client';

import { AlertTriangle, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { EditorBlock, InlineNode, RichText } from '../../model/document-types';
import { useFieldLabel } from '../richtext/field-labels';

function Inline({ nodes }: { nodes: InlineNode[] }) {
  const fieldLabel = useFieldLabel();
  return (
    <>
      {nodes.map((node, index) => {
        if (node.t === 'br') return <br key={index} />;
        if (node.t === 'var') {
          return (
            <span key={index} data-testid="token" className="rounded bg-accent px-1 text-accent-foreground">
              {fieldLabel(node.expr)}
            </span>
          );
        }
        if (node.t === 'a') {
          return <span key={index} className="underline"><Inline nodes={node.children} /></span>;
        }
        const style = [node.b && 'font-bold', node.i && 'italic', node.u && 'underline',
          node.strike && 'line-through'].filter(Boolean).join(' ');
        return <span key={index} className={style}>{node.v}</span>;
      })}
    </>
  );
}

function Rich({ value }: { value: RichText }) {
  return (
    <>
      {value.map((node, index) => {
        if (node.t === 'p') return <p key={index}><Inline nodes={node.children} /></p>;
        const List = node.t === 'ul' ? 'ul' : 'ol';
        return (
          <List key={index} className={node.t === 'ul' ? 'list-disc pl-5' : 'list-decimal pl-5'}>
            {node.items.map((item, itemIndex) => <li key={itemIndex}><Inline nodes={item} /></li>)}
          </List>
        );
      })}
    </>
  );
}

export function BlockPreview({ block, canWriteHtml }: { block: EditorBlock; canWriteHtml: boolean }) {
  const t = useTranslations('editor');
  const props = block.props as Record<string, never>;

  switch (block.type) {
    case 'section':
    case 'column':
      return <p className="text-xs text-muted-foreground">{t(`block.${block.type}`)}</p>;
    case 'columns':
      return <p className="text-xs text-muted-foreground">{t('block.columnsWithLayout', { layout: String(props.layout ?? '1-1') })}</p>;
    case 'heading':
      return <div className="text-xl font-bold"><Rich value={props.content ?? []} /></div>;
    case 'text':
      return <div className="text-sm"><Rich value={props.content ?? []} /></div>;
    case 'button':
      return (
        <span className="inline-block rounded bg-primary px-4 py-2 text-primary-foreground">
          <Rich value={props.label ?? []} />
        </span>
      );
    case 'image':
      return (
        <div className="flex items-center gap-2">
          <div className="h-16 w-24 rounded bg-muted" aria-hidden />
          {!props.decorative && !props.alt ? (
            <span data-testid="missing-alt" className="flex items-center gap-1 text-xs text-warning-foreground">
              <AlertTriangle aria-hidden className="size-3" />
              {t('hint.altMissing')}
            </span>
          ) : <span className="text-xs text-muted-foreground">{String(props.alt ?? '')}</span>}
        </div>
      );
    case 'divider':
      return <hr className="border-t" />;
    case 'spacer':
      return <div className="bg-muted/40" style={{ height: Number(props.height ?? 24) }} aria-hidden />;
    case 'social':
      return <p className="text-xs text-muted-foreground">{t('block.socialCount', { count: (props.items ?? []).length })}</p>;
    case 'footer':
      return (
        <div className="text-xs text-muted-foreground">
          <Rich value={props.senderInfo ?? []} />
          <p>{[props.showUnsubscribe && props.unsubscribeLabel, props.showPreferences && props.preferencesLabel,
            props.showWebview && props.webviewLabel].filter(Boolean).join(' | ')}</p>
        </div>
      );
    case 'html':
      return canWriteHtml
        ? <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{String(props.code ?? '')}</pre>
        : (
          <p data-testid="html-forbidden" className="flex items-center gap-1 text-xs">
            <Lock aria-hidden className="size-3" />{t('block.htmlForbidden')}
          </p>
        );
    default:
      return <p className="text-xs">{t('block.lockedHint', { type: block.type })}</p>;
  }
}
```

- [ ] **Krok 4: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/canvas/block-preview.test.tsx`
Expected: PASS, 4 testy.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/components/canvas
git commit -m "feat(editor): draw block approximations on the canvas"
```

---

### Úkol 18: Přetahování jako nadstavba, ne jako jediná cesta

**Soubory:**
- Create: `apps/web/src/features/editor/components/canvas/dnd/dnd-canvas.tsx`
- Create: `apps/web/src/features/editor/components/canvas/dnd/dnd-canvas.test.tsx`
- Modify: `apps/web/src/features/editor/components/canvas/canvas.tsx` (obalení plátna)

`@dnd-kit` se registruje **jen s `PointerSensor`** (rozhodnutí R5). Klávesová cesta z úkolů 14 a 15 je hotová a nezávislá, takže vypnutí `EDITOR_DND_ENABLED` editor nezmrzačí.

- [ ] **Krok 1: Napiš test**

```tsx
// apps/web/src/features/editor/components/canvas/dnd/dnd-canvas.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DndCanvas, dropTargetFor } from './dnd-canvas';

vi.mock('../../../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../config')>()),
  EDITOR_DND_ENABLED: false,
}));

describe('DndCanvas', () => {
  it('při vypnutém přetahování vykreslí obsah bez knihovny', () => {
    render(<DndCanvas onMove={() => {}} items={[]}><p>obsah</p></DndCanvas>);
    expect(screen.getByText('obsah')).toBeInTheDocument();
    expect(screen.queryByTestId('dnd-context')).toBeNull();
  });

  it('cíl upuštění spočítá rodiče a index z identity sousedů', () => {
    const items = [
      { id: 'b_h1', path: [0, 0] }, { id: 'b_t1', path: [0, 1] }, { id: 'b_d1', path: [0, 2] },
    ];
    expect(dropTargetFor(items, 'b_h1', 'b_d1')).toEqual({ parent: [0], index: 2 });
    expect(dropTargetFor(items, 'b_d1', 'b_h1')).toEqual({ parent: [0], index: 0 });
    expect(dropTargetFor(items, 'b_h1', 'b_h1')).toBeNull();
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/canvas/dnd/dnd-canvas.test.tsx`
Expected: FAIL, `Failed to resolve import "./dnd-canvas"`.

- [ ] **Krok 3: Napiš implementaci**

```tsx
// apps/web/src/features/editor/components/canvas/dnd/dnd-canvas.tsx
'use client';

import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { EDITOR_DND_ENABLED } from '../../../config';
import type { MoveTarget } from '../../../model/ops';
import type { Path } from '../../../model/tree';

export type DndItem = { id: string; path: Path };

/** Spočítá cíl upuštění z cesty vlečeného a cílového bloku. Čistá funkce, testuje se bez DOM. */
export function dropTargetFor(items: DndItem[], activeId: string, overId: string): MoveTarget | null {
  if (activeId === overId) return null;
  const over = items.find((item) => item.id === overId);
  if (!over) return null;
  return { parent: over.path.slice(0, -1), index: over.path[over.path.length - 1] };
}

export function DndCanvas(props: {
  items: DndItem[];
  onMove: (id: string, target: MoveTarget) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  if (!EDITOR_DND_ENABLED) return <>{props.children}</>;
  return (
    <DndContext
      sensors={sensors}
      accessibility={{ announcements: undefined }}
      onDragEnd={(event) => {
        const overId = event.over?.id;
        if (!overId) return;
        const target = dropTargetFor(props.items, String(event.active.id), String(overId));
        if (target) props.onMove(String(event.active.id), target);
      }}
    >
      <div data-testid="dnd-context">{props.children}</div>
    </DndContext>
  );
}
```

Poznámka k `accessibility.announcements: undefined`: oznámení čtečce si editor vyrábí sám v `run-operation.ts`, aby byla shodná pro myš i pro klávesnici. Dvě různá znění téhož by mátla víc než jedno.

- [ ] **Krok 4: Zapoj do plátna**

V `canvas.tsx` obal seznam bloků komponentou `DndCanvas` a předej `items` z `flatten(document)` a `onMove={(id, target) => store.moveBlock(id, target)}`. Jednotlivý blok dostane `useSortable` uvnitř `sortable-block.tsx`; úchyt je jediné místo, které reaguje na tažení, a má `aria-hidden`, protože klávesová cesta vede jinudy.

- [ ] **Krok 5: Spusť testy plátna, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/canvas`
Expected: PASS.

- [ ] **Krok 6: Commit**

```bash
git add apps/web/src/features/editor/components/canvas
git commit -m "feat(editor): add pointer-only drag and drop over the canvas"
```

---

### Úkol 19: Generovaný panel vlastností

**Soubory:**
- Create: `apps/web/src/features/editor/components/properties/properties-panel.tsx`, `prop-field.tsx`
- Create: `apps/web/src/features/editor/components/properties/properties-panel.test.tsx`

Tohle je místo, kde se rozhoduje o polovině objemu editoru. Panel **nezná ani jeden typ bloku**: přečte descriptor a vykreslí skupiny.

- [ ] **Krok 1: Napiš test**

```tsx
// apps/web/src/features/editor/components/properties/properties-panel.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../../../packages/i18n/messages/cs/editor.json';
import type { EditorDocument } from '../../model/document-types';
import { createEditorStore } from '../../state/editor-store';
import { EditorStoreProvider } from '../../state/use-editor';
import { PropertiesPanel } from './properties-panel';

const document = (): EditorDocument => ({
  schemaVersion: 1, meta: { name: 'T', previewText: '', language: 'cs' }, theme: {},
  blocks: [{ id: 'b_s1', type: 'section', props: {}, children: [
    { id: 'b_sp1', type: 'spacer', props: { height: 24, heightMobile: null } },
    { id: 'b_html', type: 'html', props: { code: '' } },
  ] }],
} as EditorDocument);

function setup(selected: string | null) {
  const store = createEditorStore({ document: document(), designHash: 'h1' });
  if (selected) store.select(selected);
  const utils = render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <EditorStoreProvider value={store}>
        <PropertiesPanel canWriteHtml={false} fieldCatalog={{ fields: [], version: 'v1' }} ports={null} />
      </EditorStoreProvider>
    </NextIntlClientProvider>,
  );
  return { store, utils };
}

describe('PropertiesPanel', () => {
  it('bez vybraného bloku ukazuje vlastnosti celého e-mailu', () => {
    setup(null);
    expect(screen.getByRole('heading', { name: /Motiv/ })).toBeInTheDocument();
  });

  it('vykreslí skupiny a pole podle descriptoru, ne podle natvrdo psaného formuláře', () => {
    setup('b_sp1');
    expect(screen.getByRole('group', { name: /Vzhled/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/Výška/)).toHaveValue(24);
  });

  it('změna hodnoty projde do dokumentu', async () => {
    const { store } = setup('b_sp1');
    const input = screen.getByLabelText(/Výška/);
    await userEvent.clear(input);
    await userEvent.type(input, '48');
    expect(store.getState().document.blocks[0].children![0].props.height).toBe(48);
  });

  it('vlastnost chráněná oprávněním se bez něj zobrazí jen pro čtení s vysvětlením', () => {
    setup('b_html');
    expect(screen.getByTestId('prop-code')).toHaveAttribute('data-readonly', 'true');
  });

  it('u vlastnosti s poznámkou o Outlooku je vysvětlující ikona', () => {
    setup('b_sp1');
    expect(screen.getByTestId('hint-heightMobile')).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/properties/properties-panel.test.tsx`
Expected: FAIL, `Failed to resolve import "./properties-panel"`.

- [ ] **Krok 3: Napiš panel**

```tsx
// apps/web/src/features/editor/components/properties/properties-panel.tsx
'use client';

import { useTranslations } from 'next-intl';
import { descriptorFor } from '../../descriptors/registry';
import type { FieldCatalog } from '../../model/field-catalog';
import { findBlock } from '../../model/tree';
import type { EditorPorts } from '../../ports/types';
import { useEditorState, useEditorStore } from '../../state/use-editor';
import { PropField } from './prop-field';
import { ThemePanel } from './theme-panel';

export function PropertiesPanel(props: {
  canWriteHtml: boolean;
  fieldCatalog: FieldCatalog;
  ports: EditorPorts | null;
}) {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const document = useEditorState((state) => state.document);
  const selectedId = useEditorState((state) => state.selectedId);
  const found = selectedId ? findBlock(document, selectedId) : undefined;

  if (!found) {
    return (
      <aside id="editor-properties" aria-label={t('a11y.propertiesPanel')} className="w-80 border-l p-4">
        <ThemePanel />
      </aside>
    );
  }

  const descriptor = descriptorFor(found.block.type);

  return (
    <aside id="editor-properties" aria-label={t('a11y.propertiesPanel')} className="w-80 space-y-4 border-l p-4">
      <h2 className="text-sm font-semibold">{t(descriptor.label)}</h2>
      {descriptor.groups.length === 0 ? <p className="text-sm">{t('block.lockedHint', { type: found.block.type })}</p> : null}
      {descriptor.groups.map((group, groupIndex) => (
        <fieldset key={group.label} className="space-y-3" aria-label={t(group.label)}>
          <legend className="text-xs uppercase text-muted-foreground">{t(group.label)}</legend>
          {group.props.map((descriptorProp, propIndex) => (
            <PropField
              key={descriptorProp.key}
              autoFocus={groupIndex === 0 && propIndex === 0}
              descriptor={descriptorProp}
              block={found.block}
              value={descriptorProp.kind === 'visibility'
                ? found.block.visibleWhen ?? null
                : found.block.props[descriptorProp.key]}
              canWriteHtml={props.canWriteHtml}
              fieldCatalog={props.fieldCatalog}
              ports={props.ports}
              onChange={(next) => {
                if (descriptorProp.kind === 'visibility') {
                  store.setVisibility(found.block.id, next as never);
                } else {
                  store.patchProps(found.block.id, { [descriptorProp.key]: next });
                }
              }}
            />
          ))}
        </fieldset>
      ))}
    </aside>
  );
}
```

```tsx
// apps/web/src/features/editor/components/properties/prop-field.tsx
'use client';

import { Label } from '@mlain/ui/components/label';
import { Tooltip } from '@mlain/ui/components/tooltip';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import type { PropDescriptor } from '../../descriptors/types';
import type { EditorBlock } from '../../model/document-types';
import type { FieldCatalog } from '../../model/field-catalog';
import type { EditorPorts } from '../../ports/types';
import { AssetControl } from './controls/asset-control';
import { CodeControl } from './controls/code-control';
import { ColorControl } from './controls/color-control';
import { LinkControl } from './controls/link-control';
import { NumberControl } from './controls/number-control';
import { PaddingControl } from './controls/padding-control';
import { RichTextControl } from './controls/rich-text-control';
import { SelectControl } from './controls/select-control';
import { SocialItemsControl } from './controls/social-items-control';
import { TextControl } from './controls/text-control';
import { ToggleControl } from './controls/toggle-control';
import { VisibilityControl } from './controls/visibility-control';

export type ControlProps = {
  descriptor: PropDescriptor;
  value: unknown;
  onChange: (next: unknown) => void;
  id: string;
  block: EditorBlock;
  canWriteHtml: boolean;
  fieldCatalog: FieldCatalog;
  ports: EditorPorts | null;
  autoFocus?: boolean;
};

const CONTROLS: Record<PropDescriptor['kind'], (props: ControlProps) => JSX.Element> = {
  color: ColorControl,
  number: NumberControl,
  select: SelectControl,
  toggle: ToggleControl,
  padding: PaddingControl,
  richtext: RichTextControl,
  asset: AssetControl,
  link: LinkControl,
  text: TextControl,
  code: CodeControl,
  socialItems: SocialItemsControl,
  visibility: VisibilityControl,
};

export function PropField(props: Omit<ControlProps, 'id'>) {
  const t = useTranslations('editor');
  const id = useId();
  const Control = CONTROLS[props.descriptor.kind];
  const hint = 'hint' in props.descriptor ? props.descriptor.hint : undefined;

  return (
    <div data-testid={`prop-${props.descriptor.key}`} className="space-y-1">
      <div className="flex items-center gap-1">
        <Label htmlFor={id}>{t(props.descriptor.label)}</Label>
        {hint ? (
          <Tooltip content={t(hint)}>
            <span data-testid={`hint-${props.descriptor.key}`} tabIndex={0} aria-label={t(hint)}>
              <Info aria-hidden className="size-3 text-muted-foreground" />
            </span>
          </Tooltip>
        ) : null}
      </div>
      <Control {...props} id={id} />
    </div>
  );
}
```

- [ ] **Krok 4: Spusť test, musí projít (po úkolu 20)**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/properties`
Expected: FAIL na chybějící ovládací prvky. Zezelená v úkolu 20.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/components/properties
git commit -m "feat(editor): generate the properties panel from block descriptors"
```
---

### Úkol 20: Dvanáct ovládacích prvků, jeden na druh vlastnosti

**Soubory:**
- Create: `apps/web/src/features/editor/model/field-catalog.ts`
- Create: `apps/web/src/features/editor/components/richtext/field-labels.tsx`
- Create: `apps/web/src/features/editor/components/properties/controls/*.tsx` (dvanáct souborů)
- Create: `apps/web/src/features/editor/components/properties/controls/controls.test.tsx`

Ovládací prvek zná **druh vlastnosti, ne blok**. Proto jich je dvanáct a ne osmdesát.

- [ ] **Krok 1: Napiš test**

```tsx
// apps/web/src/features/editor/components/properties/controls/controls.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../packages/i18n/messages/cs/editor.json';
import type { FieldCatalog } from '../../../model/field-catalog';
import { ColorControl } from './color-control';
import { NumberControl } from './number-control';
import { LinkControl } from './link-control';
import { VisibilityControl } from './visibility-control';

const catalog: FieldCatalog = {
  version: 'v1',
  fields: [
    { path: 'city', type: 'string', label: { cs: 'Město', en: 'City' }, group: 'custom', deleted: false },
    { path: 'is_vip', type: 'boolean', label: { cs: 'VIP', en: 'VIP' }, group: 'custom', deleted: false },
    { path: 'old', type: 'string', label: { cs: 'Staré', en: 'Old' }, group: 'custom', deleted: true },
  ],
};

const wrap = (ui: React.ReactNode) => render(
  <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>{ui}</NextIntlClientProvider>,
);

const base = { block: { id: 'b_1', type: 'text', props: {} }, canWriteHtml: true, fieldCatalog: catalog, ports: null };

describe('ovládací prvky', () => {
  it('číslo hlídá meze z descriptoru', async () => {
    const onChange = vi.fn();
    wrap(<NumberControl {...base} id="n1" onChange={onChange} value={24}
      descriptor={{ kind: 'number', key: 'height', label: 'prop.height', min: 4, max: 120, step: 4, unit: 'px' }} />);
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveAttribute('min', '4');
    expect(input).toHaveAttribute('max', '120');
    await userEvent.clear(input);
    await userEvent.type(input, '200');
    expect(onChange).toHaveBeenLastCalledWith(120);
  });

  it('barva nabízí role motivu i vlastní odstín', async () => {
    const onChange = vi.fn();
    wrap(<ColorControl {...base} id="c1" onChange={onChange} value="text.default"
      descriptor={{ kind: 'color', key: 'color', label: 'prop.color', allowThemeRef: true }} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'brand.primary');
    expect(onChange).toHaveBeenCalledWith('brand.primary');
  });

  it('odkaz odmítne zakázané schéma', async () => {
    const onChange = vi.fn();
    wrap(<LinkControl {...base} id="l1" onChange={onChange} value=""
      descriptor={{ kind: 'link', key: 'href', label: 'prop.href', trackableKey: 'trackable' }} />);
    await userEvent.type(screen.getByRole('textbox'), 'javascript:alert(1)');
    expect(screen.getByRole('alert')).toHaveTextContent(/https/);
    expect(onChange).not.toHaveBeenCalledWith('javascript:alert(1)');
  });

  it('podmínka zobrazení nabízí jen pole z katalogu a operátory podle typu', async () => {
    const onChange = vi.fn();
    wrap(<VisibilityControl {...base} id="v1" onChange={onChange} value={null}
      descriptor={{ kind: 'visibility', key: 'visibleWhen', label: 'prop.visibleWhen' }} />);
    const field = screen.getByLabelText(/Pole/);
    expect(screen.queryByText('Staré')).toBeNull();          // smazané pole se nenabízí
    await userEvent.selectOptions(field, 'contact.is_vip');
    const operators = screen.getByLabelText(/Podmínka/);
    expect([...operators.querySelectorAll('option')].map((o) => o.value)).toEqual(['true', 'false']);
  });

  it('podmínka nad textovým polem nabízí present a blank', async () => {
    wrap(<VisibilityControl {...base} id="v2" onChange={vi.fn()}
      value={{ field: 'contact.city', op: 'present' }}
      descriptor={{ kind: 'visibility', key: 'visibleWhen', label: 'prop.visibleWhen' }} />);
    const operators = screen.getByLabelText(/Podmínka/);
    expect([...operators.querySelectorAll('option')].map((o) => o.value)).toEqual(['present', 'blank']);
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/properties/controls/controls.test.tsx`
Expected: FAIL, chybějící moduly.

- [ ] **Krok 3: Napiš katalog polí a popisky**

```ts
// apps/web/src/features/editor/model/field-catalog.ts
/**
 * Převody mezi cestou v katalogu (`first_name`, `attr.city`) a merge cestou,
 * která se píše do šablony (`contact.first_name`).
 *
 * **Nebydlí v kontraktech.** `@mlain/contracts/fields` neexistuje: P02 rozhodnutím
 * R2 katalog polí i převody cest vůbec nedodává, protože stojí na modelu kontaktu.
 * Napsané jsou v `packages/emails/src/paths.ts`, tedy u P08, který je potřebuje
 * pro renderer. Editor je z téhož místa jen čte, aby nevznikla druhá verze převodu.
 */
export { toCatalogPath, toLiquidRoots, toMergePath } from '@mlain/emails/paths';

/**
 * Typy katalogu vlastní P07 a berou se z veřejné plochy domény, ne z hluboké
 * podcesty. Vlastní kopie tvaru by se s ní časem rozešla a projevilo by se to
 * jako pole, které editor nenabízí, přestože v projektu existuje.
 *
 * Import a reexport jsou dva řádky schválně: `export type { X } from` typ
 * reexportuje, ale nezavede ho do místního rozsahu, takže by se o pár řádků níž
 * nedal použít v `Record<FieldCatalogType, …>`.
 *
 * Import je `import type`, takže z něj po překladu nezbude žádný běhový import.
 * Doména `@mlain/core/contacts` sahá na databázi a do prohlížeče nesmí.
 */
import type {
  FieldCatalog, FieldCatalogEntry, FieldCatalogType,
} from '@mlain/core/contacts';

export type { FieldCatalog, FieldCatalogEntry, FieldCatalogType };

/** `LocalizedText` P07 z veřejné plochy nevystavuje, je to jen tvar popisku. */
export type LocalizedText = Record<string, string> & { en: string };

export type VisibilityOperator = 'present' | 'blank' | 'true' | 'false';

/** Tabulka z části 3, 3.8.2. Operátor mimo typ pole je chyba content_condition_operator_invalid. */
export const OPERATORS_BY_TYPE: Record<FieldCatalogType, VisibilityOperator[]> = {
  string: ['present', 'blank'],
  number: ['present', 'blank'],
  date: ['present', 'blank'],
  datetime: ['present', 'blank'],
  list: ['present', 'blank'],
  boolean: ['true', 'false'],
};

/** Výběr popisku: jazyk uživatele, pak základní jazyk bez oblasti, pak en (část 3, 3.1.9). */
export function pickLabel(label: LocalizedText, locale: string): string {
  return label[locale] ?? label[locale.split('-')[0]] ?? label.en;
}

export function usableFields(catalog: FieldCatalog): FieldCatalogEntry[] {
  return catalog.fields.filter((field) => !field.deleted);
}
```

```tsx
// apps/web/src/features/editor/components/richtext/field-labels.tsx
'use client';

import { useLocale, useTranslations } from 'next-intl';
import { createContext, useCallback, useContext } from 'react';
import { type FieldCatalog, pickLabel, toCatalogPath } from '../../model/field-catalog';

const CatalogContext = createContext<FieldCatalog | null>(null);
export const FieldCatalogProvider = CatalogContext.Provider;

export function useFieldCatalog(): FieldCatalog {
  return useContext(CatalogContext) ?? { fields: [], version: 'empty' };
}

/** Systémové tagy a pevná pole kontaktu mají popisek v katalogu editoru, vlastní pole v katalogu polí. */
const STATIC_LABELS: Record<string, string> = {
  unsubscribe_url: 'field.unsubscribeUrl',
  preferences_url: 'field.preferencesUrl',
  webview_url: 'field.webviewUrl',
  'campaign.name': 'field.campaignName',
  'campaign.subject': 'field.campaignSubject',
  'workspace.name': 'field.workspaceName',
  'workspace.sender_address': 'field.senderAddress',
  'contact.email': 'field.email',
  'contact.first_name': 'field.firstName',
  'contact.last_name': 'field.lastName',
  'contact.first_name_vocative': 'field.firstNameVocative',
  'contact.last_name_vocative': 'field.lastNameVocative',
  'contact.title_prefix': 'field.titlePrefix',
  'contact.title_suffix': 'field.titleSuffix',
  'contact.greeting': 'field.greeting',
  'contact.gender': 'field.gender',
  'contact.locale': 'field.locale',
  'contact.created_at': 'field.createdAt',
};

export function useFieldLabel(): (expr: string) => string {
  const t = useTranslations('editor');
  const locale = useLocale();
  const catalog = useFieldCatalog();
  return useCallback((expr: string) => {
    const path = expr.split('|')[0].trim();
    const staticKey = STATIC_LABELS[path];
    if (staticKey) return t(staticKey);
    const entry = catalog.fields.find((field) => field.path === toCatalogPath(path));
    return entry ? pickLabel(entry.label, locale) : path;
  }, [catalog, locale, t]);
}
```

- [ ] **Krok 4: Napiš ovládací prvky**

```tsx
// apps/web/src/features/editor/components/properties/controls/number-control.tsx
'use client';

import { Input } from '@mlain/ui/components/input';
import { Switch } from '@mlain/ui/components/switch';
import { useTranslations } from 'next-intl';
import type { ControlProps } from '../prop-field';

export function NumberControl({ descriptor, value, onChange, id, autoFocus }: ControlProps) {
  const t = useTranslations('editor');
  if (descriptor.kind !== 'number') return <></>;
  const isNull = value === null || value === descriptor.nullValue;
  const clamp = (raw: number) => Math.min(descriptor.max, Math.max(descriptor.min, raw));

  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        data-autofocus={autoFocus ? '' : undefined}
        min={descriptor.min}
        max={descriptor.max}
        step={descriptor.step}
        value={isNull ? '' : Number(value)}
        placeholder={isNull ? t('value.inherited') : undefined}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') { onChange(descriptor.nullValue ?? null); return; }
          onChange(clamp(Number(raw)));
        }}
      />
      <span aria-hidden className="text-xs text-muted-foreground">{descriptor.unit}</span>
      {descriptor.nullable ? (
        <Switch
          aria-label={t('value.useDefault')}
          checked={isNull}
          onCheckedChange={(checked) => onChange(checked ? descriptor.nullValue ?? null : descriptor.min)}
        />
      ) : null}
    </div>
  );
}
```

```tsx
// apps/web/src/features/editor/components/properties/controls/color-control.tsx
'use client';

import { Input } from '@mlain/ui/components/input';
import { useTranslations } from 'next-intl';
import type { ControlProps } from '../prop-field';

const ROLES = [
  'brand.primary', 'brand.secondary', 'brand.accent', 'text.default', 'text.muted', 'text.inverted',
  'surface.canvas', 'surface.content', 'surface.subtle', 'link.default',
];

export function ColorControl({ descriptor, value, onChange, id, autoFocus }: ControlProps) {
  const t = useTranslations('editor');
  if (descriptor.kind !== 'color') return <></>;
  const isHex = typeof value === 'string' && value.startsWith('#');

  return (
    <div className="flex items-center gap-2">
      <select
        id={id}
        data-autofocus={autoFocus ? '' : undefined}
        className="h-9 flex-1 rounded-md border bg-background px-2 text-sm"
        value={isHex ? '$custom' : String(value ?? '$none')}
        onChange={(event) => {
          const next = event.target.value;
          if (next === '$none') onChange(null);
          else if (next === '$custom') onChange('#000000');
          else onChange(next);
        }}
      >
        {descriptor.nullable ? <option value="$none">{t('value.color.none')}</option> : null}
        {ROLES.map((role) => <option key={role} value={role}>{t(`value.color.${role}`)}</option>)}
        <option value="$custom">{t('value.color.custom')}</option>
      </select>
      {isHex ? (
        <Input
          type="color"
          aria-label={t('value.color.custom')}
          value={String(value)}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
          className="h-9 w-12 p-1"
        />
      ) : null}
    </div>
  );
}
```

```tsx
// apps/web/src/features/editor/components/properties/controls/select-control.tsx
'use client';

import { useTranslations } from 'next-intl';
import type { ControlProps } from '../prop-field';

export function SelectControl({ descriptor, value, onChange, id, autoFocus }: ControlProps) {
  const t = useTranslations('editor');
  if (descriptor.kind !== 'select') return <></>;
  return (
    <select
      id={id}
      data-autofocus={autoFocus ? '' : undefined}
      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
      value={String(value ?? '')}
      onChange={(event) => {
        const raw = event.target.value;
        const option = descriptor.options.find((item) => String(item.value) === raw);
        onChange(option ? option.value : raw);
      }}
    >
      {descriptor.options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>{t(option.label)}</option>
      ))}
    </select>
  );
}
```

```tsx
// apps/web/src/features/editor/components/properties/controls/toggle-control.tsx
'use client';

import { Switch } from '@mlain/ui/components/switch';
import type { ControlProps } from '../prop-field';

export function ToggleControl({ descriptor, value, onChange, id, autoFocus }: ControlProps) {
  if (descriptor.kind !== 'toggle') return <></>;
  return (
    <Switch
      id={id}
      data-autofocus={autoFocus ? '' : undefined}
      checked={value === true}
      onCheckedChange={(checked) => onChange(checked)}
    />
  );
}
```

```tsx
// apps/web/src/features/editor/components/properties/controls/padding-control.tsx
'use client';

import { Input } from '@mlain/ui/components/input';
import { useTranslations } from 'next-intl';
import type { ControlProps } from '../prop-field';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

export function PaddingControl({ descriptor, value, onChange, id, autoFocus }: ControlProps) {
  const t = useTranslations('editor');
  if (descriptor.kind !== 'padding') return <></>;
  const padding = (value ?? { top: 0, right: 0, bottom: 0, left: 0 }) as Record<string, number>;

  return (
    <div className="grid grid-cols-4 gap-1" role="group" aria-labelledby={id}>
      {SIDES.map((side, index) => (
        <label key={side} className="text-xs">
          <span className="text-muted-foreground">{t(`value.side.${side}`)}</span>
          <Input
            type="number"
            min={0}
            max={100}
            data-autofocus={autoFocus && index === 0 ? '' : undefined}
            value={padding[side] ?? 0}
            aria-label={`${t(descriptor.label)}: ${t(`value.side.${side}`)}`}
            onChange={(event) => onChange({
              ...padding,
              [side]: Math.min(100, Math.max(0, Number(event.target.value || 0))),
            })}
          />
        </label>
      ))}
    </div>
  );
}
```

```tsx
// apps/web/src/features/editor/components/properties/controls/text-control.tsx
'use client';

import { Input } from '@mlain/ui/components/input';
import type { ControlProps } from '../prop-field';

export function TextControl({ descriptor, value, onChange, id, autoFocus }: ControlProps) {
  if (descriptor.kind !== 'text') return <></>;
  return (
    <Input
      id={id}
      data-autofocus={autoFocus ? '' : undefined}
      maxLength={descriptor.maxLength}
      value={String(value ?? '')}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
```

```tsx
// apps/web/src/features/editor/components/properties/controls/link-control.tsx
'use client';

import { Input } from '@mlain/ui/components/input';
import { Switch } from '@mlain/ui/components/switch';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ControlProps } from '../prop-field';

const ALLOWED = ['https:', 'http:', 'mailto:', 'tel:'];
const SYSTEM_TAGS = ['{{ unsubscribe_url }}', '{{ preferences_url }}', '{{ webview_url }}'];

/** Validace schématu (content_link_scheme_forbidden) a zákaz Liquidu v trackovaném odkazu (3.1.5). */
export function validateHref(raw: string): 'ok' | 'scheme' | 'liquid' {
  const value = raw.trim();
  if (value === '' || SYSTEM_TAGS.includes(value)) return 'ok';
  if (value.includes('{{') || value.includes('{%')) return 'liquid';
  try {
    if (!ALLOWED.includes(new URL(value).protocol)) return 'scheme';
  } catch { return 'scheme'; }
  return 'ok';
}

export function LinkControl({ descriptor, value, onChange, id, block, autoFocus }: ControlProps) {
  const t = useTranslations('editor');
  const [draft, setDraft] = useState(String(value ?? ''));
  const [problem, setProblem] = useState<'ok' | 'scheme' | 'liquid'>('ok');
  if (descriptor.kind !== 'link') return <></>;

  return (
    <div className="space-y-1">
      <Input
        id={id}
        data-autofocus={autoFocus ? '' : undefined}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const state = validateHref(next);
          setProblem(state);
          if (state === 'ok') onChange(next);
        }}
      />
      {problem !== 'ok' ? (
        <p role="alert" className="text-xs text-destructive">
          {problem === 'scheme' ? t('link.schemeForbidden') : t('link.liquidForbidden')}
        </p>
      ) : null}
      {descriptor.trackableKey ? (
        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={block.props[descriptor.trackableKey] !== false}
            onCheckedChange={(checked) => onChange(draft, { [descriptor.trackableKey!]: checked } as never)}
          />
          {t('link.trackable')}
        </label>
      ) : null}
    </div>
  );
}
```

```tsx
// apps/web/src/features/editor/components/properties/controls/asset-control.tsx
'use client';

import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@mlain/ui/components/dialog';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { AssetSummary } from '../../../ports/types';
import type { ControlProps } from '../prop-field';

export function AssetControl({ descriptor, value, onChange, id, ports, autoFocus }: ControlProps) {
  const t = useTranslations('editor');
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || !ports) return;
    let active = true;
    void ports.listAssets().then((list) => { if (active) setAssets(list); });
    return () => { active = false; };
  }, [open, ports]);

  if (descriptor.kind !== 'asset') return <></>;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2">
        <DialogTrigger asChild>
          <Button id={id} variant="outline" data-autofocus={autoFocus ? '' : undefined}>
            {value ? t('asset.change') : t('asset.pick')}
          </Button>
        </DialogTrigger>
        {value && descriptor.nullable ? (
          <Button variant="ghost" onClick={() => onChange(null)}>{t('asset.remove')}</Button>
        ) : null}
      </div>
      <DialogContent>
        <DialogTitle>{t('asset.title')}</DialogTitle>
        <input
          type="file"
          accept="image/*"
          aria-label={t('asset.upload')}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file || !ports) return;
            const uploaded = await ports.uploadAsset(file);
            onChange(uploaded.id);
            setOpen(false);
          }}
        />
        <ul className="grid grid-cols-3 gap-2">
          {assets.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                className="w-full rounded border p-1"
                onClick={() => { onChange(asset.id); setOpen(false); }}
              >
                <img src={asset.url} alt="" className="h-20 w-full object-contain" />
                <span className="block truncate text-xs">{asset.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
```

```tsx
// apps/web/src/features/editor/components/properties/controls/code-control.tsx
'use client';

import { useTranslations } from 'next-intl';
import type { ControlProps } from '../prop-field';

export function CodeControl({ descriptor, value, onChange, id, canWriteHtml, autoFocus }: ControlProps) {
  const t = useTranslations('editor');
  if (descriptor.kind !== 'code') return <></>;

  if (!canWriteHtml) {
    return (
      <div data-readonly="true" className="space-y-1">
        <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{String(value ?? '')}</pre>
        <p className="text-xs text-muted-foreground">{t('block.htmlForbidden')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <textarea
        id={id}
        data-autofocus={autoFocus ? '' : undefined}
        maxLength={descriptor.maxLength}
        rows={8}
        className="w-full rounded-md border bg-background p-2 font-mono text-xs"
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">{t('block.htmlConditionHint')}</p>
    </div>
  );
}
```

```tsx
// apps/web/src/features/editor/components/properties/controls/social-items-control.tsx
'use client';

import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { useTranslations } from 'next-intl';
import { SOCIAL_NETWORKS } from '../../../descriptors/social';
import type { ControlProps } from '../prop-field';

type SocialItem = { network: string; href: string; label?: string };

export function SocialItemsControl({ descriptor, value, onChange, id }: ControlProps) {
  const t = useTranslations('editor');
  if (descriptor.kind !== 'socialItems') return <></>;
  const items = (value ?? []) as SocialItem[];
  const update = (next: SocialItem[]) => onChange(next);

  return (
    <div className="space-y-2" role="group" aria-labelledby={id}>
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-1">
          <select
            aria-label={t('social.network')}
            className="h-9 rounded-md border bg-background px-1 text-xs"
            value={item.network}
            onChange={(event) => update(items.map((entry, i) =>
              i === index ? { ...entry, network: event.target.value } : entry))}
          >
            {SOCIAL_NETWORKS.map((network) => (
              <option key={network} value={network}>{t(`social.${network}`)}</option>
            ))}
          </select>
          <Input
            aria-label={t('social.href')}
            value={item.href}
            onChange={(event) => update(items.map((entry, i) =>
              i === index ? { ...entry, href: event.target.value } : entry))}
          />
          <Button variant="ghost" aria-label={t('social.remove')}
            onClick={() => update(items.filter((_, i) => i !== index))}>×</Button>
        </div>
      ))}
      {items.length < descriptor.max ? (
        <Button variant="outline" onClick={() => update([...items, { network: 'facebook', href: '' }])}>
          {t('social.add')}
        </Button>
      ) : <p className="text-xs text-muted-foreground">{t('social.max', { max: descriptor.max })}</p>}
    </div>
  );
}
```

```tsx
// apps/web/src/features/editor/components/properties/controls/visibility-control.tsx
'use client';

import { useLocale, useTranslations } from 'next-intl';
import { OPERATORS_BY_TYPE, pickLabel, toMergePath, usableFields } from '../../../model/field-catalog';
import type { ControlProps } from '../prop-field';

/** Uživatel vybere pole a operátor. Žádný Liquid nepíše a žádný nevidí (část 3, 3.1.10). */
export function VisibilityControl({ descriptor, value, onChange, id, fieldCatalog }: ControlProps) {
  const t = useTranslations('editor');
  const locale = useLocale();
  if (descriptor.kind !== 'visibility') return <></>;
  const condition = value as { field: string; op: string } | null;
  const fields = usableFields(fieldCatalog);
  const selected = fields.find((field) => toMergePath(field.path) === condition?.field);
  const operators = selected ? OPERATORS_BY_TYPE[selected.type] : [];

  return (
    <div className="space-y-2">
      <label className="block text-xs">
        {t('visibility.field')}
        <select
          id={id}
          aria-label={t('visibility.field')}
          className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
          value={condition?.field ?? ''}
          onChange={(event) => {
            const path = event.target.value;
            if (!path) { onChange(null); return; }
            const field = fields.find((entry) => toMergePath(entry.path) === path)!;
            onChange({ field: path, op: OPERATORS_BY_TYPE[field.type][0] });
          }}
        >
          <option value="">{t('visibility.always')}</option>
          {fields.map((field) => (
            <option key={field.path} value={toMergePath(field.path)}>{pickLabel(field.label, locale)}</option>
          ))}
        </select>
      </label>
      {condition ? (
        <label className="block text-xs">
          {t('visibility.operator')}
          <select
            aria-label={t('visibility.operator')}
            className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={condition.op}
            onChange={(event) => onChange({ ...condition, op: event.target.value })}
          >
            {operators.map((operator) => (
              <option key={operator} value={operator}>{t(`visibility.op.${operator}`)}</option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
```

```tsx
// apps/web/src/features/editor/components/properties/controls/rich-text-control.tsx
'use client';

import type { RichText } from '../../../model/document-types';
import { RichTextField } from '../../richtext/rich-text-field';
import type { ControlProps } from '../prop-field';

export function RichTextControl({ descriptor, value, onChange, id, autoFocus, fieldCatalog }: ControlProps) {
  if (descriptor.kind !== 'richtext') return <></>;
  return (
    <RichTextField
      id={id}
      autoFocus={autoFocus}
      allowLists={descriptor.allowLists}
      singleParagraph={descriptor.singleParagraph === true}
      fieldCatalog={fieldCatalog}
      value={(value ?? [{ t: 'p', children: [] }]) as RichText}
      onChange={onChange}
    />
  );
}
```

- [ ] **Krok 5: Spusť testy panelu i prvků, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/properties`
Expected: PASS.

- [ ] **Krok 6: Commit**

```bash
git add apps/web/src/features/editor
git commit -m "feat(editor): add twelve property controls, one per descriptor kind"
```

---

### Úkol 21: Panel motivu

**Soubory:**
- Create: `apps/web/src/features/editor/descriptors/theme.ts`
- Create: `apps/web/src/features/editor/components/properties/theme-panel.tsx`
- Create: `apps/web/src/features/editor/components/properties/theme-panel.test.tsx`

Motiv je jediné místo, kde se drží vizuální styl (3.1.4). Panel se generuje ze stejných descriptorů jako blok, jen se zapisuje do `document.theme`.

- [ ] **Krok 1: Napiš test**

```tsx
// apps/web/src/features/editor/components/properties/theme-panel.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../../../packages/i18n/messages/cs/editor.json';
import type { EditorDocument } from '../../model/document-types';
import { createEditorStore } from '../../state/editor-store';
import { EditorStoreProvider } from '../../state/use-editor';
import { ThemePanel } from './theme-panel';

const document = (): EditorDocument => ({
  schemaVersion: 1, meta: { name: 'Letní výprodej', previewText: '', language: 'cs' },
  theme: { contentWidth: 600 }, blocks: [],
} as EditorDocument);

function setup() {
  const store = createEditorStore({ document: document(), designHash: 'h1' });
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <EditorStoreProvider value={store}><ThemePanel /></EditorStoreProvider>
    </NextIntlClientProvider>,
  );
  return store;
}

describe('ThemePanel', () => {
  it('ukazuje šířku obsahu, písma, velikost a tmavý režim', () => {
    setup();
    expect(screen.getByLabelText(/Šířka obsahu/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Písmo nadpisů/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tmavý režim/)).toBeInTheDocument();
  });

  it('změna šířky zapíše do motivu, ne do bloku', async () => {
    const store = setup();
    await userEvent.selectOptions(screen.getByLabelText(/Šířka obsahu/), '640');
    expect(store.getState().document.theme.contentWidth).toBe(640);
  });

  it('úvodní řádek a název se ukládají do meta', async () => {
    const store = setup();
    await userEvent.type(screen.getByLabelText(/Úvodní řádek/), 'Slevy končí');
    expect(store.getState().document.meta.previewText).toBe('Slevy končí');
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/properties/theme-panel.test.tsx`
Expected: FAIL, `Failed to resolve import "./theme-panel"`.

- [ ] **Krok 3: Napiš descriptor motivu a panel**

```ts
// apps/web/src/features/editor/descriptors/theme.ts
import { FONT_STACK_OPTIONS } from './common';
import type { PropGroup } from './types';

export const THEME_GROUPS: PropGroup[] = [
  { label: 'group.emailLayout', props: [
    { kind: 'select', key: 'contentWidth', label: 'prop.contentWidth', options: [
      { value: 600, label: 'value.width.600' },
      { value: 640, label: 'value.width.640' },
    ] },
    { kind: 'color', key: 'canvasBackground', label: 'prop.canvasBackground', allowThemeRef: true },
    { kind: 'color', key: 'contentBackground', label: 'prop.contentBackground', allowThemeRef: true },
    { kind: 'select', key: 'radius', label: 'prop.radius', options: [
      { value: 0, label: 'value.radius.0' }, { value: 4, label: 'value.radius.4' },
      { value: 6, label: 'value.radius.6' }, { value: 8, label: 'value.radius.8' },
      { value: 12, label: 'value.radius.12' },
    ] },
  ] },
  { label: 'group.typography', props: [
    { kind: 'select', key: 'fonts.heading', label: 'prop.headingFont', options: FONT_STACK_OPTIONS },
    { kind: 'select', key: 'fonts.body', label: 'prop.bodyFont', options: FONT_STACK_OPTIONS },
    { kind: 'number', key: 'typography.baseFontSize', label: 'prop.baseFontSize', min: 12, max: 20, step: 1, unit: 'px' },
    { kind: 'number', key: 'typography.baseLineHeight', label: 'prop.baseLineHeight', min: 1.2, max: 2, step: 0.1, unit: 'x' },
    { kind: 'select', key: 'typography.headingScale', label: 'prop.headingScale', options: [
      { value: 1.125, label: 'value.scale.1125' }, { value: 1.2, label: 'value.scale.12' },
      { value: 1.25, label: 'value.scale.125' }, { value: 1.333, label: 'value.scale.1333' },
    ] },
  ] },
  { label: 'group.darkMode', props: [
    { kind: 'select', key: 'darkMode.strategy', label: 'prop.darkMode', options: [
      { value: 'auto', label: 'value.darkMode.auto' },
      { value: 'off', label: 'value.darkMode.off' },
    ] },
  ] },
];
```

```tsx
// apps/web/src/features/editor/components/properties/theme-panel.tsx
'use client';

import { Input } from '@mlain/ui/components/input';
import { useTranslations } from 'next-intl';
import { THEME_GROUPS } from '../../descriptors/theme';
import { useEditorState, useEditorStore } from '../../state/use-editor';
import { PropField } from './prop-field';

const getPath = (source: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], source);

const setPath = (source: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> => {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) return { ...source, [head]: value };
  return { ...source, [head]: setPath((source[head] as Record<string, unknown>) ?? {}, rest.join('.'), value) };
};

export function ThemePanel() {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const document = useEditorState((state) => state.document);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold">{t('theme.title')}</h2>
      <label className="block text-xs">
        {t('meta.previewText')}
        <Input
          value={String(document.meta.previewText ?? '')}
          maxLength={150}
          onChange={(event) => store.patchMeta({ previewText: event.target.value })}
        />
      </label>
      {THEME_GROUPS.map((group) => (
        <fieldset key={group.label} className="space-y-3" aria-label={t(group.label)}>
          <legend className="text-xs uppercase text-muted-foreground">{t(group.label)}</legend>
          {group.props.map((descriptor) => (
            <PropField
              key={descriptor.key}
              descriptor={descriptor}
              block={{ id: '$theme', type: '$theme', props: {} }}
              canWriteHtml={false}
              fieldCatalog={{ fields: [], version: 'theme' }}
              ports={null}
              value={getPath(document.theme as Record<string, unknown>, descriptor.key)}
              onChange={(next) => store.patchTheme(
                setPath(document.theme as Record<string, unknown>, descriptor.key, next) as never,
              )}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
```

- [ ] **Krok 4: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/properties/theme-panel.test.tsx`
Expected: PASS, 3 testy.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor
git commit -m "feat(editor): add theme panel generated from theme descriptor"
```

---

### Úkol 22: Bohatý text s pevným panelem

**Soubory:**
- Create: `apps/web/src/features/editor/components/richtext/rich-text-field.tsx`, `toolbar.tsx`
- Create: `apps/web/src/features/editor/components/richtext/rich-text-field.test.tsx`

Schéma Tiptapu se skládá **výslovně z uzlů, které `RichText` povoluje**, a nic víc. `StarterKit` by přinesl nadpisy, citace a bloky kódu, tedy uzly, které by šlo do dokumentu propašovat vložením ze schránky.

- [ ] **Krok 1: Napiš test**

```tsx
// apps/web/src/features/editor/components/richtext/rich-text-field.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../packages/i18n/messages/cs/editor.json';
import { RichTextField } from './rich-text-field';

const catalog = { version: 'v1', fields: [] };

const wrap = (ui: React.ReactNode) => render(
  <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>{ui}</NextIntlClientProvider>,
);

describe('RichTextField', () => {
  it('má pevný panel s tučně, kurzívou, odkazem, seznamy a vložením personalizace', () => {
    wrap(<RichTextField id="r1" value={[{ t: 'p', children: [] }]} onChange={vi.fn()}
      allowLists fieldCatalog={catalog} />);
    const toolbar = screen.getByRole('toolbar');
    for (const label of ['Tučně', 'Kurzíva', 'Odkaz', 'Odrážky', 'Číslovaný seznam', 'Vložit personalizaci']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(toolbar).toHaveAttribute('aria-label');
  });

  it('u vlastnosti bez seznamů se tlačítka seznamů nezobrazí', () => {
    wrap(<RichTextField id="r2" value={[{ t: 'p', children: [] }]} onChange={vi.fn()}
      allowLists={false} fieldCatalog={catalog} />);
    expect(screen.queryByRole('button', { name: /Odrážky/ })).toBeNull();
  });

  it('psaní vyvolá změnu v modelu, ne v HTML řetězci', async () => {
    const onChange = vi.fn();
    wrap(<RichTextField id="r3" value={[{ t: 'p', children: [] }]} onChange={onChange}
      allowLists fieldCatalog={catalog} />);
    await userEvent.click(screen.getByRole('textbox'));
    await userEvent.keyboard('Ahoj');
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0];
    expect(last[0].children[0]).toMatchObject({ t: 's', v: 'Ahoj' });
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/richtext/rich-text-field.test.tsx`
Expected: FAIL, `Failed to resolve import "./rich-text-field"`.

- [ ] **Krok 3: Napiš implementaci**

```tsx
// apps/web/src/features/editor/components/richtext/rich-text-field.tsx
'use client';

import Bold from '@tiptap/extension-bold';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import Text from '@tiptap/extension-text';
import Underline from '@tiptap/extension-underline';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo } from 'react';
import type { RichText } from '../../model/document-types';
import type { FieldCatalog } from '../../model/field-catalog';
import { richTextToTiptap, tiptapToRichText } from '../../model/richtext';
import { PersonalizationExtension } from './personalization-extension';
import { RichTextToolbar } from './toolbar';

export function RichTextField(props: {
  id: string;
  value: RichText;
  onChange: (next: RichText) => void;
  allowLists: boolean;
  singleParagraph?: boolean;
  autoFocus?: boolean;
  fieldCatalog: FieldCatalog;
}) {
  const t = useTranslations('editor');

  const extensions = useMemo(() => [
    Document.extend(props.singleParagraph ? { content: 'paragraph' } : {}),
    Paragraph.extend({
      addAttributes: () => ({ align: { default: null } }),
    }),
    Text, Bold, Italic, Underline, Strike, HardBreak, UndoRedo,
    Link.configure({ openOnClick: false, autolink: false, protocols: ['http', 'https', 'mailto', 'tel'] }),
    PersonalizationExtension,
    Placeholder.configure({ placeholder: t('richtext.placeholder') }),
    ...(props.allowLists ? [BulletList, OrderedList, ListItem] : []),
  ], [props.allowLists, props.singleParagraph, t]);

  const editor = useEditor({
    extensions,
    content: richTextToTiptap(props.value),
    immediatelyRender: false,
    autofocus: props.autoFocus ? 'end' : false,
    editorProps: { attributes: { id: props.id, 'aria-label': t('richtext.label') } },
    onUpdate: ({ editor: instance }) => { props.onChange(tiptapToRichText(instance.getJSON() as never)); },
  }, [extensions]);

  useEffect(() => {
    if (!editor) return;
    const current = tiptapToRichText(editor.getJSON() as never);
    if (JSON.stringify(current) !== JSON.stringify(props.value)) {
      editor.commands.setContent(richTextToTiptap(props.value), { emitUpdate: false });
    }
  }, [editor, props.value]);

  if (!editor) return <div className="h-24 rounded border bg-muted" aria-hidden />;

  return (
    <div className="rounded-md border">
      <RichTextToolbar editor={editor} allowLists={props.allowLists} fieldCatalog={props.fieldCatalog} />
      <EditorContent editor={editor} className="prose-sm min-h-24 p-2 focus-within:outline-none" />
    </div>
  );
}
```

```tsx
// apps/web/src/features/editor/components/richtext/toolbar.tsx
'use client';

import { Button } from '@mlain/ui/components/button';
import type { Editor } from '@tiptap/react';
import { Bold, Italic, Link2, List, ListOrdered, Strikethrough, Underline } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FieldCatalog } from '../../model/field-catalog';
import { validateHref } from '../properties/controls/link-control';
import { PersonalizationMenu } from './personalization-menu';

export function RichTextToolbar(props: { editor: Editor; allowLists: boolean; fieldCatalog: FieldCatalog }) {
  const t = useTranslations('editor');
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const { editor } = props;

  const marks = [
    { id: 'bold', icon: Bold, label: 'richtext.bold', run: () => editor.chain().focus().toggleBold().run() },
    { id: 'italic', icon: Italic, label: 'richtext.italic', run: () => editor.chain().focus().toggleItalic().run() },
    { id: 'underline', icon: Underline, label: 'richtext.underline', run: () => editor.chain().focus().toggleUnderline().run() },
    { id: 'strike', icon: Strikethrough, label: 'richtext.strike', run: () => editor.chain().focus().toggleStrike().run() },
  ];

  return (
    <div role="toolbar" aria-label={t('richtext.toolbar')} className="flex flex-wrap gap-1 border-b p-1">
      {marks.map((mark) => (
        <Button
          key={mark.id}
          variant="ghost"
          size="icon"
          aria-label={t(mark.label)}
          aria-pressed={editor.isActive(mark.id)}
          onClick={mark.run}
        >
          <mark.icon aria-hidden className="size-4" />
        </Button>
      ))}
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('richtext.link')}
        aria-pressed={editor.isActive('link')}
        onClick={() => setLinkDraft(String(editor.getAttributes('link').href ?? ''))}
      >
        <Link2 aria-hidden className="size-4" />
      </Button>
      {props.allowLists ? (
        <>
          <Button variant="ghost" size="icon" aria-label={t('richtext.bulletList')}
            aria-pressed={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List aria-hidden className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t('richtext.orderedList')}
            aria-pressed={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <ListOrdered aria-hidden className="size-4" />
          </Button>
        </>
      ) : null}
      <PersonalizationMenu editor={editor} fieldCatalog={props.fieldCatalog} />
      {linkDraft !== null ? (
        <form
          className="flex w-full gap-1 p-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (validateHref(linkDraft) !== 'ok') return;
            editor.chain().focus().setLink({ href: linkDraft }).run();
            setLinkDraft(null);
          }}
        >
          <input
            aria-label={t('richtext.linkUrl')}
            className="h-8 flex-1 rounded border px-2 text-sm"
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
          />
          <Button type="submit" size="sm">{t('richtext.linkApply')}</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => {
            editor.chain().focus().unsetLink().run();
            setLinkDraft(null);
          }}>{t('richtext.linkRemove')}</Button>
        </form>
      ) : null}
    </div>
  );
}
```

- [ ] **Krok 4: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/richtext/rich-text-field.test.tsx`
Expected: PASS, 3 testy.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/components/richtext
git commit -m "feat(editor): add rich text field with a fixed toolbar"
```

---

### Úkol 23: Personalizace jako žeton, ne jako závorky

**Soubory:**
- Create: `apps/web/src/features/editor/components/richtext/personalization-extension.ts`, `personalization-node-view.tsx`, `personalization-menu.tsx`, `token-inspector.tsx`
- Create: `apps/web/src/features/editor/components/richtext/personalization.test.tsx`

`{{ contact.first_name_vocative }}` je pro netechnického člověka nečitelný řetězec, který svádí k ručním úpravám a rozbití. Žeton se dá vybrat, smazat a přesunout jako jeden znak. **Náhradní hodnota a formát data se zadávají v inspektoru žetonu** (rozhodnutí R6), takže se do textu šablony nikdy nedostane uvozovka.

- [ ] **Krok 1: Napiš test**

```tsx
// apps/web/src/features/editor/components/richtext/personalization.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../packages/i18n/messages/cs/editor.json';
import type { FieldCatalog } from '../../model/field-catalog';
import { TokenInspector } from './token-inspector';

const catalog: FieldCatalog = {
  version: 'v1',
  fields: [
    { path: 'first_name', type: 'string', label: { cs: 'Jméno', en: 'First name' }, group: 'name', deleted: false },
    { path: 'signup_date', type: 'date', label: { cs: 'Datum registrace', en: 'Signup date' }, group: 'custom', deleted: false },
    { path: 'note', type: 'string', label: { cs: 'Poznámka', en: 'Note' }, group: 'custom', deleted: false },
  ],
};

const wrap = (ui: React.ReactNode) => render(
  <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>{ui}</NextIntlClientProvider>,
);

describe('inspektor žetonu', () => {
  it('nabídne náhradní hodnotu a odmítne v ní zakázané znaky', async () => {
    const onChange = vi.fn();
    wrap(<TokenInspector fieldCatalog={catalog} onChange={onChange}
      attrs={{ expr: 'contact.first_name', fallback: null, dateFormat: null }} />);
    const input = screen.getByLabelText(/Náhradní hodnota/);
    await userEvent.type(input, 'kolego');
    expect(onChange).toHaveBeenLastCalledWith({ fallback: 'kolego' });
    await userEvent.clear(input);
    await userEvent.type(input, 'a"b');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('u data nabídne pět povolených formátů s náhledem výsledku, ne textové pole', () => {
    wrap(<TokenInspector fieldCatalog={catalog} onChange={vi.fn()}
      attrs={{ expr: 'contact.signup_date', fallback: null, dateFormat: null }} />);
    const select = screen.getByLabelText(/Formát data/);
    expect([...select.querySelectorAll('option')].map((option) => option.value)).toEqual(
      ['', '%d.%m.%Y', '%-d.%-m.%Y', '%Y-%m-%d', '%d.%m.%Y %H:%M', '%H:%M'],
    );
  });

  it('u textového pole formát data nenabízí', () => {
    wrap(<TokenInspector fieldCatalog={catalog} onChange={vi.fn()}
      attrs={{ expr: 'contact.first_name', fallback: null, dateFormat: null }} />);
    expect(screen.queryByLabelText(/Formát data/)).toBeNull();
  });

  it('u dlouhého textu upozorní, že se odřádkování v e-mailu neprojeví', () => {
    wrap(<TokenInspector fieldCatalog={catalog} onChange={vi.fn()}
      attrs={{ expr: 'contact.attr.note', fallback: null, dateFormat: null }} />);
    expect(screen.getByTestId('token-hint')).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/richtext/personalization.test.tsx`
Expected: FAIL, `Failed to resolve import "./token-inspector"`.

- [ ] **Krok 3: Napiš rozšíření Tiptapu a pohled uzlu**

```ts
// apps/web/src/features/editor/components/richtext/personalization-extension.ts
import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { PersonalizationNodeView } from './personalization-node-view';

/**
 * Personalizace je vlastní uzel, ne text se závorkami. Je `atom`, takže se chová jako jeden znak
 * a uživatel ji nemůže rozbít smazáním jedné závorky (část 3, 3.7.5).
 */
export const PersonalizationExtension = Node.create({
  name: 'personalization',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      expr: { default: '' },
      fallback: { default: null },
      dateFormat: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-ml-var]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-ml-var': HTMLAttributes.expr })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PersonalizationNodeView);
  },
});
```

```tsx
// apps/web/src/features/editor/components/richtext/personalization-node-view.tsx
'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@mlain/ui/components/popover';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useFieldCatalog, useFieldLabel } from './field-labels';
import { TokenInspector } from './token-inspector';

export function PersonalizationNodeView({ node, updateAttributes }: NodeViewProps) {
  const t = useTranslations('editor');
  const label = useFieldLabel();
  const catalog = useFieldCatalog();
  const attrs = node.attrs as { expr: string; fallback: string | null; dateFormat: string | null };

  return (
    <NodeViewWrapper as="span">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="token"
            className="rounded bg-accent px-1 text-accent-foreground"
            aria-label={t('token.tooltip', { label: label(attrs.expr) })}
          >
            {label(attrs.expr)}
          </button>
        </PopoverTrigger>
        <PopoverContent>
          <TokenInspector attrs={attrs} fieldCatalog={catalog} onChange={updateAttributes} />
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}
```

- [ ] **Krok 4: Napiš nabídku vkládání a inspektor**

```tsx
// apps/web/src/features/editor/components/richtext/personalization-menu.tsx
'use client';

import { Button } from '@mlain/ui/components/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@mlain/ui/components/command';
import { Popover, PopoverContent, PopoverTrigger } from '@mlain/ui/components/popover';
import type { Editor } from '@tiptap/react';
import { Braces } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { type FieldCatalog, pickLabel, toMergePath, usableFields } from '../../model/field-catalog';

const SYSTEM_TAGS = ['unsubscribe_url', 'preferences_url', 'webview_url', 'campaign.name', 'workspace.name'];

/** Vkládá se z nabídky, nikdy psaním. Nabídka je hledatelná a dělí se na systémová a vlastní pole. */
export function PersonalizationMenu({ editor, fieldCatalog }: { editor: Editor; fieldCatalog: FieldCatalog }) {
  const t = useTranslations('editor');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const fields = usableFields(fieldCatalog);

  const insert = (expr: string) => {
    editor.chain().focus().insertContent({ type: 'personalization', attrs: { expr, fallback: null, dateFormat: null } }).run();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t('richtext.insertPersonalization')}>
          <Braces aria-hidden className="size-4" />
          <span className="ml-1 hidden sm:inline">{t('richtext.insertPersonalization')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <Command>
          <CommandInput placeholder={t('personalization.search')} />
          <CommandEmpty>{t('personalization.empty')}</CommandEmpty>
          <CommandGroup heading={t('personalization.groupContact')}>
            {fields.filter((field) => !field.path.startsWith('attr.')).map((field) => (
              <CommandItem key={field.path} onSelect={() => insert(toMergePath(field.path))}>
                {pickLabel(field.label, locale)}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading={t('personalization.groupCustom')}>
            {fields.filter((field) => field.path.startsWith('attr.')).map((field) => (
              <CommandItem key={field.path} onSelect={() => insert(toMergePath(field.path))}>
                {pickLabel(field.label, locale)}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading={t('personalization.groupSystem')}>
            {SYSTEM_TAGS.map((tag) => (
              <CommandItem key={tag} onSelect={() => insert(tag)}>{t(`field.${tag.replace(/[._](\w)/g, (_, c) => c.toUpperCase())}`)}</CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

```tsx
// apps/web/src/features/editor/components/richtext/token-inspector.tsx
'use client';

import { Input } from '@mlain/ui/components/input';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { type FieldCatalog, toCatalogPath } from '../../model/field-catalog';

/** Pět celých formátů z kontraktu. Zadávají se výběrem, ne psaním (část 3, 3.7.2). */
const DATE_FORMATS = ['%d.%m.%Y', '%-d.%-m.%Y', '%Y-%m-%d', '%d.%m.%Y %H:%M', '%H:%M'];
const FORBIDDEN = /["'{}<>]/;

export function TokenInspector(props: {
  attrs: { expr: string; fallback: string | null; dateFormat: string | null };
  fieldCatalog: FieldCatalog;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const t = useTranslations('editor');
  const [invalid, setInvalid] = useState(false);
  const entry = props.fieldCatalog.fields.find((field) => field.path === toCatalogPath(props.attrs.expr));
  const isDate = entry?.type === 'date' || entry?.type === 'datetime';
  const isLongText = entry?.path.startsWith('attr.') && entry.type === 'string';

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('token.title')}</p>
      <label className="block text-xs">
        {t('token.fallbackLabel')}
        <Input
          aria-label={t('token.fallbackLabel')}
          maxLength={100}
          defaultValue={props.attrs.fallback ?? ''}
          onChange={(event) => {
            const next = event.target.value;
            if (FORBIDDEN.test(next)) { setInvalid(true); return; }
            setInvalid(false);
            props.onChange({ fallback: next === '' ? null : next });
          }}
        />
      </label>
      {invalid ? <p role="alert" className="text-xs text-destructive">{t('token.fallbackInvalid')}</p> : null}
      <p className="text-xs text-muted-foreground">{t('token.fallbackHint')}</p>
      {isDate ? (
        <label className="block text-xs">
          {t('token.dateFormatLabel')}
          <select
            aria-label={t('token.dateFormatLabel')}
            className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
            defaultValue={props.attrs.dateFormat ?? ''}
            onChange={(event) => props.onChange({ dateFormat: event.target.value || null })}
          >
            <option value="">{t('token.dateFormatDefault')}</option>
            {DATE_FORMATS.map((format) => (
              <option key={format} value={format}>{t(`token.dateFormat.${format}`)}</option>
            ))}
          </select>
        </label>
      ) : null}
      {isLongText ? (
        <p data-testid="token-hint" className="text-xs text-muted-foreground">{t('token.longTextHint')}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Krok 5: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/richtext`
Expected: PASS.

- [ ] **Krok 6: Commit**

```bash
git add apps/web/src/features/editor/components/richtext
git commit -m "feat(editor): insert personalization as a token with fallback inspector"
```
---

### Úkol 24: Pruh nálezů s prokliknutím na blok

**Soubory:**
- Create: `apps/web/src/features/editor/model/validate-client.ts`
- Create: `apps/web/src/features/editor/model/validate-client.test.ts`
- Create: `apps/web/src/features/editor/components/issues/issue-bar.tsx`
- Create: `apps/web/src/features/editor/components/issues/use-validation.ts`
- Create: `apps/web/src/features/editor/components/issues/issue-bar.test.tsx`

Nález nevede na znak v anonymním řetězci, ale na konkrétní blok, na který jde skočit. To je rozdíl mezi použitelným a nepoužitelným editorem (část 3, 3.7.3).

**Pravidla tenhle úkol nepíše.** Sémantická vrstva P08 (`checkSemantics`) je čistá funkce bez IO, takže běží i v prohlížeči, a editor ji volá tak, jak je. Druhá sada pravidel v editoru by se s tou serverovou rozešla a projevilo by se to nejhůř, jak umí: editor by tvrdil, že je šablona v pořádku, a uložení by ji odmítlo. Co si tenhle úkol píše sám, je **převod JSON Pointeru na blok**, protože skok na blok je věc editoru, ne modelu.

- [ ] **Krok 1: Napiš test převodu pointeru na blok**

```ts
// apps/web/src/features/editor/model/validate-client.test.ts
import { describe, expect, it } from 'vitest';
import type { EditorDocument } from './document-types';
import { blockIdAtPointer } from './validate-client';

const doc = {
  schemaVersion: 1,
  meta: { name: 'T', previewText: '', language: 'cs' },
  theme: {},
  blocks: [
    { id: 'b_s1', type: 'section', props: {}, children: [
      { id: 'b_h1', type: 'heading', props: { content: [] } },
      { id: 'b_c1', type: 'columns', props: {}, children: [
        { id: 'b_col1', type: 'column', props: {}, children: [
          { id: 'b_img1', type: 'image', props: { alt: '' } },
        ] },
      ] },
    ] },
  ],
} as EditorDocument;

describe('blockIdAtPointer', () => {
  it.each([
    ['/blocks/0', 'b_s1'],
    ['/blocks/0/props/padding', 'b_s1'],
    ['/blocks/0/children/0/props/content', 'b_h1'],
    ['/blocks/0/children/1/children/0/children/0/props/alt', 'b_img1'],
    ['/blocks/0/children/1/children/0', 'b_col1'],
  ])('z %s najde blok %s', (pointer, expected) => {
    expect(blockIdAtPointer(doc, pointer)).toBe(expected);
  });

  it.each([
    ['/theme/colors'],
    ['/meta/name'],
    [''],
    ['/blocks/9/props/x'],
  ])('u %s nevrátí nic, místo aby uhádl blok', (pointer) => {
    // Nález na motivu nebo na hlavičce k žádnému bloku nepatří. Kdyby se
    // vrátil nejbližší blok, proklik by uživatele poslal někam, kde nic není.
    expect(blockIdAtPointer(doc, pointer)).toBeUndefined();
  });
});
```

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/model/validate-client.test.ts`
Expected: FAIL, `Failed to resolve import "./validate-client"`. Po kroku 3 PASS, 9 testů.

- [ ] **Krok 1b: Napiš test pruhu nálezů**

```tsx
// apps/web/src/features/editor/components/issues/issue-bar.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../../../packages/i18n/messages/cs/editor.json';
import type { EditorDocument } from '../../model/document-types';
import { createEditorStore } from '../../state/editor-store';
import { EditorStoreProvider } from '../../state/use-editor';
import { IssueBar } from './issue-bar';

const document = (): EditorDocument => ({
  schemaVersion: 1, meta: { name: 'T', previewText: '', language: 'cs' }, theme: {},
  blocks: [{ id: 'b_s1', type: 'section', props: {}, children: [{ id: 'b_t1', type: 'text', props: {} }] }],
} as EditorDocument);

function setup(issues: Parameters<ReturnType<typeof createEditorStore>['setIssues']>[0]) {
  const store = createEditorStore({ document: document(), designHash: 'h1' });
  store.setIssues(issues);
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <EditorStoreProvider value={store}><IssueBar /></EditorStoreProvider>
    </NextIntlClientProvider>,
  );
  return store;
}

describe('IssueBar', () => {
  it('bez nálezů se nezobrazuje', () => {
    setup([]);
    expect(screen.queryByRole('region', { name: /Nálezy/ })).toBeNull();
  });

  it('ukazuje počty chyb a varování v ICU tvaru včetně nuly', () => {
    setup([{ code: 'liquid_unknown_field', severity: 'error', blockId: 'b_t1' }]);
    expect(screen.getByText(/1 chyba/)).toBeInTheDocument();
    expect(screen.getByText(/žádné varování/i)).toBeInTheDocument();
  });

  it('známý kód přeloží z katalogu, i když klient žádnou větu nedostal', () => {
    // Klientská validace vrací kód a parametry, ne hotovou větu. Kdyby se
    // spoléhalo na `message`, ukázal by se uživateli holý `content_low_contrast`.
    setup([{ code: 'content_low_contrast', severity: 'warning', blockId: 'b_t1' }]);
    expect(screen.getByText(/špatně čitelný/)).toBeInTheDocument();
  });

  it('kliknutí na nález vybere blok, kterého se týká', async () => {
    const store = setup([{ code: 'content_image_missing_alt', severity: 'warning', blockId: 'b_t1' }]);
    await userEvent.click(screen.getByRole('button', { name: /Obrázek nemá popis/ }));
    expect(store.getState().selectedId).toBe('b_t1');
  });

  it('u neznámého kódu zobrazí detail ze serveru, ne prázdno, kritérium 76 části 6', () => {
    setup([{ code: 'teapot', severity: 'error', message: 'Neznámý stav.' }]);
    expect(screen.getByText(/Neznámý stav/)).toBeInTheDocument();
  });

  it('u neznámého kódu bez detailu zobrazí aspoň kód, ne prázdný řádek', () => {
    setup([{ code: 'teapot', severity: 'error' }]);
    expect(screen.getByText('teapot')).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/issues/issue-bar.test.tsx`
Expected: FAIL, `Failed to resolve import "./issue-bar"`.

- [ ] **Krok 3: Napiš implementaci**

```tsx
// apps/web/src/features/editor/components/issues/issue-bar.tsx
'use client';

import { AlertTriangle, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { EditorIssue } from '../../model/document-types';
import { ISSUE_CODES } from '../../model/issue-codes';
import { useEditorState, useEditorStore } from '../../state/use-editor';

const KNOWN: ReadonlySet<string> = new Set(ISSUE_CODES);

export function IssueBar() {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const issues = useEditorState((state) => state.issues);

  /**
   * Text nálezu. Klientská validace vrací **kód a parametry**, ne hotovou větu,
   * aby šla přeložit a neskládala se ze zřetězených fragmentů (kritérium 71).
   *
   * Neznámý kód se nezahazuje: zobrazí se `detail` ze serveru, přesně jak žádá
   * kritérium 76. Až úplně nakonec se ukáže holý kód, aby uživatel měl co poslat
   * podpoře, i kdyby server neposlal nic.
   */
  const textOf = (issue: EditorIssue): string => {
    if (KNOWN.has(issue.code)) return t(`issue.${issue.code}` as never, issue.params);
    return issue.message ?? issue.code;
  };

  if (issues.length === 0) return null;

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;

  return (
    <section aria-label={t('issues.title')} className="border-b bg-destructive/5 px-4 py-2">
      <p className="text-sm font-medium">
        {t('issues.errorCount', { count: errors })}, {t('issues.warningCount', { count: warnings })}
      </p>
      <ul className="mt-1 space-y-1">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${issue.pointer ?? index}`}>
            <button
              type="button"
              className="flex items-center gap-2 text-left text-xs underline"
              onClick={() => { if (issue.blockId) store.select(issue.blockId); }}
            >
              {issue.severity === 'error'
                ? <XCircle aria-hidden className="size-3 text-destructive" />
                : <AlertTriangle aria-hidden className="size-3" />}
              <span>{textOf(issue)}</span>
              {issue.blockId ? <span className="text-muted-foreground">{t('issues.goToBlock')}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

```ts
// apps/web/src/features/editor/model/validate-client.ts
import { checkSemantics } from '@mlain/emails/document/semantic';
import type { EditorBlock, EditorDocument, EditorIssue } from './document-types';
import type { FieldCatalog } from './field-catalog';

// Typ nálezu je v `document-types.ts`, protože ho potřebuje store z úkolu 11,
// tedy dřív, než vznikne tenhle soubor. Odsud se jen reexportuje.
export type { EditorIssue } from './document-types';

/**
 * Kdo tuhle validaci píše.
 *
 * **Ne tenhle plán.** Pravidla S1 až S16 včetně neznámého pole a návrhu nejbližšího
 * existujícího vlastní P08 a jsou v `checkSemantics`, což je čistá funkce bez IO,
 * takže běží i v prohlížeči. Druhá sada pravidel v editoru by se s tou serverovou
 * rozešla a projevilo by se to nejhorším možným způsobem: editor by tvrdil, že je
 * šablona v pořádku, a uložení by ji odmítlo.
 *
 * Funkce `validateDocument` v `@mlain/contracts/liquid` **neexistuje a nebude**.
 * Kontrakty vystavují `validateLiquid(source, ctx)` nad jedním výrazem, ne nad
 * dokumentem; nad dokumentem ji volá právě `checkSemantics`.
 */
export function validateDocumentClient(
  document: EditorDocument,
  catalog: FieldCatalog,
  options: { assetIds: Set<string>; templateKind?: 'campaign' | 'transactional' | 'system' },
): EditorIssue[] {
  // Odhad velikosti stačí: přesné číslo zná až renderer a pravidlo S9 s tím počítá.
  const estimatedHtmlBytes = new TextEncoder().encode(JSON.stringify(document)).length * 3;

  return checkSemantics(document as never, {
    templateKind: options.templateKind ?? 'campaign',
    fields: catalog,
    assetIds: options.assetIds,
    estimatedHtmlBytes,
  }).map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    pointer: issue.pointer,
    blockId: blockIdAtPointer(document, issue.pointer),
    params: issue.params,
  }));
}

/**
 * Id assetů, na které dokument odkazuje.
 *
 * Pravidlo S8 hlásí `content_asset_not_found` u odkazu na asset, který v projektu
 * není. **To je serverová znalost**, prohlížeč seznam assetů nemá a stránkovaný
 * dotaz by ji nedal spolehlivě. Předá se proto množina id, na která dokument
 * odkazuje, takže se pravidlo na klientovi nikdy nespustí a smazaný obrázek
 * ohlásí až `POST /validate`. Je to vědomé zúžení, ne opomenutí: klientská
 * validace odpovídá do 20 ms a nesmí čekat na síť.
 *
 * `assetIdsInDocument` z `@mlain/core/templates` dělá totéž, ale ta doména sahá
 * na databázi a do prohlížeče nepatří.
 */
export function referencedAssetIds(document: EditorDocument): Set<string> {
  const ids = new Set<string>();
  const visit = (block: EditorBlock): void => {
    for (const key of ['assetId', 'backgroundImageAssetId', 'darkVariantAssetId']) {
      const value = block.props[key];
      if (typeof value === 'string' && value !== '') ids.add(value);
    }
    for (const child of block.children ?? []) visit(child);
  };
  for (const block of document.blocks) visit(block);
  return ids;
}

/**
 * Z JSON Pointeru na blok, kterého se nález týká.
 *
 * Nález nevede na znak v anonymním řetězci, ale na konkrétní blok, na který jde
 * skočit (část 3, 3.7.3). Pointer míří hlouběji než na blok, například na
 * `/props/alt`, takže se jde od kořene a pamatuje se poslední uzel, který má `id`.
 */
export function blockIdAtPointer(document: EditorDocument, pointer: string): string | undefined {
  if (!pointer.startsWith('/')) return undefined;
  let node: unknown = document;
  let lastId: string | undefined;
  for (const rawSegment of pointer.slice(1).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object') return lastId;
    node = Array.isArray(node)
      ? node[Number(segment)]
      : (node as Record<string, unknown>)[segment];
    const id = (node as EditorBlock | undefined)?.id;
    if (typeof id === 'string') lastId = id;
  }
  return lastId;
}
```

```ts
// apps/web/src/features/editor/components/issues/use-validation.ts
'use client';

import { useEffect } from 'react';
import { referencedAssetIds, validateDocumentClient } from '../../model/validate-client';
import type { FieldCatalog } from '../../model/field-catalog';
import type { EditorPorts } from '../../ports/types';
import type { EditorStore } from '../../state/editor-store';

/**
 * Validace běží v prohlížeči, protože musí odpovědět do 20 ms na každý úhoz.
 * Server ji opakuje při uložení, protože klientovi se nevěří (část 3, 3.7.5),
 * a jeho odpověď má přednost: nese kódy, které klient nemá jak zjistit,
 * a hotový `detail` u neznámého kódu (kritérium 76).
 */
export function useValidation(input: {
  store: EditorStore;
  ports: EditorPorts;
  templateId: string;
  fieldCatalog: FieldCatalog;
}) {
  const { fieldCatalog, store } = input;

  useEffect(() => store.subscribe(() => {
    const state = store.getState();
    const issues = validateDocumentClient(state.document, fieldCatalog, {
      assetIds: referencedAssetIds(state.document),
    });
    // Porovnání přes JSON je tady levnější než hloubkové: nálezů jsou jednotky
    // a bez něj by každý úhoz vyvolal nové vykreslení pruhu.
    if (JSON.stringify(issues) !== JSON.stringify(state.issues)) store.setIssues(issues);
  }), [fieldCatalog, store]);

  useEffect(() => {
    let active = true;
    void input.ports.validate({ templateId: input.templateId }).then((result) => {
      if (!active) return;
      store.setIssues(result.findings.map((finding) => ({
        code: finding.code,
        severity: finding.severity,
        message: finding.message,
        pointer: finding.pointer,
        blockId: finding.block_id,
        params: finding.params,
      })));
    }).catch(() => { /* stav se nezmění, chyba načtení řeší pruh stavu */ });
    return () => { active = false; };
  }, [input.ports, input.templateId, store]);
}
```

- [ ] **Krok 4: Spusť oba testy, musí projít**

```bash
pnpm --filter @mlain/web exec vitest run src/features/editor/model/validate-client.test.ts
pnpm --filter @mlain/web exec vitest run src/features/editor/components/issues/issue-bar.test.tsx
```

Expected: PASS, 9 testů v prvním běhu a 6 v druhém.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/model/validate-client.ts \
  apps/web/src/features/editor/model/validate-client.test.ts \
  apps/web/src/features/editor/components/issues
git commit -m "feat(editor): show validation findings with jump to block"
```

---

### Úkol 25: Náhled pro počítač, mobil, tmavý režim, text a zdroj

**Soubory:**
- Create: `apps/web/src/features/editor/components/preview/preview-pane.tsx`, `preview-toolbar.tsx`, `audience-picker.tsx`
- Create: `apps/web/src/features/editor/components/preview/preview-pane.test.tsx`

Náhled **není samostatné vykreslení blokového modelu**. Editor si nechá vyrobit HTML na serveru stejným kódem, jakým se posílá, a zobrazí ho v komponentě K6. Tlačítko „Kontakt bez jména" je kritérium 55 části 6 a je vidět, ne schované: „Dobrý den, ," je nejčastější a nejtrapnější chyba mailingu.

- [ ] **Krok 1: Napiš test**

```tsx
// apps/web/src/features/editor/components/preview/preview-pane.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../packages/i18n/messages/cs/editor.json';
import { createFakePorts } from '../../ports/fake-ports';
import { PreviewPane } from './preview-pane';

function setup(ports = createFakePorts()) {
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <PreviewPane templateId="t1" ports={ports} flush={async () => {}} />
    </NextIntlClientProvider>,
  );
  return ports;
}

describe('PreviewPane', () => {
  it('má čtyři režimy a k tomu nezávislý přepínač tmavého režimu', async () => {
    setup();
    for (const label of ['Počítač', 'Mobil', 'Textová verze', 'Zdroj']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('switch', { name: /Tmavý režim/ })).toBeInTheDocument();
  });

  it('přepnutí tmavého režimu nevolá server znovu', async () => {
    // Tmavý režim kreslí komponenta K6 v prohlížeči. Kdyby byl v závislostech
    // načítání, každé cvaknutí by znamenalo cestu na server a probliknutí náhledu.
    const ports = createFakePorts();
    const preview = vi.spyOn(ports, 'preview');
    setup(ports);
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('switch', { name: /Tmavý režim/ }));
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it('kreslí náhled v iframe se šířkou podle režimu', async () => {
    setup();
    await waitFor(() => expect(screen.getByTitle(/Náhled/)).toBeInTheDocument());
    expect(screen.getByTestId('preview-frame')).toHaveAttribute('data-width', '700');
    await userEvent.click(screen.getByRole('radio', { name: 'Mobil' }));
    expect(screen.getByTestId('preview-frame')).toHaveAttribute('data-width', '375');
  });

  it('tlačítko Kontakt bez jména vyžádá náhled s prázdnými osobními údaji, kritérium 55', async () => {
    const ports = createFakePorts();
    const preview = vi.spyOn(ports, 'preview');
    setup(ports);
    await userEvent.click(screen.getByRole('button', { name: /Kontakt bez jména/ }));
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ previewData: { type: 'sample', variant: 'no_name' } }),
    ));
  });

  it('před vyžádáním náhledu dopíše rozdělanou změnu na server', async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    render(
      <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
        <PreviewPane templateId="t1" ports={createFakePorts()} flush={flush} />
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(flush).toHaveBeenCalled());
  });

  it('textová verze se zobrazí jako text, ne jako HTML', async () => {
    setup();
    await userEvent.click(screen.getByRole('radio', { name: 'Textová verze' }));
    await waitFor(() => expect(screen.getByTestId('preview-text')).toHaveTextContent('Dobrý den'));
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/preview/preview-pane.test.tsx`
Expected: FAIL, `Failed to resolve import "./preview-pane"`.

- [ ] **Krok 3: Napiš implementaci**

```tsx
// apps/web/src/features/editor/components/preview/preview-pane.tsx
'use client';

import { EmailPreview } from '@mlain/ui/patterns/email-preview';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { PREVIEW_WIDTHS } from '../../config';
import type { EditorPorts, PreviewData } from '../../ports/types';
import { AudiencePicker } from './audience-picker';
import { PreviewToolbar, type PreviewMode } from './preview-toolbar';

export function PreviewPane(props: {
  templateId: string;
  ports: EditorPorts;
  flush: () => Promise<void>;
}) {
  const t = useTranslations('editor');
  const [mode, setMode] = useState<PreviewMode>('desktop');
  const [dark, setDark] = useState(false);
  const [data, setData] = useState<PreviewData>({ type: 'sample', variant: 'default' });
  const [result, setResult] = useState<{ html: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Závislosti jsou schválně jen `data`: přepnutí tmavého režimu ani šířky
  // nový náhled nevyžaduje, obojí kreslí komponenta K6 v prohlížeči. Kdyby
  // tu byl `dark`, každé cvaknutí přepínače by znamenalo cestu na server.
  const load = useCallback(async () => {
    setError(null);
    await props.flush();          // náhled kreslí právě to, co je v editoru
    try {
      setResult(await props.ports.preview({ templateId: props.templateId, previewData: data }));
    } catch {
      setResult(null);
      setError(t('preview.failed'));
    }
  }, [data, props, t]);

  useEffect(() => { void load(); }, [load]);

  const width = mode === 'mobile' ? PREVIEW_WIDTHS.mobile : PREVIEW_WIDTHS.desktop;

  return (
    <div className="flex flex-1 flex-col">
      <PreviewToolbar mode={mode} onMode={setMode} dark={dark} onDark={setDark} />
      <AudiencePicker ports={props.ports} value={data} onChange={setData} />
      <div className="flex flex-1 justify-center overflow-auto bg-muted p-4">
        {error ? <p role="alert">{error}</p> : null}
        {result && mode === 'text' ? (
          <pre data-testid="preview-text" className="w-full whitespace-pre-wrap bg-background p-4 text-sm">
            {result.text}
          </pre>
        ) : null}
        {result && mode === 'source' ? (
          <div className="w-full">
            <p className="mb-1 text-xs text-muted-foreground">
              {t('preview.sizeKb', { size: Math.round(new Blob([result.html]).size / 1024) })}
            </p>
            <pre className="overflow-x-auto bg-background p-4 font-mono text-xs">{result.html}</pre>
          </div>
        ) : null}
        {result && (mode === 'desktop' || mode === 'mobile') ? (
          <div data-testid="preview-frame" data-width={width}>
            <EmailPreview html={result.html} width={width} dark={dark} title={t('preview.frameTitle')} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

```tsx
// apps/web/src/features/editor/components/preview/preview-toolbar.tsx
'use client';

import { Switch } from '@mlain/ui/components/switch';
import { useTranslations } from 'next-intl';

export type PreviewMode = 'desktop' | 'mobile' | 'text' | 'source';

const MODES: PreviewMode[] = ['desktop', 'mobile', 'text', 'source'];

export function PreviewToolbar(props: {
  mode: PreviewMode;
  onMode: (mode: PreviewMode) => void;
  dark: boolean;
  onDark: (dark: boolean) => void;
}) {
  const t = useTranslations('editor');
  return (
    <div className="flex items-center justify-between border-b p-2">
      <div role="radiogroup" aria-label={t('preview.modes')} className="flex gap-1">
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={props.mode === mode}
            className="rounded px-2 py-1 text-sm aria-checked:bg-accent"
            onClick={() => props.onMode(mode)}
          >
            {t(`preview.${mode}`)}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch aria-label={t('preview.dark')} checked={props.dark} onCheckedChange={props.onDark} />
        {t('preview.dark')}
      </label>
    </div>
  );
}
```

```tsx
// apps/web/src/features/editor/components/preview/audience-picker.tsx
'use client';

import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ContactSummary, EditorPorts, PreviewData } from '../../ports/types';

export function AudiencePicker(props: {
  ports: EditorPorts;
  value: PreviewData;
  onChange: (data: PreviewData) => void;
}) {
  const t = useTranslations('editor');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ContactSummary[]>([]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b p-2">
      <label className="text-sm">
        {t('preview.viewAs')}
        <Input
          className="ml-2 inline-block w-56"
          value={query}
          aria-label={t('preview.viewAs')}
          onChange={async (event) => {
            const next = event.target.value;
            setQuery(next);
            setFound(next.length >= 2 ? await props.ports.searchContacts(next) : []);
          }}
        />
      </label>
      {found.length > 0 ? (
        <ul className="flex gap-1">
          {found.map((contact) => (
            <li key={contact.id}>
              <Button variant="outline" size="sm"
                onClick={() => { props.onChange({ type: 'contact', contactId: contact.id }); setFound([]); setQuery(contact.name); }}>
                {contact.name || contact.email}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button variant="outline" size="sm" onClick={async () => {
        const contact = await props.ports.randomContact();
        if (contact) { props.onChange({ type: 'contact', contactId: contact.id }); setQuery(contact.name); }
      }}>{t('preview.randomContact')}</Button>
      <Button variant="outline" size="sm" onClick={() => {
        props.onChange({ type: 'sample', variant: 'no_name' });
        setQuery('');
      }}>{t('preview.noNameContact')}</Button>
      <Button variant="ghost" size="sm" onClick={() => {
        props.onChange({ type: 'sample', variant: 'default' });
        setQuery('');
      }}>{t('preview.sampleData')}</Button>
    </div>
  );
}
```

- [ ] **Krok 4: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/preview/preview-pane.test.tsx`
Expected: PASS, 6 testů.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/components/preview
git commit -m "feat(editor): add preview pane with desktop, mobile, dark, text and source modes"
```

---

### Úkol 26: Testovací odeslání

**Soubory:**
- Create: `apps/web/src/features/editor/components/test-send/test-send-dialog.tsx`
- Create: `apps/web/src/features/editor/components/test-send/test-send-dialog.test.tsx`

- [ ] **Krok 1: Napiš test**

```tsx
// apps/web/src/features/editor/components/test-send/test-send-dialog.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../packages/i18n/messages/cs/editor.json';
import { createFakePorts } from '../../ports/fake-ports';
import { TestSendDialog } from './test-send-dialog';

function setup(ports = createFakePorts()) {
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <TestSendDialog open templateId="t1" ports={ports} flush={async () => {}} onClose={() => {}} />
    </NextIntlClientProvider>,
  );
  return ports;
}

describe('TestSendDialog', () => {
  it('odešle na zadané adresy s prefixem předmětu', async () => {
    const ports = createFakePorts();
    const testSend = vi.spyOn(ports, 'testSend');
    setup(ports);
    await userEvent.type(screen.getByLabelText(/Adresy/), 'a@b.cz, c@d.cz');
    await userEvent.click(screen.getByRole('button', { name: /Poslat test/ }));
    await waitFor(() => expect(testSend).toHaveBeenCalledWith(expect.objectContaining({
      recipients: ['a@b.cz', 'c@d.cz'], addTestPrefix: true,
    })));
  });

  it('víc než pět adres nepřijme a řekne proč', async () => {
    setup();
    await userEvent.type(screen.getByLabelText(/Adresy/), 'a@b.cz,b@b.cz,c@b.cz,d@b.cz,e@b.cz,f@b.cz');
    await userEvent.click(screen.getByRole('button', { name: /Poslat test/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/pět/);
  });

  it('u překročeného limitu ukáže dobu čekání, ne surovou chybu', async () => {
    setup(createFakePorts({ testSend: async () => ({ ok: false, code: 'rate_limited', retryAfter: 900 }) }));
    await userEvent.type(screen.getByLabelText(/Adresy/), 'a@b.cz');
    await userEvent.click(screen.getByRole('button', { name: /Poslat test/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/15 minut/);
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/test-send/test-send-dialog.test.tsx`
Expected: FAIL, `Failed to resolve import "./test-send-dialog"`.

- [ ] **Krok 3: Napiš implementaci**

```tsx
// apps/web/src/features/editor/components/test-send/test-send-dialog.tsx
'use client';

import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@mlain/ui/components/dialog';
import { Input } from '@mlain/ui/components/input';
import { Switch } from '@mlain/ui/components/switch';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { EditorPorts, PreviewData } from '../../ports/types';

const MAX_RECIPIENTS = 5;

export function TestSendDialog(props: {
  open: boolean;
  templateId: string;
  ports: EditorPorts;
  flush: () => Promise<void>;
  onClose: () => void;
  previewData?: PreviewData;
}) {
  const t = useTranslations('editor');
  const [raw, setRaw] = useState('');
  const [prefix, setPrefix] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    const recipients = raw.split(',').map((value) => value.trim()).filter(Boolean);
    setDone(false);
    if (recipients.length === 0) { setProblem(t('testSend.noRecipients')); return; }
    if (recipients.length > MAX_RECIPIENTS) { setProblem(t('testSend.tooMany', { max: MAX_RECIPIENTS })); return; }
    setProblem(null);
    await props.flush();
    const result = await props.ports.testSend({
      templateId: props.templateId,
      recipients,
      addTestPrefix: prefix,
      previewData: props.previewData ?? { type: 'sample', variant: 'default' },
    });
    if (result.ok) { setDone(true); return; }
    setProblem(result.code === 'rate_limited'
      ? t('testSend.rateLimited', { minutes: Math.ceil((result.retryAfter ?? 0) / 60) })
      : t('testSend.failed', { code: result.code }));
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent>
        <DialogTitle>{t('testSend.title')}</DialogTitle>
        <label className="block text-sm">
          {t('testSend.recipients')}
          <Input value={raw} aria-label={t('testSend.recipients')} onChange={(event) => setRaw(event.target.value)} />
        </label>
        <p className="text-xs text-muted-foreground">{t('testSend.recipientsHint', { max: MAX_RECIPIENTS })}</p>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={prefix} onCheckedChange={setPrefix} aria-label={t('testSend.prefix')} />
          {t('testSend.prefix')}
        </label>
        <p className="text-xs text-muted-foreground">{t('testSend.explain')}</p>
        {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
        {done ? <p role="status" className="text-sm">{t('testSend.success')}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onClose}>{t('common.cancel')}</Button>
          <Button onClick={submit}>{t('testSend.submit')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Krok 4: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/test-send/test-send-dialog.test.tsx`
Expected: PASS, 3 testy.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/editor/components/test-send
git commit -m "feat(editor): add test send dialog with recipient limit and rate limit message"
```

---

### Úkol 27: Katalog i18n `editor` a jeho pojistky

**Soubory:**
- Create: `packages/i18n/messages/cs/editor.json`
- Create: `packages/i18n/messages/en/editor.json`
- Create: `apps/web/src/features/editor/model/issue-codes.ts`
- Create: `apps/web/src/features/editor/i18n.test.ts`

Katalog je **jediný soubor na jazyk, který tenhle plán vlastní v `packages/i18n`** (uzávěr S4). Pojistky jsou tři: shoda klíčů, zákaz dlouhé pomlčky a slovník. Slovník hlídá i rozhodnutí R10 o slově „Personalizace".

- [ ] **Krok 1: Napiš test**

```ts
// apps/web/src/features/editor/i18n.test.ts
import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import cs from '../../../../packages/i18n/messages/cs/editor.json';
import en from '../../../../packages/i18n/messages/en/editor.json';
import { ISSUE_CODES } from './model/issue-codes';

const flatten = (value: unknown, prefix = ''): string[] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
    : [prefix];

const values = (value: unknown): string[] =>
  typeof value === 'string' ? [value]
    : typeof value === 'object' && value !== null ? Object.values(value).flatMap(values) : [];

/** Dvojice klíč a hodnota. Klíč je v hlášce testu, jinak se hledá jehla v kupce sena. */
const pairs = (value: unknown, prefix = ''): Array<[string, string]> =>
  typeof value === 'string' ? [[prefix, value]]
    : typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, child]) => pairs(child, prefix ? `${prefix}.${key}` : key))
      : [];

describe('katalog editor', () => {
  it('má v obou jazycích tytéž klíče, kritérium 70 části 6', () => {
    expect(flatten(cs).sort()).toEqual(flatten(en).sort());
  });

  it('neobsahuje dlouhou pomlčku, kritérium 68 části 6', () => {
    for (const text of [...values(cs), ...values(en)]) expect(text).not.toContain('—');
  });

  it('pro merge tag používá slovo Personalizace, ne zakázané varianty, rozhodnutí R10', () => {
    const czech = values(cs).join(' ').toLowerCase();
    expect(czech).toContain('personalizace');
    for (const forbidden of ['doplňovaný údaj', 'slučovací značk', 'merge tag', 'placeholder', 'proměnná']) {
      expect(czech, forbidden).not.toContain(forbidden);
    }
  });

  it('nepoužívá zakázané tvary tlačítek ze slovníku 9.3 části 6', () => {
    const czech = values(cs);
    for (const forbidden of ['OK', 'Potvrdit', 'Odeslat formulář', 'Submit', 'Done', 'Next', 'Finish']) {
      expect(czech, forbidden).not.toContain(forbidden);
    }
  });

  it('počty používají ICU plural včetně kategorie =0, kritérium 72 části 6', () => {
    for (const key of ['issues.errorCount', 'issues.warningCount', 'block.socialCount']) {
      const message = key.split('.').reduce<never>((value, part) => (value as never)[part], cs as never) as unknown as string;
      expect(message, key).toMatch(/plural/);
      expect(message, key).toMatch(/=0/);
    }
  });

  it('každý český plural má i kategorii many, jinak spadne i18n-check', () => {
    // Kritérium 72 mluví o `=0`, ale to nestačí. V češtině je `many` kategorie
    // pro desetinná čísla (1,5 chyby) a kontrola `icu-validity.test.ts` z P05 ji
    // vyžaduje u každého plurálu. Bez ní spadne job `i18n-check` a s ním build,
    // a to až v CI, ne tady. Tenhle případ ho chytí v jednotkovém běhu plánu.
    const missing: string[] = [];
    for (const [key, value] of pairs(cs)) {
      if (!value.includes(', plural,')) continue;
      for (const category of ['=0 {', 'one {', 'few {', 'many {', 'other {']) {
        if (!value.includes(category)) missing.push(`${key} postrádá ${category.trim()}`);
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('anglický plural má =0, one i other', () => {
    const missing: string[] = [];
    for (const [key, value] of pairs(en)) {
      if (!value.includes(', plural,')) continue;
      for (const category of ['=0 {', 'one {', 'other {']) {
        if (!value.includes(category)) missing.push(`${key} postrádá ${category.trim()}`);
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('desetinné číslo v češtině dá tvar many, ne tvar pro pět a víc', () => {
    // Ostrá kontrola, ne jen přítomnost kategorie: `many {# chyb}` by testem
    // výš prošlo a přitom je špatně česky.
    const format = new IntlMessageFormat(cs.issues.errorCount, 'cs');
    expect(format.format({ count: 1 })).toBe('1 chyba');
    expect(format.format({ count: 2 })).toBe('2 chyby');
    expect(format.format({ count: 5 })).toBe('5 chyb');
    expect(format.format({ count: 1.5 })).toBe('1,5 chyby');
  });

  it('každá zpráva se dá zkompilovat jako ICU', () => {
    const broken: string[] = [];
    for (const [locale, tree] of [['cs', cs], ['en', en]] as const) {
      for (const [key, value] of pairs(tree)) {
        try { new IntlMessageFormat(value, locale); }
        catch (error) { broken.push(`${locale} ${key}: ${(error as Error).message}`); }
      }
    }
    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('neporuší slovník 9.2, který hlídá brána P05', () => {
    // Zkrácený seznam `BANNED_CS` z `packages/i18n/src/checks/glossary.ts`.
    // Kopie je vědomá: kontrola P05 běží nad složeným stromem až v CI, tenhle
    // případ chytí porušení při psaní katalogu. Slovo „personalizace" v seznamu
    // **není a být nesmí**, je to závazný český název (rozhodnutí R10 a R17).
    //
    // Porovnává se proti celé zprávě včetně jmen ICU slotů, protože přesně tak
    // to `findViolations` dnes dělá. Slot pojmenovaný `{workspace}` by tedy
    // shodil bránu na jinak správně napsaném textu; tenhle plán žádný takový nemá.
    const banned = ['pracovní prostor', 'workspace', 'odběratel', 'blacklist', 'černá listina',
      'pískoviště', 'kvóta', 'placeholder', 'slučovací značka', 'doplňovaný údaj', 'merge tag',
      'preference centrum', 'dvojité přihlášení', 'unikátní otevření', 'trackování',
      'prokliková míra', 'odregistrovat', 'zaregistrovat', 'joba', 'háček', 'administrátor',
      'majitel'];
    const violations: string[] = [];
    for (const [key, value] of pairs(cs)) {
      for (const term of banned) {
        if (value.toLocaleLowerCase('cs').includes(term)) violations.push(`${key}: ${term}`);
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('má text ke každému kódu nálezu, který klientská validace umí vyrobit', () => {
    // Bez toho by pruh nálezů ukazoval holý kód typu `content_low_contrast`.
    for (const code of ISSUE_CODES) {
      expect(cs.issue, code).toHaveProperty(code);
    }
  });
});
```

`ISSUE_CODES` je seznam kódů, které vrací `checkSemantics` z P08 a validátor Liquidu z P02. Bydlí u klientské validace, aby se seznam nepsal dvakrát:

```ts
// apps/web/src/features/editor/model/issue-codes.ts
/**
 * Kódy, které se mohou objevit v pruhu nálezů z klientské validace.
 *
 * **Nejsou to nové kódy.** Registr chyb vlastní P01 a pravidla je vyrábí v P08
 * a P02; tenhle seznam existuje jen proto, aby test katalogu poznal, ke kterému
 * kódu chybí český a anglický text. Neznámý kód editor nezahodí: podle
 * kritéria 76 zobrazí `detail` ze serveru a `request_id`.
 */
export const ISSUE_CODES = [
  'content_asset_not_found', 'content_condition_field_unknown', 'content_condition_on_unsubscribe',
  'content_condition_operator_invalid', 'content_duplicate_block_id', 'content_duplicate_footer',
  'content_html_too_large', 'content_image_missing_alt', 'content_link_anchor_only',
  'content_link_scheme_forbidden', 'content_low_contrast', 'content_missing_unsubscribe',
  'content_nested_columns', 'content_nested_repeat', 'content_padding_overflow',
  'content_raw_html_forbidden', 'content_reserved_marker', 'content_too_many_blocks',
  'content_too_many_links',
  'liquid_comparison_operator_not_supported', 'liquid_contains_not_allowed',
  'liquid_date_format_not_allowed', 'liquid_default_value_invalid',
  'liquid_escaped_entity_in_construct', 'liquid_filter_not_allowed',
  'liquid_for_parameter_not_allowed', 'liquid_in_trackable_href', 'liquid_index_not_allowed',
  'liquid_literal_not_supported', 'liquid_nested_for', 'liquid_parentheses_not_allowed',
  'liquid_string_literal_not_allowed', 'liquid_tag_not_allowed', 'liquid_unknown_field',
  'liquid_unknown_root', 'liquid_vocative_filter', 'liquid_whitespace_control_not_allowed',
] as const;
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/i18n.test.ts`
Expected: FAIL, katalogy neexistují.

- [ ] **Krok 3: Napiš český katalog**

```json
{
  "common": { "cancel": "Zrušit", "close": "Zavřít", "tryAgain": "Zkusit znovu", "details": "Podrobnosti" },
  "header": {
    "back": "Zpět na šablony", "saved": "Uloženo v {time}", "saving": "Ukládáme…",
    "saveFailed": "Nepodařilo se uložit, zkoušíme to znovu", "unsaved": "Neuložené změny",
    "preview": "Náhled", "edit": "Zpět k úpravám", "testSend": "Poslat test", "rename": "Název šablony"
  },
  "palette": {
    "title": "Bloky", "hint": "Blok přidáte tlačítkem plus mezi bloky nebo přetažením.",
    "group": { "content": "Obsah", "layout": "Rozvržení" }
  },
  "block": {
    "section": "Sekce", "columns": "Sloupce", "columns2": "Dva sloupce", "columns3": "Tři sloupce",
    "column": "Sloupec", "heading": "Nadpis", "text": "Text", "image": "Obrázek", "button": "Tlačítko",
    "divider": "Oddělovač", "spacer": "Mezera", "social": "Sociální sítě", "footer": "Patička",
    "html": "Vlastní HTML", "unknown": "Neznámý blok", "columnsWithLayout": "Sloupce {layout}",
    "socialCount": "{count, plural, =0 {žádná síť} one {# síť} few {# sítě} many {# sítě} other {# sítí}}",
    "lockedHint": "Blok typu {type} tato verze editoru neumí upravit. Zůstane v šabloně beze změny.",
    "htmlForbidden": "Vlastní HTML smí upravovat jen člen s oprávněním templates:write_html.",
    "htmlConditionHint": "Podmínku zobrazení nastavte v panelu vlastností, ne psaním do kódu."
  },
  "group": {
    "content": "Obsah", "style": "Vzhled", "layout": "Rozvržení", "mobile": "Mobil",
    "visibility": "Zobrazení", "emailLayout": "E-mail", "typography": "Písmo", "darkMode": "Tmavý režim"
  },
  "prop": {
    "content": "Text", "buttonLabel": "Popisek", "level": "Úroveň", "color": "Barva",
    "linkColor": "Barva odkazů", "align": "Zarovnání", "fontFamily": "Písmo",
    "fontSize": "Velikost písma", "fontWeight": "Tloušťka písma", "lineHeight": "Řádkování",
    "letterSpacing": "Prostrkání", "padding": "Odsazení", "backgroundColor": "Barva pozadí",
    "outerBackgroundColor": "Pozadí na celou šířku", "backgroundImage": "Obrázek na pozadí",
    "backgroundPosition": "Umístění pozadí", "fullWidth": "Na celou šířku",
    "roundedTop": "Zaoblit nahoře", "roundedBottom": "Zaoblit dole", "hideOnMobile": "Skrýt na mobilu",
    "visibleWhen": "Zobrazit, jen když", "layout": "Poměr sloupců", "gap": "Mezera mezi sloupci",
    "verticalAlign": "Svislé zarovnání", "stackOnMobile": "Na mobilu pod sebe",
    "stackOrder": "Pořadí na mobilu", "borderRadius": "Zaoblení rohů", "asset": "Obrázek",
    "alt": "Popis obrázku", "decorative": "Jen ozdoba", "href": "Odkaz", "width": "Šířka",
    "darkVariant": "Obrázek pro tmavý režim", "buttonStyle": "Styl", "textColor": "Barva textu",
    "borderColor": "Barva rámečku", "borderWidth": "Tloušťka rámečku", "paddingX": "Odsazení na šířku",
    "paddingY": "Odsazení na výšku", "thickness": "Tloušťka", "lineStyle": "Styl čáry",
    "lineWidth": "Šířka čáry", "height": "Výška", "heightMobile": "Výška na mobilu",
    "socialItems": "Sítě", "iconStyle": "Styl ikon", "iconSize": "Velikost ikon", "code": "HTML kód",
    "senderInfo": "Údaje odesílatele", "showUnsubscribe": "Odkaz na odhlášení",
    "unsubscribeLabel": "Text odkazu na odhlášení", "showPreferences": "Odkaz na předvolby",
    "preferencesLabel": "Text odkazu na předvolby", "showWebview": "Odkaz na zobrazení v prohlížeči",
    "webviewLabel": "Text odkazu na prohlížeč", "contentWidth": "Šířka obsahu",
    "canvasBackground": "Pozadí plátna", "contentBackground": "Pozadí obsahu", "radius": "Zaoblení",
    "headingFont": "Písmo nadpisů", "bodyFont": "Písmo textu", "baseFontSize": "Základní velikost písma",
    "baseLineHeight": "Základní řádkování", "headingScale": "Poměr velikostí nadpisů",
    "darkMode": "Tmavý režim"
  },
  "value": {
    "inherited": "Podle motivu", "useDefault": "Použít hodnotu z motivu",
    "align": { "left": "Vlevo", "center": "Na střed", "right": "Vpravo", "justify": "Do bloku" },
    "valign": { "top": "Nahoru", "middle": "Na střed", "bottom": "Dolů" },
    "position": { "top": "Nahoře", "center": "Na střed", "bottom": "Dole" },
    "side": { "top": "Nahoře", "right": "Vpravo", "bottom": "Dole", "left": "Vlevo" },
    "level": { "1": "Nadpis 1", "2": "Nadpis 2", "3": "Nadpis 3" },
    "weight": { "400": "Běžné", "600": "Polotučné", "700": "Tučné" },
    "layout": {
      "1-1": "50 a 50", "1-2": "33 a 67", "2-1": "67 a 33", "1-1-1": "Tři stejné",
      "2-1-1": "50, 25 a 25", "1-1-2": "25, 25 a 50"
    },
    "stackOrder": { "normal": "Zleva doprava", "reverse": "Zprava doleva" },
    "buttonStyle": { "solid": "Vyplněné", "outline": "Obrysové" },
    "borderWidth": { "0": "Bez rámečku", "1": "1 px", "2": "2 px" },
    "thickness": { "1": "1 px", "2": "2 px", "3": "3 px", "4": "4 px" },
    "lineStyle": { "solid": "Plná", "dashed": "Čárkovaná", "dotted": "Tečkovaná" },
    "iconStyle": { "color": "Barevné", "monoDark": "Jednobarevné tmavé", "monoLight": "Jednobarevné světlé" },
    "width": { "600": "600 px", "640": "640 px" },
    "radius": { "0": "Ostré rohy", "4": "4 px", "6": "6 px", "8": "8 px", "12": "12 px" },
    "scale": { "1125": "Jemný", "12": "Mírný", "125": "Výchozí", "1333": "Výrazný" },
    "darkMode": { "auto": "Podle nastavení příjemce", "off": "Vypnout" },
    "font": {
      "system": "Systémové", "arial": "Arial", "helvetica": "Helvetica", "verdana": "Verdana",
      "tahoma": "Tahoma", "trebuchet": "Trebuchet MS", "georgia": "Georgia", "times": "Times New Roman",
      "courier": "Courier New"
    },
    "color": {
      "none": "Průhledné", "custom": "Vlastní barva", "brand.primary": "Hlavní barva značky",
      "brand.secondary": "Doplňková barva značky", "brand.accent": "Zvýrazňovací barva",
      "text.default": "Text", "text.muted": "Ztlumený text", "text.inverted": "Text na barvě",
      "surface.canvas": "Plátno", "surface.content": "Obsah", "surface.subtle": "Jemné pozadí",
      "link.default": "Odkaz"
    }
  },
  "hint": {
    "outlookIgnored": "Tento efekt se v Outlooku na Windows nezobrazí.",
    "outlookRadius": "Zaoblení se v Outlooku na Windows nezobrazí.",
    "outlookLineStyle": "Čárkovaná a tečkovaná čára vypadá v Outlooku jinak.",
    "altRequired": "Popis přečte čtečka obrazovky a zobrazí se, když se obrázek nenačte.",
    "altMissing": "Chybí popis obrázku",
    "decorative": "Ozdobný obrázek čtečka přeskočí a popis nepotřebuje.",
    "darkVariant": "Alternativní obrázek pro příjemce s tmavým režimem.",
    "unsubscribeRequired": "U kampaní musí odkaz na odhlášení zůstat zapnutý."
  },
  "op": {
    "moveUp": "Posunout nahoru", "moveDown": "Posunout dolů", "moveOut": "Vysunout o úroveň výš",
    "moveIn": "Zasunout do sloupce", "duplicate": "Duplikovat", "delete": "Smazat",
    "insertAfter": "Přidat blok za", "edit": "Upravit obsah", "selectPrev": "Vybrat předchozí blok",
    "selectNext": "Vybrat další blok", "selectParent": "Vybrat nadřazený blok",
    "selectChild": "Vybrat první vnořený blok", "undo": "Vrátit akci", "redo": "Provést znovu",
    "escape": "Zrušit výběr"
  },
  "insert": { "after": "Přidat blok za {block}" },
  "a11y": {
    "canvas": "Obsah e-mailu", "propertiesPanel": "Vlastnosti vybraného bloku",
    "blockMoved": "{block}, pozice {position} z {total}",
    "moveBlocked": "{block} už nejde posunout dál tímto směrem.",
    "blockDuplicated": "{block} zduplikován.", "duplicateBlocked": "{block} nejde duplikovat.",
    "blockDeleted": "{block} smazán.", "blockInserted": "{block} přidán.", "undone": "Akce vrácena.",
    "redone": "Akce provedena znovu."
  },
  "visibility": {
    "always": "Vždy", "field": "Pole", "operator": "Podmínka",
    "badge": "Zobrazí se, jen když {field} {op}",
    "op": { "present": "je vyplněné", "blank": "je prázdné", "true": "je zapnuté", "false": "je vypnuté" }
  },
  "richtext": {
    "toolbar": "Formátování textu", "label": "Text bloku", "placeholder": "Napište text…",
    "bold": "Tučně", "italic": "Kurzíva", "underline": "Podtrženo", "strike": "Přeškrtnuto",
    "link": "Odkaz", "linkUrl": "Adresa odkazu", "linkApply": "Vložit odkaz",
    "linkRemove": "Odebrat odkaz", "bulletList": "Odrážky", "orderedList": "Číslovaný seznam",
    "insertPersonalization": "Vložit personalizaci"
  },
  "token": {
    "title": "Personalizace",
    "tooltip": "Personalizace: {label}. Při odeslání se nahradí hodnotou u konkrétního příjemce.",
    "fallbackLabel": "Náhradní hodnota",
    "fallbackHint": "Použije se, když příjemce hodnotu vyplněnou nemá.",
    "fallbackInvalid": "Náhradní hodnota nesmí obsahovat uvozovku ani znaky složených a špičatých závorek.",
    "dateFormatLabel": "Formát data", "dateFormatDefault": "Podle nastavení projektu",
    "dateFormat": {
      "%d.%m.%Y": "31.07.2026", "%-d.%-m.%Y": "31.7.2026", "%Y-%m-%d": "2026-07-31",
      "%d.%m.%Y %H:%M": "31.07.2026 14:32", "%H:%M": "14:32"
    },
    "longTextHint": "Odřádkování se v e-mailu neprojeví.",
    "unknownField": "Pole v tomto projektu neexistuje.", "suggestion": "Nejspíš chcete {suggestion}."
  },
  "personalization": {
    "search": "Hledat pole", "empty": "Žádné pole neodpovídá.", "groupSystem": "Systémové odkazy",
    "groupContact": "Údaje kontaktu", "groupCustom": "Vlastní pole"
  },
  "field": {
    "unsubscribeUrl": "Odkaz na odhlášení", "preferencesUrl": "Odkaz na předvolby",
    "webviewUrl": "Zobrazení v prohlížeči", "campaignName": "Název kampaně",
    "campaignSubject": "Předmět kampaně", "workspaceName": "Název projektu",
    "senderAddress": "Poštovní adresa odesílatele", "email": "E-mail", "firstName": "Jméno",
    "lastName": "Příjmení", "firstNameVocative": "Jméno v 5. pádu",
    "lastNameVocative": "Příjmení v 5. pádu", "titlePrefix": "Titul před jménem",
    "titleSuffix": "Titul za jménem", "greeting": "Oslovení", "gender": "Rod",
    "locale": "Jazyk kontaktu", "createdAt": "Datum vzniku"
  },
  "social": {
    "network": "Síť", "href": "Odkaz", "add": "Přidat síť", "remove": "Odebrat síť",
    "max": "Víc než {max} sítí nejde přidat.", "facebook": "Facebook", "instagram": "Instagram",
    "x": "X", "linkedin": "LinkedIn", "youtube": "YouTube", "tiktok": "TikTok", "threads": "Threads",
    "pinterest": "Pinterest", "bluesky": "Bluesky", "mastodon": "Mastodon", "web": "Web",
    "email": "E-mail"
  },
  "asset": {
    "title": "Obrázky", "pick": "Vybrat obrázek", "change": "Změnit obrázek", "remove": "Odebrat",
    "upload": "Nahrát obrázek"
  },
  "link": {
    "schemeForbidden": "Odkaz musí začínat https, http, mailto nebo tel.",
    "liquidForbidden": "Do sledovaného odkazu nejde vložit personalizaci.",
    "trackable": "Sledovat prokliky"
  },
  "theme": { "title": "Motiv" },
  "meta": { "previewText": "Úvodní řádek" },
  "issues": {
    "title": "Nálezy v šabloně",
    "errorCount": "{count, plural, =0 {žádná chyba} one {# chyba} few {# chyby} many {# chyby} other {# chyb}}",
    "warningCount": "{count, plural, =0 {žádné varování} one {# varování} few {# varování} many {# varování} other {# varování}}",
    "goToBlock": "Přejít na blok"
  },
  "preview": {
    "desktop": "Počítač", "mobile": "Mobil", "text": "Textová verze", "source": "Zdroj",
    "dark": "Tmavý režim", "modes": "Režim náhledu", "frameTitle": "Náhled e-mailu",
    "viewAs": "Zobrazit jako", "randomContact": "Náhodný kontakt", "noNameContact": "Kontakt bez jména",
    "sampleData": "Vzorová data", "sizeKb": "Velikost {size} kB",
    "failed": "Náhled se nepodařilo vytvořit."
  },
  "testSend": {
    "title": "Testovací e-mail", "recipients": "Adresy", "submit": "Poslat test",
    "recipientsHint": "Nejvýš {max} adres oddělených čárkou.",
    "prefix": "Přidat do předmětu značku TEST",
    "explain": "Testovací e-mail se nepočítá do statistik a nesleduje otevření ani prokliky.",
    "noRecipients": "Zadejte aspoň jednu adresu.", "tooMany": "Najednou jde poslat nejvýš pět adres.",
    "rateLimited": "Limit testovacích e-mailů je vyčerpaný. Zkuste to za {minutes} minut.",
    "failed": "Test se nepodařilo odeslat ({code}).", "success": "Testovací e-mail odešel."
  },
  "state": {
    "loading": "Načítáme šablonu…", "loadFailed": "Šablonu se nepodařilo načíst.",
    "notFound": "Šablona neexistuje nebo byla smazána.",
    "forbidden": "K úpravám šablon je potřeba oprávnění templates:write.",
    "readOnly": "Šablonu si můžete prohlédnout, ale ne upravit.",
    "schemaTooNew": "Šablona pochází z novější verze nástroje a v tomto editoru ji otevřít nejde.",
    "tooManyBlocks": "Šablona má nejvýš 300 bloků, tenhle limit je vyčerpaný.",
    "tooLarge": "Šablona přesáhla 512 kB a nejde uložit.",
    "offline": "Jste offline, změny odešleme po obnovení spojení.",
    "conflictTitle": "Šablonu mezitím upravil někdo jiný",
    "conflictBody": "Máte otevřenou starší verzi. Můžete načíst novou, nebo si nejdřív zkopírovat svoje změny.",
    "conflictReload": "Načíst novou verzi",
    "notFoundBody": "Mohla ji smazat jiná osoba, nebo je adresa překlepnutá.",
    "backToList": "Zpět na seznam šablon",
    "forbiddenBody": "K otevření šablony je potřeba oprávnění templates:read. Vaše role ho nemá.",
    "forbiddenWhoCanHelp": "Roli vám může změnit vlastník projektu."
  },
  "list": {
    "title": "Šablony", "empty": "Zatím nemáte žádnou šablonu.",
    "emptyHint": "Šablona je obsah e-mailu, který si připravíte jednou a použijete v libovolné kampani.",
    "create": "Vytvořit šablonu", "open": "Otevřít", "loadFailed": "Šablony se nepodařilo načíst.",
    "createFailed": "Šablonu se nepodařilo vytvořit.", "newName": "Nová šablona"
  },
  "issue": {
    "content_asset_not_found": "Obrázek už v knihovně není.",
    "content_condition_field_unknown": "Podmínka se odkazuje na pole, které v projektu neexistuje.",
    "content_condition_on_unsubscribe": "Blok s odkazem na odhlášení nesmí mít podmínku zobrazení.",
    "content_condition_operator_invalid": "Tahle podmínka se k typu pole nehodí.",
    "content_duplicate_block_id": "Dva bloky mají stejné id.",
    "content_duplicate_footer": "Patička smí být v šabloně jen jedna.",
    "content_html_too_large": "E-mail je moc velký. Gmail delší zprávu ořízne a odkaz na odhlášení zmizí.",
    "content_image_missing_alt": "Obrázek nemá popis. Přečte ho čtečka a zobrazí se, když se obrázek nenačte.",
    "content_link_anchor_only": "Odkaz jen na kotvu uvnitř e-mailu nefunguje.",
    "content_link_scheme_forbidden": "Odkaz musí začínat https, http, mailto nebo tel.",
    "content_low_contrast": "Text na tomhle pozadí je špatně čitelný.",
    "content_missing_unsubscribe": "Kampaň musí obsahovat odkaz na odhlášení.",
    "content_nested_columns": "Sloupce nejdou vložit do sloupců.",
    "content_nested_repeat": "Opakování nejde vložit do opakování.",
    "content_padding_overflow": "Odsazení je větší než šířka obsahu, blok se nevejde.",
    "content_raw_html_forbidden": "Vlastní HTML smí upravovat jen člen s oprávněním templates:write_html.",
    "content_reserved_marker": "Text obsahuje vyhrazenou značku, kterou doplňuje odesílání.",
    "content_too_many_blocks": "Šablona má nejvýš 300 bloků, tenhle limit je vyčerpaný.",
    "content_too_many_links": "Odkazů je moc, sledování prokliků by přestalo dávat smysl.",
    "liquid_comparison_operator_not_supported": "Tenhle operátor v podmínce použít nejde.",
    "liquid_contains_not_allowed": "Podmínka „obsahuje\" tady použít nejde.",
    "liquid_date_format_not_allowed": "Tenhle formát data povolený není.",
    "liquid_default_value_invalid": "Náhradní hodnota nesmí obsahovat uvozovku ani znaky složených a špičatých závorek.",
    "liquid_escaped_entity_in_construct": "Ve výrazu zůstala HTML entita. Napište ho prosím znovu, bez formátování.",
    "liquid_filter_not_allowed": "Tahle úprava hodnoty povolená není.",
    "liquid_for_parameter_not_allowed": "Tenhle parametr opakování povolený není.",
    "liquid_in_trackable_href": "Do sledovaného odkazu nejde vložit personalizaci.",
    "liquid_index_not_allowed": "Přístup na položku podle pořadí povolený není.",
    "liquid_literal_not_supported": "Tahle hodnota se ve výrazu použít nedá.",
    "liquid_nested_for": "Opakování uvnitř opakování povolené není.",
    "liquid_parentheses_not_allowed": "Závorky ve výrazu povolené nejsou.",
    "liquid_string_literal_not_allowed": "Text v uvozovkách se ve výrazu použít nedá.",
    "liquid_tag_not_allowed": "Tahle značka povolená není.",
    "liquid_unknown_field": "Pole v tomto projektu neexistuje.",
    "liquid_unknown_root": "Tenhle zdroj dat neexistuje.",
    "liquid_vocative_filter": "Oslovení se skloňuje samo, filtr na 5. pád sem nepatří.",
    "liquid_whitespace_control_not_allowed": "Ořezávání mezer ve výrazu povolené není."
  }
}
```

- [ ] **Krok 4: Napiš anglický katalog**

Stejná struktura klíčů, anglické texty. Klíčové řetězce, které hlídají testy a akceptační kritéria:

Tady je **celý** katalog, ne vzorek. Test parity klíčů z kroku 1 je nekompromisní: chybějící klíč shodí i job `i18n-check`, protože kontroly P05 čtou složený strom všech namespace. Znění vychází ze sloupců „English" ve slovníku části 6, kapitola 9.2, a z tabulek textů v části 3, kapitola 5.4.

Anglicky se merge tag jmenuje **merge tag**: slovník 9.2 zakazuje `placeholder` a předepisuje právě tenhle výraz. Rozhodnutí R10 o slově „Personalizace" platí jen pro češtinu.

```json
{
  "common": { "cancel": "Cancel", "close": "Close", "tryAgain": "Try again", "details": "Details" },
  "header": {
    "back": "Back to templates", "saved": "Saved at {time}", "saving": "Saving…",
    "saveFailed": "Could not save, retrying", "unsaved": "Unsaved changes", "preview": "Preview",
    "edit": "Back to editing", "testSend": "Send test", "rename": "Template name"
  },
  "palette": {
    "title": "Blocks", "hint": "Add a block with the plus button between blocks, or by dragging.",
    "group": { "content": "Content", "layout": "Layout" }
  },
  "block": {
    "section": "Section", "columns": "Columns", "columns2": "Two columns", "columns3": "Three columns",
    "column": "Column", "heading": "Heading", "text": "Text", "image": "Image", "button": "Button",
    "divider": "Divider", "spacer": "Spacer", "social": "Social networks", "footer": "Footer",
    "html": "Custom HTML", "unknown": "Unknown block", "columnsWithLayout": "Columns {layout}",
    "socialCount": "{count, plural, =0 {no networks} one {# network} other {# networks}}",
    "lockedHint": "This editor version cannot edit a {type} block. It stays in the template unchanged.",
    "htmlForbidden": "Only a member with the templates:write_html permission can edit custom HTML.",
    "htmlConditionHint": "Set the visibility condition in the properties panel, not by typing into the code."
  },
  "group": {
    "content": "Content", "style": "Style", "layout": "Layout", "mobile": "Mobile",
    "visibility": "Visibility", "emailLayout": "Email", "typography": "Type", "darkMode": "Dark mode"
  },
  "prop": {
    "content": "Text", "buttonLabel": "Label", "level": "Level", "color": "Color",
    "linkColor": "Link color", "align": "Alignment", "fontFamily": "Font", "fontSize": "Font size",
    "fontWeight": "Font weight", "lineHeight": "Line height", "letterSpacing": "Letter spacing",
    "padding": "Padding", "backgroundColor": "Background color",
    "outerBackgroundColor": "Full width background", "backgroundImage": "Background image",
    "backgroundPosition": "Background position", "fullWidth": "Full width",
    "roundedTop": "Round the top", "roundedBottom": "Round the bottom", "hideOnMobile": "Hide on mobile",
    "visibleWhen": "Show only when", "layout": "Column ratio", "gap": "Gap between columns",
    "verticalAlign": "Vertical alignment", "stackOnMobile": "Stack on mobile",
    "stackOrder": "Order on mobile", "borderRadius": "Corner radius", "asset": "Image",
    "alt": "Image description", "decorative": "Decorative only", "href": "Link", "width": "Width",
    "darkVariant": "Image for dark mode", "buttonStyle": "Style", "textColor": "Text color",
    "borderColor": "Border color", "borderWidth": "Border width", "paddingX": "Horizontal padding",
    "paddingY": "Vertical padding", "thickness": "Thickness", "lineStyle": "Line style",
    "lineWidth": "Line width", "height": "Height", "heightMobile": "Height on mobile",
    "socialItems": "Networks", "iconStyle": "Icon style", "iconSize": "Icon size", "code": "HTML code",
    "senderInfo": "Sender details", "showUnsubscribe": "Unsubscribe link",
    "unsubscribeLabel": "Unsubscribe link text", "showPreferences": "Preferences link",
    "preferencesLabel": "Preferences link text", "showWebview": "View in browser link",
    "webviewLabel": "Browser link text", "contentWidth": "Content width",
    "canvasBackground": "Canvas background", "contentBackground": "Content background",
    "radius": "Corner radius", "headingFont": "Heading font", "bodyFont": "Body font",
    "baseFontSize": "Base font size", "baseLineHeight": "Base line height",
    "headingScale": "Heading size ratio", "darkMode": "Dark mode"
  },
  "value": {
    "inherited": "From the theme", "useDefault": "Use the value from the theme",
    "align": { "left": "Left", "center": "Center", "right": "Right", "justify": "Justify" },
    "valign": { "top": "Top", "middle": "Middle", "bottom": "Bottom" },
    "position": { "top": "Top", "center": "Center", "bottom": "Bottom" },
    "side": { "top": "Top", "right": "Right", "bottom": "Bottom", "left": "Left" },
    "level": { "1": "Heading 1", "2": "Heading 2", "3": "Heading 3" },
    "weight": { "400": "Regular", "600": "Semibold", "700": "Bold" },
    "layout": {
      "1-1": "50 and 50", "1-2": "33 and 67", "2-1": "67 and 33", "1-1-1": "Three equal",
      "2-1-1": "50, 25 and 25", "1-1-2": "25, 25 and 50"
    },
    "stackOrder": { "normal": "Left to right", "reverse": "Right to left" },
    "buttonStyle": { "solid": "Solid", "outline": "Outline" },
    "borderWidth": { "0": "No border", "1": "1 px", "2": "2 px" },
    "thickness": { "1": "1 px", "2": "2 px", "3": "3 px", "4": "4 px" },
    "lineStyle": { "solid": "Solid", "dashed": "Dashed", "dotted": "Dotted" },
    "iconStyle": { "color": "Color", "monoDark": "Monochrome dark", "monoLight": "Monochrome light" },
    "width": { "600": "600 px", "640": "640 px" },
    "radius": { "0": "Square corners", "4": "4 px", "6": "6 px", "8": "8 px", "12": "12 px" },
    "scale": { "1125": "Subtle", "12": "Moderate", "125": "Default", "1333": "Bold" },
    "darkMode": { "auto": "Follow the recipient's setting", "off": "Turn off" },
    "font": {
      "system": "System", "arial": "Arial", "helvetica": "Helvetica", "verdana": "Verdana",
      "tahoma": "Tahoma", "trebuchet": "Trebuchet MS", "georgia": "Georgia", "times": "Times New Roman",
      "courier": "Courier New"
    },
    "color": {
      "none": "Transparent", "custom": "Custom color", "brand.primary": "Primary brand color",
      "brand.secondary": "Secondary brand color", "brand.accent": "Accent color", "text.default": "Text",
      "text.muted": "Muted text", "text.inverted": "Text on color", "surface.canvas": "Canvas",
      "surface.content": "Content", "surface.subtle": "Subtle background", "link.default": "Link"
    }
  },
  "hint": {
    "outlookIgnored": "Outlook on Windows will not show this effect.",
    "outlookRadius": "Outlook on Windows will not show rounded corners.",
    "outlookLineStyle": "Dashed and dotted lines look different in Outlook.",
    "altRequired": "Screen readers read the description and it shows when the image fails to load.",
    "altMissing": "Image description is missing",
    "decorative": "Screen readers skip a decorative image and it needs no description.",
    "darkVariant": "An alternative image for recipients using dark mode.",
    "unsubscribeRequired": "In campaigns the unsubscribe link has to stay on."
  },
  "op": {
    "moveUp": "Move up", "moveDown": "Move down", "moveOut": "Move out one level",
    "moveIn": "Move into the column", "duplicate": "Duplicate", "delete": "Delete",
    "insertAfter": "Add a block after", "edit": "Edit content",
    "selectPrev": "Select the previous block", "selectNext": "Select the next block",
    "selectParent": "Select the parent block", "selectChild": "Select the first nested block",
    "undo": "Undo", "redo": "Redo", "escape": "Clear the selection"
  },
  "insert": { "after": "Add a block after {block}" },
  "a11y": {
    "canvas": "Email content", "propertiesPanel": "Selected block properties",
    "blockMoved": "{block}, position {position} of {total}",
    "moveBlocked": "{block} cannot move further in this direction.",
    "blockDuplicated": "{block} duplicated.", "duplicateBlocked": "{block} cannot be duplicated.",
    "blockDeleted": "{block} deleted.", "blockInserted": "{block} added.", "undone": "Change undone.",
    "redone": "Change redone."
  },
  "visibility": {
    "always": "Always", "field": "Field", "operator": "Condition",
    "badge": "Shows only when {field} {op}",
    "op": { "present": "is filled in", "blank": "is empty", "true": "is on", "false": "is off" }
  },
  "richtext": {
    "toolbar": "Text formatting", "label": "Block text", "placeholder": "Write your text…",
    "bold": "Bold", "italic": "Italic", "underline": "Underline", "strike": "Strikethrough",
    "link": "Link", "linkUrl": "Link address", "linkApply": "Insert link", "linkRemove": "Remove link",
    "bulletList": "Bullet list", "orderedList": "Numbered list",
    "insertPersonalization": "Insert merge tag"
  },
  "token": {
    "title": "Merge tag",
    "tooltip": "Merge tag: {label}. It will be replaced with the recipient's value when sending.",
    "fallbackLabel": "Fallback value", "fallbackHint": "Used when the recipient has no value filled in.",
    "fallbackInvalid": "A fallback value cannot contain a quote or curly and angle brackets.",
    "dateFormatLabel": "Date format", "dateFormatDefault": "Follow the project setting",
    "dateFormat": {
      "%d.%m.%Y": "07/31/2026", "%-d.%-m.%Y": "7/31/2026", "%Y-%m-%d": "2026-07-31",
      "%d.%m.%Y %H:%M": "07/31/2026 14:32", "%H:%M": "14:32"
    },
    "longTextHint": "Line breaks will not show in the email.",
    "unknownField": "This field does not exist in this project.",
    "suggestion": "You probably mean {suggestion}."
  },
  "personalization": {
    "search": "Search fields", "empty": "No field matches.", "groupSystem": "System links",
    "groupContact": "Contact details", "groupCustom": "Custom fields"
  },
  "field": {
    "unsubscribeUrl": "Unsubscribe link", "preferencesUrl": "Preferences link",
    "webviewUrl": "View in browser", "campaignName": "Campaign name",
    "campaignSubject": "Campaign subject", "workspaceName": "Project name",
    "senderAddress": "Sender postal address", "email": "Email", "firstName": "First name",
    "lastName": "Last name", "firstNameVocative": "First name, vocative",
    "lastNameVocative": "Last name, vocative", "titlePrefix": "Title before name",
    "titleSuffix": "Title after name", "greeting": "Greeting", "gender": "Gender",
    "locale": "Contact language", "createdAt": "Created"
  },
  "social": {
    "network": "Network", "href": "Link", "add": "Add a network", "remove": "Remove network",
    "max": "You cannot add more than {max} networks.", "facebook": "Facebook", "instagram": "Instagram",
    "x": "X", "linkedin": "LinkedIn", "youtube": "YouTube", "tiktok": "TikTok", "threads": "Threads",
    "pinterest": "Pinterest", "bluesky": "Bluesky", "mastodon": "Mastodon", "web": "Web",
    "email": "Email"
  },
  "asset": {
    "title": "Images", "pick": "Choose an image", "change": "Change the image", "remove": "Remove",
    "upload": "Upload an image"
  },
  "link": {
    "schemeForbidden": "A link must start with https, http, mailto or tel.",
    "liquidForbidden": "A merge tag cannot be placed inside a tracked link.",
    "trackable": "Track clicks"
  },
  "theme": { "title": "Theme" },
  "meta": { "previewText": "Preview line" },
  "issues": {
    "title": "Template findings",
    "errorCount": "{count, plural, =0 {no errors} one {# error} other {# errors}}",
    "warningCount": "{count, plural, =0 {no warnings} one {# warning} other {# warnings}}",
    "goToBlock": "Go to block"
  },
  "preview": {
    "desktop": "Desktop", "mobile": "Mobile", "text": "Plain text", "source": "Source",
    "dark": "Dark mode", "modes": "Preview mode", "frameTitle": "Email preview", "viewAs": "View as",
    "randomContact": "Random contact", "noNameContact": "Contact without a name",
    "sampleData": "Sample data", "sizeKb": "Size {size} kB",
    "failed": "The preview could not be generated."
  },
  "testSend": {
    "title": "Test email", "recipients": "Addresses", "submit": "Send test",
    "recipientsHint": "At most {max} addresses separated by commas.",
    "prefix": "Add a TEST marker to the subject",
    "explain": "A test email does not count towards statistics and tracks neither opens nor clicks.",
    "noRecipients": "Enter at least one address.",
    "tooMany": "You can send to at most five addresses at once.",
    "rateLimited": "The test email limit is used up. Try again in {minutes} minutes.",
    "failed": "The test could not be sent ({code}).", "success": "The test email is on its way."
  },
  "state": {
    "loading": "Loading the template…", "loadFailed": "The template could not be loaded.",
    "notFound": "The template does not exist or was deleted.",
    "forbidden": "Editing templates needs the templates:write permission.",
    "readOnly": "You can view the template but not edit it.",
    "schemaTooNew": "The template comes from a newer version of the tool and cannot be opened in this editor.",
    "tooManyBlocks": "A template can hold at most 300 blocks and that limit is used up.",
    "tooLarge": "The template is over 512 kB and cannot be saved.",
    "offline": "You are offline, we will send the changes once the connection is back.",
    "conflictTitle": "Someone else has changed the template",
    "conflictBody": "You have an older version open. You can load the new one, or copy your changes out first.",
    "conflictReload": "Load the new version",
    "notFoundBody": "Someone else may have deleted it, or the address has a typo.",
    "backToList": "Back to the template list",
    "forbiddenBody": "Opening a template needs the templates:read permission and your role does not have it.",
    "forbiddenWhoCanHelp": "The project owner can change your role."
  },
  "list": {
    "title": "Templates", "empty": "You have no templates yet.",
    "emptyHint": "A template is the email content you prepare once and use in any campaign.",
    "create": "Create a template", "open": "Open", "loadFailed": "Templates could not be loaded.",
    "createFailed": "The template could not be created.", "newName": "New template"
  },
  "issue": {
    "content_asset_not_found": "This image is no longer in the library.",
    "content_condition_field_unknown": "The condition points to a field that does not exist in this project.",
    "content_condition_on_unsubscribe": "A block with the unsubscribe link cannot have a visibility condition.",
    "content_condition_operator_invalid": "This condition does not fit the field type.",
    "content_duplicate_block_id": "Two blocks share the same id.",
    "content_duplicate_footer": "A template can only have one footer.",
    "content_html_too_large": "The email is too large. Gmail clips longer messages and the unsubscribe link disappears.",
    "content_image_missing_alt": "The image has no description. Screen readers read it and it shows when the image fails to load.",
    "content_link_anchor_only": "A link to an anchor inside the email does not work.",
    "content_link_scheme_forbidden": "A link must start with https, http, mailto or tel.",
    "content_low_contrast": "This text is hard to read on this background.",
    "content_missing_unsubscribe": "A campaign must contain an unsubscribe link.",
    "content_nested_columns": "Columns cannot be placed inside columns.",
    "content_nested_repeat": "A repeat cannot be placed inside a repeat.",
    "content_padding_overflow": "Padding is wider than the content, the block does not fit.",
    "content_raw_html_forbidden": "Only a member with the templates:write_html permission can edit custom HTML.",
    "content_reserved_marker": "The text contains a reserved marker that sending fills in.",
    "content_too_many_blocks": "A template can hold at most 300 blocks and that limit is used up.",
    "content_too_many_links": "There are too many links, click tracking would stop making sense.",
    "liquid_comparison_operator_not_supported": "This operator cannot be used in a condition.",
    "liquid_contains_not_allowed": "The \"contains\" condition cannot be used here.",
    "liquid_date_format_not_allowed": "This date format is not allowed.",
    "liquid_default_value_invalid": "A fallback value cannot contain a quote or curly and angle brackets.",
    "liquid_escaped_entity_in_construct": "An HTML entity was left in the expression. Please type it again, without formatting.",
    "liquid_filter_not_allowed": "This value transformation is not allowed.",
    "liquid_for_parameter_not_allowed": "This repeat parameter is not allowed.",
    "liquid_in_trackable_href": "A merge tag cannot be placed inside a tracked link.",
    "liquid_index_not_allowed": "Accessing an item by position is not allowed.",
    "liquid_literal_not_supported": "This value cannot be used in an expression.",
    "liquid_nested_for": "A repeat inside a repeat is not allowed.",
    "liquid_parentheses_not_allowed": "Parentheses are not allowed in an expression.",
    "liquid_string_literal_not_allowed": "Quoted text cannot be used in an expression.",
    "liquid_tag_not_allowed": "This tag is not allowed.",
    "liquid_unknown_field": "This field does not exist in this project.",
    "liquid_unknown_root": "This data source does not exist.",
    "liquid_vocative_filter": "The greeting is inflected automatically, a vocative filter does not belong here.",
    "liquid_whitespace_control_not_allowed": "Whitespace trimming is not allowed in an expression."
  }
}
```

- [ ] **Krok 5: Spusť test, musí projít**

```bash
pnpm --filter @mlain/web exec vitest run src/features/editor/i18n.test.ts
pnpm --filter @mlain/i18n test:unit
```

Expected: PASS, 10 testů v prvním běhu. Druhý příkaz pouští kontroly P05 nad **složeným stromem
všech namespace**, tedy včetně `editor.json`; job `i18n-check` z P01 dělá totéž v CI. Když projde
první a spadne druhý, je to nález v katalogu, ne chyba testu.

Ověřeno spuštěním na `intl-messageformat` 11.2.13 (BSD-3-Clause), že katalog dává tyhle tvary:

```
issues.errorCount   0=žádná chyba  1=1 chyba  2=2 chyby  5=5 chyb  21=21 chyb  100=100 chyb  1,5=1,5 chyby
```

Poslední hodnota je důvod, proč je kategorie `many` povinná. Bez ní vyjde „1,5 chyb", což je česky
špatně, a kontrola P05 katalog odmítne.

- [ ] **Krok 6: Commit**

```bash
git add packages/i18n/messages apps/web/src/features/editor/i18n.test.ts \
  apps/web/src/features/editor/model/issue-codes.ts
git commit -m "feat(editor): add cs and en catalogs for the editor namespace"
```

---

### Úkol 28: Skořápka editoru, stavy obrazovky a stránky

**Soubory:**
- Create: `apps/web/src/features/editor/components/editor-shell.tsx`, `header/editor-header.tsx`, `header/save-status.tsx`, `palette/block-palette.tsx`
- Create: `apps/web/src/features/editor/index.ts`
- Create: `apps/web/src/features/editor/ports/server-ports.ts`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/templates/[templateId]/page.tsx`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/templates/[templateId]/editor-client.tsx`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/templates/page.tsx`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/templates/create-template.tsx`
- Create: `apps/web/src/features/editor/components/editor-shell.test.tsx`

Editor se načítá **dynamicky s `ssr: false`** (rozhodnutí R12), protože kritérium 82 části 6 zakazuje editor v základním balíku. Stavy obrazovky pro editor jsou podle matice 7.2 části 6 povinné: S4, S6, S7, S8, S9, S10, S11, S12, S13, S15.

- [ ] **Krok 1: Napiš test**

```tsx
// apps/web/src/features/editor/components/editor-shell.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../../packages/i18n/messages/cs/editor.json';
import type { EditorDocument } from '../model/document-types';
import { createFakePorts } from '../ports/fake-ports';
import { EditorShell } from './editor-shell';

const document = (): EditorDocument => ({
  schemaVersion: 1, meta: { name: 'Letní výprodej', previewText: '', language: 'cs' }, theme: {},
  blocks: [{ id: 'b_s1', type: 'section', props: {}, children: [{ id: 'b_h1', type: 'heading', props: {} }] }],
} as EditorDocument);

const base = {
  templateId: 't1', designHash: 'h1', document: document(), canWriteHtml: true, readOnly: false,
  fieldCatalog: { fields: [], version: 'v1' }, ports: createFakePorts(),
};

const wrap = (props: Partial<typeof base> & { schemaTooNew?: boolean } = {}) => render(
  <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
    <EditorShell {...base} {...props} />
  </NextIntlClientProvider>,
);

describe('EditorShell', () => {
  it('má tři panely: paletu, plátno a vlastnosti', () => {
    wrap();
    expect(screen.getByRole('complementary', { name: /Bloky/ })).toBeInTheDocument();
    expect(screen.getByRole('tree')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /Vlastnosti/ })).toBeInTheDocument();
  });

  it('stav uložení je v hlavičce a nikdy toastem', () => {
    wrap();
    expect(screen.getByTestId('save-status')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /Uloženo/ })).toBeNull();
  });

  it('tlačítko Náhled přepne prostřední panel a Zpět k úpravám ho vrátí', async () => {
    wrap();
    await userEvent.click(screen.getByRole('button', { name: 'Náhled' }));
    expect(screen.queryByRole('tree')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Zpět k úpravám/ }));
    expect(screen.getByRole('tree')).toBeInTheDocument();
  });

  it('šablona jen pro čtení ukáže pruh s důvodem a nekreslí zašedlá pole', () => {
    wrap({ readOnly: true });
    expect(screen.getByTestId('state-read-only')).toBeInTheDocument();
  });

  it('novější schéma se neotevře a řekne proč, kritérium 3 části 3', () => {
    wrap({ document: { ...document(), schemaVersion: 2 } as EditorDocument });
    expect(screen.getByTestId('state-schema-too-new')).toBeInTheDocument();
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('při vyčerpaném limitu bloků to řekne a nezakáže ostatní práci', () => {
    const many = { ...document(), blocks: Array.from({ length: 301 }, (_, index) => ({
      id: `b_x${index}`, type: 'section', props: {}, children: [],
    })) } as EditorDocument;
    wrap({ document: many });
    expect(screen.getByTestId('state-too-many-blocks')).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spusť test, musí spadnout**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/editor-shell.test.tsx`
Expected: FAIL, `Failed to resolve import "./editor-shell"`.

- [ ] **Krok 3: Napiš skořápku a hlavičku**

```tsx
// apps/web/src/features/editor/components/editor-shell.tsx
'use client';

// Vzory pod `patterns/` se importují na úroveň **adresáře**: mapa exports zní
// `"./patterns/*": "./src/patterns/*/index.ts"`, takže `patterns/states/alert`
// míří na `src/patterns/states/alert/index.ts`, což není soubor.
import { Alert } from '@mlain/ui/patterns/states';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { MAX_BLOCKS } from '../config';
import { useAutosave } from '../autosave/use-autosave';
import { useUnloadGuard } from '../autosave/use-unload-guard';
import type { EditorDocument } from '../model/document-types';
import type { FieldCatalog } from '../model/field-catalog';
import type { EditorPorts } from '../ports/types';
import { createEditorStore } from '../state/editor-store';
import { EditorStoreProvider, useEditorState } from '../state/use-editor';
import { Canvas } from './canvas/canvas';
import { EditorHeader } from './header/editor-header';
import { IssueBar } from './issues/issue-bar';
import { useValidation } from './issues/use-validation';
import { BlockPalette } from './palette/block-palette';
import { PreviewPane } from './preview/preview-pane';
import { PropertiesPanel } from './properties/properties-panel';
import { FieldCatalogProvider } from './richtext/field-labels';
import { TestSendDialog } from './test-send/test-send-dialog';

export type EditorShellProps = {
  templateId: string;
  document: EditorDocument;
  designHash: string;
  canWriteHtml: boolean;
  readOnly: boolean;
  fieldCatalog: FieldCatalog;
  ports: EditorPorts;
};

export function EditorShell(props: EditorShellProps) {
  const t = useTranslations('editor');
  const store = useMemo(
    () => createEditorStore({ document: props.document, designHash: props.designHash }),
    [props.designHash, props.document],
  );
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [testSendOpen, setTestSendOpen] = useState(false);
  const { flush } = useAutosave({ store, ports: props.ports, templateId: props.templateId });
  useUnloadGuard(store);
  useValidation({ store, ports: props.ports, templateId: props.templateId, fieldCatalog: props.fieldCatalog });

  if (props.document.schemaVersion !== 1) {
    return <Alert data-testid="state-schema-too-new" tone="error" title={t('state.schemaTooNew')} />;
  }

  return (
    <EditorStoreProvider value={store}>
      <FieldCatalogProvider value={props.fieldCatalog}>
        <div className="flex h-dvh flex-col">
          <EditorHeader
            mode={mode}
            onMode={setMode}
            onTestSend={() => setTestSendOpen(true)}
            readOnly={props.readOnly}
          />
          {props.readOnly ? <Alert data-testid="state-read-only" tone="info" title={t('state.readOnly')} /> : null}
          <BlockLimitNotice />
          <IssueBar />
          <div className="flex flex-1 overflow-hidden">
            {mode === 'edit' ? <BlockPalette /> : null}
            <main className="flex-1 overflow-auto">
              {mode === 'edit'
                ? <Canvas canWriteHtml={props.canWriteHtml} />
                : <PreviewPane templateId={props.templateId} ports={props.ports} flush={flush} />}
            </main>
            {mode === 'edit' ? (
              <PropertiesPanel
                canWriteHtml={props.canWriteHtml}
                fieldCatalog={props.fieldCatalog}
                ports={props.ports}
              />
            ) : null}
          </div>
          <TestSendDialog
            open={testSendOpen}
            templateId={props.templateId}
            ports={props.ports}
            flush={flush}
            onClose={() => setTestSendOpen(false)}
          />
        </div>
      </FieldCatalogProvider>
    </EditorStoreProvider>
  );
}

function BlockLimitNotice() {
  const t = useTranslations('editor');
  const count = useEditorState((state) => state.blockCount);
  if (count <= MAX_BLOCKS) return null;
  return <Alert data-testid="state-too-many-blocks" tone="warning" title={t('state.tooManyBlocks')} />;
}
```

```tsx
// apps/web/src/features/editor/components/header/save-status.tsx
'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEditorState } from '../../state/use-editor';

/** Stav ukládání patří do hlavičky. Toast by se objevoval každé dvě sekundy (část 6, 8.5.1). */
export function SaveStatus() {
  const t = useTranslations('editor');
  const format = useFormatter();
  const status = useEditorState((state) => state.status);
  const savedAt = useEditorState((state) => state.savedAt);
  const isDirty = useEditorState((state) => state.isDirty);

  const text = status === 'saving' ? t('header.saving')
    : status === 'error' ? t('header.saveFailed')
    : status === 'conflict' ? t('state.conflictTitle')
    : isDirty ? t('header.unsaved')
    : savedAt ? t('header.saved', { time: format.dateTime(new Date(savedAt), { timeStyle: 'short' }) })
    : '';

  return <p data-testid="save-status" aria-live="polite" className="text-xs text-muted-foreground">{text}</p>;
}
```

```tsx
// apps/web/src/features/editor/components/header/editor-header.tsx
'use client';

import { Button } from '@mlain/ui/components/button';
import { useTranslations } from 'next-intl';
import { SaveStatus } from './save-status';

export function EditorHeader(props: {
  mode: 'edit' | 'preview';
  onMode: (mode: 'edit' | 'preview') => void;
  onTestSend: () => void;
  readOnly: boolean;
}) {
  const t = useTranslations('editor');
  return (
    <header className="flex items-center justify-between border-b px-4 py-2">
      <SaveStatus />
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => props.onMode(props.mode === 'edit' ? 'preview' : 'edit')}>
          {props.mode === 'edit' ? t('header.preview') : t('header.edit')}
        </Button>
        <Button onClick={props.onTestSend}>{t('header.testSend')}</Button>
      </div>
    </header>
  );
}
```

```tsx
// apps/web/src/features/editor/components/palette/block-palette.tsx
'use client';

import { Button } from '@mlain/ui/components/button';
import { useTranslations } from 'next-intl';
import { PALETTE } from '../../descriptors/registry';
import { canContain, findBlock, typeAt } from '../../model/tree';
import { useEditorState, useEditorStore } from '../../state/use-editor';

/** Paleta vkládá za vybraný blok, případně na konec dokumentu. Blok `repeat` v ní není. */
export function BlockPalette() {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const document = useEditorState((state) => state.document);
  const selectedId = useEditorState((state) => state.selectedId);

  const targetFor = (type: string) => {
    const found = selectedId ? findBlock(document, selectedId) : undefined;
    if (found) {
      const parent = found.path.slice(0, -1);
      if (canContain(typeAt(document, parent), type)) {
        return { parent, index: found.path[found.path.length - 1] + 1 };
      }
      if (canContain(found.block.type, type)) return { parent: found.path, index: (found.block.children ?? []).length };
    }
    if (type === 'section') return { parent: [], index: document.blocks.length };
    const last = document.blocks.length - 1;
    return last >= 0 ? { parent: [last], index: (document.blocks[last].children ?? []).length } : null;
  };

  return (
    <aside aria-label={t('palette.title')} className="w-48 shrink-0 space-y-3 border-r p-3">
      <h2 className="text-sm font-semibold">{t('palette.title')}</h2>
      {PALETTE.map((group) => (
        <div key={group.label} className="space-y-1">
          <p className="text-xs uppercase text-muted-foreground">{t(group.label)}</p>
          {group.entries.map((entry) => (
            <Button
              key={entry.id}
              variant="ghost"
              className="w-full justify-start"
              onClick={() => {
                const target = targetFor(entry.type);
                if (target) store.insertBlock(entry.type, target, entry.preset ?? {});
              }}
            >
              {t(entry.label)}
            </Button>
          ))}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">{t('palette.hint')}</p>
    </aside>
  );
}
```

- [ ] **Krok 4: Napiš vstupní bod, serverové porty a stránky**

```ts
// apps/web/src/features/editor/index.ts
export { EditorShell, type EditorShellProps } from './components/editor-shell';
```

```ts
// apps/web/src/features/editor/ports/server-ports.ts
import 'server-only';
// Doména se importuje na úroveň `@mlain/core/<domena>`. Hlubší podcesta se přes
// zástupný znak v mapě `exports` rozřeší na adresář, ne na soubor.
import { getFieldCatalog } from '@mlain/core/contacts';
import { createWorkspaceContext } from '@mlain/core/identity';
import { findTemplateById, listTemplates } from '@mlain/core/templates';
import { withWorkspace } from '@mlain/core/tx';
import type { EditorDocument } from '../model/document-types';
import type { FieldCatalog } from '../model/field-catalog';

/**
 * Čtení pro serverovou komponentu. **Jediné místo, kde editor sahá na `@mlain/core`.**
 * Když P07 nebo P08 něco přejmenují, mění se jen tenhle soubor.
 *
 * Tři věci, které se snadno napíšou špatně:
 *
 * 1. `createWorkspaceContext` je **jediná legitimní továrna** kontextu projektu
 *    (P04, 3.6). Ověřuje členství, takže nečlen dostane `not_found`, ne `forbidden`,
 *    a nedá se z toho zjistit, které projekty existují. Kontext se nedá složit ručně,
 *    typ je branded.
 * 2. Repository P08 berou **otevřenou transakci**, ne kontext: `findTemplateById(tx, …)`.
 *    Transakci otevírá `withWorkspace`, protože jen uvnitř ní platí RLS proměnné.
 * 3. Sloupce chodí v camelCase z Drizzle (`designHash` je `Buffer`), ne ve tvaru,
 *    který vydává REST (`design_hash` jako hex). Převod je tady, ne v komponentě.
 */
export async function loadEditorData(input: {
  userId: string;
  workspaceSlug: string;
  templateId: string;
}): Promise<{
  document: EditorDocument;
  designHash: string;
  name: string;
  fieldCatalog: FieldCatalog;
} | null> {
  const ctx = await createWorkspaceContext({
    kind: 'session', userId: input.userId, workspaceRef: input.workspaceSlug,
  });

  // Katalog polí i šablona jdou naráz: nezávisí na sobě a sériově by to byly
  // dva zbytečné okružní časy do databáze.
  const [row, fieldCatalog] = await Promise.all([
    withWorkspace(ctx, (tx) => findTemplateById(tx, ctx.workspaceId, input.templateId)),
    getFieldCatalog(ctx),
  ]);

  if (!row) return null;
  return {
    document: row.design as EditorDocument,
    designHash: row.designHash.toString('hex'),
    name: row.name,
    fieldCatalog,
  };
}

/** Seznam šablon pro rozhodnutí R16. Stránkování MVP 0 nepotřebuje, strop je 50. */
export async function loadTemplateList(input: { userId: string; workspaceSlug: string }): Promise<
  Array<{ id: string; name: string }>
> {
  const ctx = await createWorkspaceContext({
    kind: 'session', userId: input.userId, workspaceRef: input.workspaceSlug,
  });
  // `listTemplates` vrací `{ items, nextCursor }`, ne pole. Rozdíl by se projevil
  // až za běhu jako prázdný seznam, protože `[].map` na objektu neexistuje.
  const page = await withWorkspace(ctx, (tx) => listTemplates(tx, ctx.workspaceId, { limit: 50 }));
  return page.items.map((row) => ({ id: row.id, name: row.name }));
}
```

```tsx
// apps/web/src/app/[locale]/w/[workspaceSlug]/templates/[templateId]/page.tsx
import { Link } from '@mlain/i18n/navigation';
import { ForbiddenState, NotFoundState } from '@mlain/ui/patterns/states';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { loadEditorData } from '@/features/editor/ports/server-ports';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';
import { requireUser } from '@/lib/identity/require-user';
import { EditorClient } from './editor-client';

/**
 * Identitu ani přístup si tenhle plán neřeší sám: `requireUser` a `getWorkspaceAccess`
 * dodává P06 a používá je každá obrazovka pod `/w/{slug}`. Vlastní varianta by se
 * s nimi rozešla v tom, co dělá nečlen, a to je bezpečnostní rozhodnutí, ne detail.
 */
export default async function TemplateEditorPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string; templateId: string }>;
}) {
  const { workspaceSlug, templateId } = await params;
  const t = await getTranslations('editor');

  // `NotFoundState` a `ForbiddenState` mají povinné `body` i `backLink`, respektive
  // `code` a `requestId`. Není to buzerace: stav bez vysvětlení a bez cesty pryč
  // je slepá ulička, a to je přesně ta obrazovka, na které uživatel odchází.
  const backLink = (
    <Link href={`/w/${workspaceSlug}/templates`} className="underline">{t('state.backToList')}</Link>
  );
  const notFoundState = (
    <NotFoundState title={t('state.notFound')} body={t('state.notFoundBody')} backLink={backLink} />
  );

  const me = await requireUser(`/w/${workspaceSlug}/templates/${templateId}`);
  if (!me.ok) return notFoundState;

  const access = await getWorkspaceAccess(workspaceSlug);
  // Nečlen dostane 404, ne 403: z 403 by šlo zjistit, které projekty existují.
  if (!access.ok) notFound();
  if (!hasPermission(access.data, 'templates:read')) {
    return (
      <ForbiddenState
        title={t('state.forbidden')}
        body={t('state.forbiddenBody')}
        whoCanHelp={t('state.forbiddenWhoCanHelp')}
        code="forbidden"
        // Prázdné schválně: tohle rozhodnutí padlo tady podle role, ne odpovědí
        // serveru, takže žádné číslo požadavku k němu neexistuje. Vymyslet ho
        // by znamenalo poslat podporu hledat něco, co v logu není.
        requestId=""
      />
    );
  }

  const data = await loadEditorData({ userId: me.data.user.id, workspaceSlug, templateId });
  if (!data) return notFoundState;

  return (
    <EditorClient
      templateId={templateId}
      document={data.document}
      designHash={data.designHash}
      fieldCatalog={data.fieldCatalog}
      canWriteHtml={hasPermission(access.data, 'templates:write_html')}
      readOnly={!hasPermission(access.data, 'templates:write')}
    />
  );
}
```

```tsx
// apps/web/src/app/[locale]/w/[workspaceSlug]/templates/[templateId]/editor-client.tsx
'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import type { EditorShellProps } from '@/features/editor';
import { createHttpPorts } from '@/features/editor/ports/http-ports';

/** Editor není v základním balíku, kritérium 82 části 6. */
const EditorShell = dynamic(() => import('@/features/editor').then((module) => module.EditorShell), {
  ssr: false,
  loading: () => <div className="h-dvh animate-pulse bg-muted" aria-busy="true" />,
});

type Props = Omit<EditorShellProps, 'ports'>;

/**
 * Klientská validace se tady nesestavuje. Skládá si ji `useValidation` uvnitř
 * skořápky z katalogu polí, který stejně dostává propem, takže obal nemá co předávat.
 */
export function EditorClient(props: Props) {
  const ports = useMemo(() => createHttpPorts({}), []);
  return <EditorShell {...props} ports={ports} />;
}
```

```tsx
// apps/web/src/app/[locale]/w/[workspaceSlug]/templates/page.tsx
import { Link } from '@mlain/i18n/navigation';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { loadTemplateList } from '@/features/editor/ports/server-ports';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { requireUser } from '@/lib/identity/require-user';
import { CreateTemplateButton, TemplatesEmpty } from './create-template';

/** Minimální seznam šablon (rozhodnutí R16): bez něj se do editoru nedá prokliknout. */
export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const t = await getTranslations('editor');

  const me = await requireUser(`/w/${workspaceSlug}/templates`);
  if (!me.ok) notFound();
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();

  const templates = await loadTemplateList({ userId: me.data.user.id, workspaceSlug });

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('list.title')}</h1>
        {templates.length > 0 ? <CreateTemplateButton workspaceSlug={workspaceSlug} /> : null}
      </div>
      {templates.length === 0 ? (
        <TemplatesEmpty workspaceSlug={workspaceSlug} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <li key={template.id} className="rounded-md border p-3">
              <Link href={`/w/${workspaceSlug}/templates/${template.id}`} className="font-medium underline">
                {template.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

```tsx
// apps/web/src/app/[locale]/w/[workspaceSlug]/templates/create-template.tsx
'use client';

import { Alert, EmptyState } from '@mlain/ui/patterns/states';
import { Button } from '@mlain/ui/components/button';
import { useRouter } from '@mlain/i18n/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { emptyDocument } from '@/features/editor/model/document-types';
import { createHttpPorts } from '@/features/editor/ports/http-ports';

/**
 * Vytvoření šablony je **klientská** akce, ne odkaz na `/templates/new`.
 *
 * Dřívější znění na takovou stránku odkazovalo, jenže ji nezakládá žádný plán,
 * takže by tlačítko v prázdném stavu vedlo na 404. Endpoint `POST /api/v1/templates`
 * existuje a přijímá hotový dokument, takže žádná mezistránka není potřeba:
 * pošle se nejmenší platný dokument a rovnou se otevře editor.
 *
 * `EmptyState` z P05 bere akce jako `{ label, onClick }`, což přes hranici
 * serverové komponenty poslat nejde. Proto je celý prázdný stav tady.
 */
function useCreateTemplate(workspaceSlug: string) {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations('editor');
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  const create = () => {
    setFailed(false);
    startTransition(async () => {
      try {
        const ports = createHttpPorts({});
        const created = await ports.createTemplate({
          name: t('list.newName'),
          document: emptyDocument(locale),
        });
        router.push(`/w/${workspaceSlug}/templates/${created.id}`);
      } catch {
        setFailed(true);
      }
    });
  };

  return { create, pending, failed, t };
}

export function CreateTemplateButton({ workspaceSlug }: { workspaceSlug: string }) {
  const { create, pending, failed, t } = useCreateTemplate(workspaceSlug);
  return (
    <div className="flex items-center gap-2">
      {failed ? <Alert tone="error" title={t('list.createFailed')} /> : null}
      {/* Primární akce nikdy nedostane `disabled` (kritérium 18). Během běhu se
          mění popisek, ne dostupnost. */}
      <Button onClick={create}>{pending ? t('header.saving') : t('list.create')}</Button>
    </div>
  );
}

export function TemplatesEmpty({ workspaceSlug }: { workspaceSlug: string }) {
  const { create, failed, t } = useCreateTemplate(workspaceSlug);
  return (
    <>
      {failed ? <Alert tone="error" title={t('list.createFailed')} /> : null}
      <EmptyState
        variant="first"
        title={t('list.empty')}
        explanation={t('list.emptyHint')}
        actions={[{ label: t('list.create'), onClick: create }]}
      />
    </>
  );
}
```

- [ ] **Krok 5: Spusť test, musí projít**

Run: `pnpm --filter @mlain/web exec vitest run src/features/editor/components/editor-shell.test.tsx`
Expected: PASS, 6 testů.

- [ ] **Krok 6: Commit**

```bash
git add apps/web/src/features/editor apps/web/src/app
git commit -m "feat(editor): assemble editor shell, screen states and routes"
```

---

### Úkol 29: Testy v prohlížeči, kritéria 54 a 55 a přístupnost

**Soubory:**
- Create: `apps/web/e2e/editor/keyboard.spec.ts`, `preview.spec.ts`, `a11y.spec.ts`

Jednotkový test ověřuje, že se oznámení vyrobí. Test v prohlížeči ověřuje, že **jde celý přesun udělat bez myši a že se oznámení skutečně dostane do oblasti `aria-live`.** Obojí je potřeba: kritérium 54 mluví o obojím.

- [ ] **Krok 1: Napiš test klávesové cesty**

```ts
// apps/web/e2e/editor/keyboard.spec.ts
import { expect, test } from '@playwright/test';

test.describe('editor šablony, klávesová cesta', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/cs/w/demo/templates/tmpl-demo');
    await expect(page.getByRole('tree')).toBeVisible();
  });

  test('blok jde přesunout nahoru i dolů výhradně z klávesnice a pozice se oznámí', async ({ page }) => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');            // vybere první blok uvnitř sekce
    const before = await page.getByRole('treeitem').allTextContents();

    await page.keyboard.press('Alt+ArrowDown');
    const live = page.getByRole('status');
    await expect(live).toContainText(/pozice \d+ z \d+/);

    const after = await page.getByRole('treeitem').allTextContents();
    expect(after).not.toEqual(before);

    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(async () => page.getByRole('treeitem').allTextContents()).toEqual(before);
  });

  test('blok jde zasunout do sloupce a zase vysunout jen klávesnicí', async ({ page }) => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Alt+ArrowRight');
    await expect(page.getByRole('status')).toContainText(/pozice/);
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(page.getByRole('status')).toContainText(/pozice/);
  });

  test('z plátna se dá vyjít Tabem do panelu vlastností, není to past na fokus', async ({ page }) => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.locator('#editor-properties')).toContainText(/./);
    const focused = await page.evaluate(() => document.activeElement?.closest('#editor-properties') !== null);
    expect(focused).toBe(true);
  });

  test('smazání a vrácení akce jde z klávesnice', async ({ page }) => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    const count = await page.getByRole('treeitem').count();
    await page.keyboard.press('Delete');
    await expect(page.getByRole('treeitem')).toHaveCount(count - 1);
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('treeitem')).toHaveCount(count);
  });
});
```

- [ ] **Krok 2: Napiš test náhledu a testovacího odeslání**

```ts
// apps/web/e2e/editor/preview.spec.ts
import { expect, test } from '@playwright/test';

test.describe('náhled šablony', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/cs/w/demo/templates/tmpl-demo');
    await page.getByRole('button', { name: 'Náhled' }).click();
  });

  test('tlačítko Kontakt bez jména zobrazí náhled s prázdnými osobními údaji, kritérium 55', async ({ page }) => {
    await page.getByRole('button', { name: 'Kontakt bez jména' }).click();
    const frame = page.frameLocator('iframe[title="Náhled e-mailu"]');
    await expect(frame.locator('body')).not.toContainText('Jana');
  });

  test('mobilní režim zúží náhled a tmavý režim ho přebarví', async ({ page }) => {
    await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-width', '700');
    await page.getByRole('radio', { name: 'Mobil' }).click();
    await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-width', '375');
    await page.getByRole('switch', { name: 'Tmavý režim' }).click();
    await expect(page.getByTestId('preview-frame')).toBeVisible();
  });

  test('náhled nenačítá nic z cizích domén', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) external.push(request.url());
    });
    await page.getByRole('radio', { name: 'Mobil' }).click();
    await page.waitForTimeout(500);
    expect(external).toEqual([]);
  });

  test('textová verze je vidět, protože ji jinak nikdo nikdy nezkontroluje', async ({ page }) => {
    await page.getByRole('radio', { name: 'Textová verze' }).click();
    await expect(page.getByTestId('preview-text')).toBeVisible();
  });
});
```

- [ ] **Krok 3: Napiš test přístupnosti**

```ts
// apps/web/e2e/editor/a11y.spec.ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('editor nemá porušení přístupnosti kategorie wcag2a a wcag2aa', async ({ page }) => {
  await page.goto('/cs/w/demo/templates/tmpl-demo');
  await expect(page.getByRole('tree')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('panel vlastností má popisky u všech polí', async ({ page }) => {
  await page.goto('/cs/w/demo/templates/tmpl-demo');
  await page.getByRole('tree').press('Tab');
  await page.keyboard.press('ArrowDown');
  const results = await new AxeBuilder({ page }).include('#editor-properties').analyze();
  expect(results.violations).toEqual([]);
});
```

- [ ] **Krok 4: Spusť testy v prohlížeči**

Run: `pnpm --filter @mlain/web exec playwright test e2e/editor`
Expected: PASS. Testy potřebují šablonu `tmpl-demo` v projektu `demo`; když ukázková data ještě nejsou (dodává je P16), založ ji v `beforeEach` přes API `POST /api/v1/templates` a na konci smaž.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/e2e/editor
git commit -m "test(editor): add browser tests for keyboard path, preview and accessibility"
```

---

### Úkol 30: Kompletní série a uzavření

- [ ] **Krok 1: Nejdřív ověř, že se testy vůbec spouštějí**

```bash
cd /Users/petr/Projects/Mailing_Tool
pnpm --filter @mlain/web exec vitest run test/p12/test-runner.test.ts
pnpm --filter @mlain/web exec vitest run src/features/editor --reporter=verbose 2>&1 | tail -5
```

Expected: první příkaz PASS, druhý vypíše **nenulový počet testovacích souborů**. Kdyby vypsal
`No test files found` nebo `Test Files 0`, celá série níž skončí zeleně a nic neověří. Tenhle krok
je první schválně: zelená série bez jediného spuštěného testu je horší než červená.

- [ ] **Krok 2: Spusť všechno**

```bash
cd /Users/petr/Projects/Mailing_Tool
pnpm --filter @mlain/web typecheck
pnpm --filter @mlain/web lint
pnpm --filter @mlain/web exec vitest run src/features/editor test/p12
pnpm --filter @mlain/i18n test:unit
pnpm --filter @mlain/web exec playwright test e2e/editor
pnpm turbo run build --filter=@mlain/web
```

Expected: všechno zelené **a s nenulovým počtem testů u každého běhu**. Když něco padá, dohledej
příčinu a oprav; „mělo by to fungovat" není výsledek.

- [ ] **Krok 3: Ověř, že editor není v základním balíku**

```bash
pnpm --filter @mlain/web check:bundle
grep -rl "@tiptap\|@dnd-kit" apps/web/src --include=*.tsx --include=*.ts | grep -v "src/features/editor" | tee /tmp/leaks.txt
test ! -s /tmp/leaks.txt
```

Expected: rozpočet balíku projde (job `bundle-budget` z P01) a druhý příkaz nevypíše žádný soubor. Rozhoduje měření v jobu, ne grep; grep je jen rychlá kontrola, že import neunikl mimo složku editoru.

- [ ] **Krok 4: Ověř pokrytí akceptačních kritérií**

Projdi tabulku v kapitole 7 a u každého kritéria spusť test, který ho pokrývá. Kritérium bez zeleného testu se nepovažuje za splněné.

- [ ] **Krok 5: Commit**

```bash
git add -A
git commit -m "chore(editor): complete P12 template editor"
```
---

## 7. Pokrytá akceptační kritéria

Kritérium bez zeleného testu se nepovažuje za splněné. U každého je uvedený úkol, ve kterém vznikne test.

**Zelený test se navíc musel spustit.** Konfiguraci běhu vlastní P01 a v původní podobě by žádný test tohohle plánu nespustila, přičemž série by skončila **zeleně a s návratovým kódem nula**. Tabulky níž tedy platí jen tehdy, když projde pojistka `apps/web/test/p12/test-runner.test.ts` z úkolu 1. Bez ní jsou seznamem přání.

**Tři kritéria dnes pokrýt nejdou a je to na straně serveru.** Kritérium 55 („Kontakt bez jména") potřebuje `preview_data` s variantou `no_name`, které endpoint náhledu nepřijímá; kritéria 43 a 44 potřebují endpoint `POST /templates/{id}/test-send`, který v routeru **není vůbec**. Obojí je vedené jako otevřený požadavek P08-R2 a P08-R5 v kapitole 9.2. Editorová strana se napíše a otestuje proti dvojníkovi portů, ale **v uzavření úkolu 30 se to musí přiznat, ne odškrtnout**.

### 7.1 Část 3 (obsah), kapitola 8

| # | Kritérium | Kde se pokrývá |
|---|---|---|
| 3 | Dokument se `schemaVersion: 2` se v editoru neotevře | úkol 28, test „novější schéma se neotevře" |
| 5 | Neznámý typ bloku se uloží beze ztráty dat, editor ho ukáže jako zamčený placeholder | úkoly 7, 16, 17 |
| 8c | `visibleWhen` na patičce a operátor mimo typ pole jsou chyba | úkoly 3 (`setVisibility` odmítne patičku), 20 (nabídka operátorů podle typu) |
| 8d | Editor blok `repeat` v paletě nenabízí | úkol 7, test palety |
| 28, 28b | Do textu šablony se nikdy nedostane uvozovka: náhradní hodnota i formát data jsou atributy uzlu | úkoly 10, 23 |
| 29 | Neznámé pole se v editoru zvýrazní a nabídne se nejbližší existující | úkol 24 (pruh nálezů), klíč `token.unknownField` |
| 41, 42 | Náhled jede stejným kódem jako odeslání, kontakt se jménem `<b>` se zobrazí jako text | úkol 25 (editor si nevykresluje vlastní HTML, používá `POST /preview`) |
| 43, 44 | Testovací e-mail obchází suppression list a nepočítá se do statistik | úkol 26 pokrývá stranu editoru proti dvojníkovi portů. **Serverová strana dnes neexistuje**: endpoint `POST /templates/{id}/test-send` v routeru není, viz otevřený požadavek P08-R5. |
| 45 | Blokující nález předodesílací kontroly se ukáže uživateli | úkol 24 |

### 7.2 Část 6 (UI a UX), kapitola 15

| # | Kritérium | Kde se pokrývá |
|---|---|---|
| 7 | Dialog `beforeunload` se ukáže jen u neuložené změny mladší než dvě sekundy | úkol 13, `use-unload-guard.ts` |
| 18 | Žádné tlačítko primární akce nemá `disabled` | konvence z kapitoly 4, typová pojistka v `@mlain/ui` (P05) |
| 19 | Editor má implementované stavy S4, S6, S7, S8, S9, S10, S11, S12, S13, S15 | úkoly 13 (S6, S7, S10 přes stav ukládání), 24 (S8), 28 (S4, S9, S11, S12, S13, S15) |
| 22 | Chybový stav nese kód chyby a `request_id` | úkoly 12 (`PortError`), 24 |
| **54** | **Blok jde přesunout nahoru a dolů výhradně z klávesnice a po přesunu se oznámí „Nadpis, pozice 3 z 7"** | úkoly 14, 15, 16, **29** |
| **55** | **Náhled má tlačítko „Kontakt bez jména", které zobrazí náhled s prázdnými osobními údaji** | úkoly 25, **29**. Tlačítko i jeho volání jsou hotové a otestované proti dvojníkovi portů; **skutečný náhled bez jména vyžaduje `preview_data` s variantou `no_name`**, které endpoint zatím nepřijímá, viz otevřený požadavek P08-R2. |
| 68 | V katalogu není znak U+2014 | úkol 27 |
| 70 | Každý klíč v `cs.json` má protějšek v `en.json` | úkol 27 |
| 71 | Žádný řetězec se neskládá zřetězením fragmentů | úkol 27, konvence z kapitoly 4 |
| 72 | Počty používají ICU `plural` včetně kategorie `=0` **a v češtině i `many`** | úkol 27. Kategorie `many` je v češtině povinná pro desetinná čísla; bez ní vyjde „1,5 chyb" místo „1,5 chyby" a kontrola `icu-validity` z P05 katalog odmítne. Test to ověřuje ostrým tvarem, ne jen přítomností kategorie. |
| 76 | Neznámý chybový kód zobrazí `detail` ze serveru a `request_id` | úkol 24 |
| 80 | Indikátor načítání se neukáže u operace pod 300 ms | úkol 28, komponenta stavu S4 z `@mlain/ui` |
| 82 | Editor není součástí základního balíku | úkoly 28, 30 |
| **Předpoklad všech řádků výš** | **Testy se skutečně spouštějí, série neskončí zeleně s nulou spuštěných testů** | úkol 1, `apps/web/test/p12/test-runner.test.ts`, a úkol 30 krok 1 |

### 7.3 Část 3, kapitola 5.5 (přístupnost editoru, nečíslovaná)

| Požadavek | Kde |
|---|---|
| Každý blok jde vybrat, přesunout a smazat klávesnicí | úkoly 14, 15, 16, 29 |
| Panel vlastností je popsaný `aria-label` a změny se hlásí do `aria-live` | úkoly 19, 15 |
| Kontrastní kontrola běží i na barvy zvolené v editoru a hlásí problém okamžitě | úkol 24, nález `content_low_contrast` z validátoru se ukáže v pruhu nálezů |
| Náhled v iframe má `title` | úkol 25, klíč `preview.frameTitle` |

---

## 8. Soubory, které tenhle plán vlastní

**Mimo tento seznam plán nesahá na žádný soubor.** Jedinou výjimkou jsou řádky se závislostmi v `apps/web/package.json` a `pnpm-lock.yaml` podle kapitoly 0.4.

```
apps/web/src/features/editor/**                       celý podstrom, včetně testů
apps/web/src/app/[locale]/w/[workspaceSlug]/templates/page.tsx
apps/web/src/app/[locale]/w/[workspaceSlug]/templates/create-template.tsx
apps/web/src/app/[locale]/w/[workspaceSlug]/templates/[templateId]/page.tsx
apps/web/src/app/[locale]/w/[workspaceSlug]/templates/[templateId]/editor-client.tsx
apps/web/e2e/editor/**
apps/web/test/p12/**                                  jen pojistka běhu testů z úkolu 1
packages/i18n/messages/cs/editor.json
packages/i18n/messages/en/editor.json
```

Výslovně **nevlastní a nemění**: `packages/emails/**` (blokový model, JSON Schema, renderer), `packages/ui/**` (komponenty K1 až K8, primitiva, tokeny), `packages/contracts/**` (validátor, fixtures), `packages/core/**`, `packages/db/**`, `apps/web/src/app/api/**`, `apps/web/src/server/routes/**`, `apps/web/src/lib/**`, `apps/web/src/proxy.ts`, `apps/web/next.config.ts`, `turbo.json`, `docker/**`, `.github/workflows/**`, katalogy i18n jiných namespace.

**`apps/web/vitest.config.ts` a `apps/web/vitest.setup.ts` v seznamu nejsou.** Vlastní je P01 a dřívější znění si je nárokovalo s podmínkou „jen pokud ještě neexistuje". Ta podmínka se nikdy nesplní, protože P01 běží první, a soubor se dvěma vlastníky podle pořadí je přesně ta nejistota, které se dělení vyhýbá. Předpoklad E13 popisuje, co v nich musí být, a úkol 1 to ověřuje testem, ne očima.

**Kolize s P06 žádná.** Oba plány pracují v `apps/web`, ale v oddělených větvích stromu: P06 v `(auth)`, `(account)` a `settings` plus `test/p06/**`, P12 v `features/editor`, v cestách `templates` a v `test/p12/**`. P12 z P06 jen **čte** `@/lib/identity/*` a `@/lib/api-client/*`, nesahá do nich.

---

## 9. Požadavky na jiné plány

Tyhle věci P12 potřebuje a nesmí si je dopsat sám. Když v době provádění chybí, zapiš je do plánu vlastníka a P12 se zatím obejde přes vrstvu portů.

### 9.1 Uzavřené: dodavatel to už dodal, P12 se srovnal

Tyhle řádky tu zůstávají jako **záznam**, ne jako nevyřízený požadavek. Po nikom se nic nechce.

| # | Komu | Stav |
|---|---|---|
| P05-R1 | P05 | **Splněno jinak, než P12 žádal, a lépe.** `EmailPreview` má volitelně řízené `width` a `dark`, povinné `title` a nepovinné `labels`, takže editor může nechat přepínače ve své liště a uživatel neuvidí dvě sady stejných tlačítek. Volání v úkolu 25 je proti tomuhle tvaru srovnané. |
| **P05-R1b** | **P05** | **Požadavek na `sandbox="allow-same-origin"` je stažený bez náhrady.** Vrátil by rámci původ aplikace a oslabil izolaci **bez zisku**, protože skripty v něm stejně neběží. Odchozí požadavky neblokuje atribut `sandbox`, ale CSP uvnitř `srcdoc` (`default-src 'none'; img-src data:; …`), a tu P05 má. `referrerpolicy="no-referrer"` je doplněné. P05 na to má test, jehož komentář výslovně říká, kdo o výjimku požádal a proč se nedala. **Nikdo ji sem nesmí vrátit.** |
| P05-R2 | P05 | **Rozhodnuto a hotovo.** Slovo `personalizace` v `BANNED_CS` **není a být nesmí**, zakázané zůstávají `placeholder`, `slučovací značka`, `doplňovaný údaj` a `merge tag`. Dřívější znění tvrdilo, že job `i18n-check` shodí build na katalogu `editor`; **to nikdy neplatilo**, protože kontrola ten výraz nehlídala, takže by rozpor zůstal bez povšimnutí. Viz rozhodnutí R17. |
| P05-R3 | P05 | **Splněno pod jinými jmény.** Hook se jmenuje `useAnnouncer()`, bydlí v `@mlain/ui/a11y` a vrací objekt s `polite` a `assertive`. `Alert` P05 doplnil s tóny `info`, `warning`, `error`, `success`. `EmptyState` i `NotFoundState` existují, ale importují se z **adresářového** barrelu `@mlain/ui/patterns/states`. Úkoly 15, 24 a 28 jsou srovnané. |
| P08-R1 | P08 | **Splněno s jinou adresou.** Typy jsou v `@mlain/emails/document/types`, ne `@mlain/emails/document`. JSON Schema má samostatnou definici vlastností **jen u sekce** (`sectionProps`, na kterou `sectionBlock` odkazuje přes `$ref`); ostatní bloky mají vlastnosti vepsané v `<typ>Block.properties.props`. Test v úkolu 8 to řeší funkcí `propsSchemaOf` a hlídá i sám ten předpoklad. |
| P07-R1 | P07 | **Splněno s jinou adresou.** `getFieldCatalog(ctx: WorkspaceContext)` se importuje z `@mlain/core/contacts`, tedy z veřejné plochy domény. Hluboká podcesta `@mlain/core/contacts/fields` **nefunguje**: zástupný znak v mapě `exports` ji přeloží na `src/contacts/fields/index.ts`. Tvar `FieldCatalogEntry` sedí, `path` je bez prefixu `contact.`. |
| P02-R1 | P02 | **Zrušeno, mířilo na špatný balíček.** `@mlain/contracts/fields` neexistuje a nebude: rozhodnutím R2 vlastní katalog polí P07 a převody cest `toMergePath`, `toCatalogPath` a `toLiquidRoots` bydlí v `@mlain/emails/paths` (P08). Funkce `validateDocument` v kontraktech **není a nebude** ani ona: druhou úroveň gramatiky dělá `validateLiquid(source, ctx)` s `ctx.level`, a nad celým dokumentem ji volá `checkSemantics` z P08. Úkol 24 volá `checkSemantics`. |
| P01-R1 | P01 | **Splněno.** `apps/web/vitest.config.ts` má `environment: 'jsdom'`, `plugins: [react()]`, `include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}']` a `setupFiles: ['./vitest.setup.ts']`, přičemž setup registruje `cleanup()` v `afterEach`. Bez toho posledního padá **každý** test komponenty na „Found multiple elements with the role", protože automatický úklid `@testing-library/react` se registruje jen při `globals: true`. Předpoklad E13, ověřuje úkol 1. |

### 9.2 Otevřené: bez tohohle plán nedoběhne

| # | Komu | Co | Co se stane bez toho |
|---|---|---|---|
| **P08-R2** | **P08** | `POST /api/v1/templates/{id}/preview` musí přijmout `preview_data: { type: "sample", variant: "default" \| "no_name" }`, případně `{ type: "contact", contact_id }`. Dnes bere jen `render_data` s hotovými daty a jinak padá na `sampleRenderData(language)`, tedy vždy na jednu variantu. | **Kritérium 55 části 6 nejde splnit.** Tlačítko „Kontakt bez jména" nemá jak vyžádat náhled s prázdnými osobními údaji a nejde ho nahradit výběrem kontaktu, protože kontakt bez jména v projektu být nemusí. |
| **P08-R5** | **P08** | Endpoint `POST /api/v1/templates/{id}/test-send`, který přijme `{ recipients: string[] (1 až 5), add_test_prefix: boolean, preview_data }`, obejde suppression list, nepočítá se do statistik a nesleduje otevření ani prokliky. Router `templates.router.ts` ho dnes **nemá vůbec**; `sendTest` v P13 je pro kampaň, ne pro šablonu. | **Úkol 26 nemá kam poslat požadavek.** Kritéria 43 a 44 části 3 zůstanou nepokrytá na straně serveru. |
| P08-R3 | P08 | `PATCH /api/v1/templates/{id}` při neshodě `if_design_hash` vrací `412` **s aktuálním `design` a `design_hash` v těle**. Dnes vrací holou obálku RFC 9457. | Ne blokující: port si aktuální stav dotáhne samostatným `GET`, viz úkol 12. Je to ale okružní cesta navíc přesně v okamžiku, kdy uživatel čeká. |
| **P04-R1** | **P04** | `packages/core/src/identity/index.ts` jako veřejná plocha domény, která reexportuje aspoň `createWorkspaceContext`. Dnes P04 všechno importuje hlubokými podcestami typu `@mlain/core/identity/context`, které se přes zástupný znak v mapě `exports` rozřeší na adresář. | **Serverová komponenta editoru si nemá jak vyrobit kontext projektu**, a ten je jediná legitimní cesta k šabloně i ke katalogu polí. Vlastní továrna kontextu je vyloučená, typ je branded schválně. |
| P13-R1 | P13 | Kontrolní seznam kampaně obsahuje položku „Zkontrolovali jste, jak e-mail vypadá pro kontakt bez jména?" jako varování, dokud uživatel v editoru na tlačítko aspoň jednou neklikne. Editor ten okamžik zaznamená; přenos příznaku do kampaně vlastní P13. | Ne blokující pro P12. |
| P15-R1 | P15 | AI asistent je postranní panel vysouvaný zprava. Napojí se přidáním nepovinného propu `assistant?: ReactNode` do `EditorShell` a jeho vykreslením vedle panelu vlastností. Je to **jediná změna souboru P12, na kterou má P15 svolení**, a dělá se jedním commitem, ne rozsypaně. | Ne blokující pro P12. |

**Co s otevřenými požadavky, když v době provádění pořád chybí.** Rozhraní editoru je od API oddělené vrstvou portů z úkolu 12, takže se celý plán dá napsat a otestovat proti `createFakePorts()`. Chybějící endpoint tedy plán nezastaví, ale **kritéria 55, 43 a 44 zůstanou nepokrytá** a v uzavření úkolu 30 se to musí přiznat, ne přeskočit. Jediná výjimka je P04-R1: bez veřejné plochy domény `identity` se nezkompiluje serverová komponenta, takže tenhle jeden se vyřešit musí.
| P13-R1 | P13 | Kontrolní seznam kampaně obsahuje položku „Zkontrolovali jste, jak e-mail vypadá pro kontakt bez jména?" jako varování, dokud uživatel v editoru na tlačítko aspoň jednou neklikne. Editor ten okamžik zaznamená; přenos příznaku do kampaně vlastní P13. |
| P15-R1 | P15 | AI asistent je postranní panel vysouvaný zprava. Napojí se přidáním nepovinného propu `assistant?: ReactNode` do `EditorShell` a jeho vykreslením vedle panelu vlastností. Je to **jediná změna souboru P12, na kterou má P15 svolení**, a dělá se jedním commitem, ne rozsypaně. |

---

## 10. Rizika a co s nimi

| Riziko | Co se stane | Opatření |
|---|---|---|
| Editor sežere celý hackathon | Rozsah se nafoukne. **Odhad v řídicím dokumentu je zastaralý:** mluví o 3 000 řádcích při 6 až 8 typech bloků, jenže typů bloků má blokový model P08 **dvanáct** a editor je musí obsloužit všechny. Skutečnost změřená v tomhle plánu: **6 370 řádků TypeScriptu**, z toho 1 891 testů a 4 479 implementace. | Rozsah MVP 0 z kapitoly 5 je strop. Panel vlastností se generuje, takže přidání bloku je jeden datový soubor: **dvanáct typů bloků obsluhuje dvanáct ovládacích prvků, ne osmdesát**, protože prvek zná druh vlastnosti, ne blok. Editace bohatého textu je v panelu, ne na plátně (R7), což ušetří nejdražší část koordinace fokusu. Oprava odhadu v řídicím dokumentu patří koordinátorovi a je vedená v evidenci nálezů. |
| Klávesová cesta se odbude | Porušení WCAG 2.2, kritéria 2.5.7, a kritéria 54 části 6 | Operace je datový záznam s klávesou i ikonou, test rovnocennosti v úkolu 14 a test bez myši v úkolu 29. |
| Descriptory se rozejdou s modelem | Editor vyrobí blok, který API odmítne | Test shody se schématem v úkolu 8 běží nad skutečným `ajv`, ne nad grepem. |
| `@dnd-kit` je rok bez vydání | Nutnost výměny | Používá se jen zevnitř `components/canvas/dnd/`, typy neunikají. Výměna za nativní přetahování je změna dvou souborů. Editor bez něj funguje celý. |
| P08 nebo P07 dodá jiné rozhraní | Editor nejde spustit | Všechna cizí rozhraní vedou přes `model/document-types.ts`, `model/field-catalog.ts` a `ports/*`. Oprava je v jednom souboru na závislost. |
| Nestihne se přetahování | Demo skript by neprošel | Degradovaný režim: `EDITOR_DND_ENABLED = false`. Bloky se přesouvají klávesnicí a tlačítky v ovládání bloku, editor zůstane plně použitelný. Je to vědomá záložní varianta ze specifikace, ne improvizace. |
| Vlastní editor se ukáže jako slepá ulička | Ztráta času | Dokumentovaná náhradní cesta je **GrapesJS** (BSD-3, část 3, 3.3.3). Blokový dokument je náš, takže výměna editoru není migrací šablon. |

---

## 11. Co plán vědomě nedělá

| Věc | Kdo ji vlastní |
|---|---|
| Blokový model, JSON Schema, renderer, kompilace, endpointy šablon | P08 |
| Komponenty K1 až K8, tokeny, skořápka aplikace, i18n infrastruktura | P05 |
| Validátor Liquidu a golden fixtures | P02 |
| AI asistent a extrakce značky, obrazovky 8.5.3 a 8.5.4 | P15 |
| Knihovna obrázků jako samostatná obrazovka, obrazovka značky, obrazovka AI klíčů | P15 a plán, který vlastní assety |
| Historie verzí šablony jako obrazovka | P08 (API) a plán, který obrazovku doplní |
| Předodesílací kontrola jako obrazovka kampaně a kontrolní seznam | P13 |
| Ukázková šablona a ukázková data | P16 |
| Simulace Outlooku, volné plátno, přetahování z palety na libovolné místo | nikdo, mimo MVP 0 |
