# Editor šablon: přechod na WYSIWYG plátno

**Datum:** 4. 8. 2026
**Nahrazuje rozhodnutí R7 a R8 plánu** `2026-07-31-p12-editor-sablon.md`.

---

## Stav k 6. 8. 2026 (revize proti kódu)

Plán jako celek **platí a je z velké části hotový**. Nic ho nenahradilo.

| Část | Stav |
|---|---|
| K1 až K7 (kapitola 8) | hotové, ověřeno v kódu |
| Z1 přetahování do sloupce | **hotové 6. 8. 2026**, viz níž |
| Z2 historie po znaku | **otevřené** |
| Z3 tmavý režim na plátně | **hotové 6. 8. 2026** |
| Z4 skutečné ikony sociálních sítí | **otevřené** |
| Z5 mobilní náhled na plátně | **hotové 6. 8. 2026** |
| Oprava náhradní hodnoty (6.1) | hotové, `apps/web/src/features/editor/model/richtext.ts`, funkce `exprWithFilters` |

Co se od sepsání plánu změnilo v okolí a plán o tom neví:

- **Pole „Úvodní řádek" zmizelo z editoru kampaně**, zůstalo jen u samostatné
  šablony (`components/properties/theme-panel.tsx`). Předhlavička kampaně se
  zadává v kroku 2 a kompilace sáhne po dokumentu, jen když je krok 2 prázdný.
- **Panel Motiv píše pozadí plátna a obsahu do rolí `surface.canvas`
  a `surface.content`.** Pole `canvasBackground` a `contentBackground` z motivu
  zmizela úplně (`packages/emails/src/document/types.ts`).
- **Automatické ukládání se po konfliktu zastaví** a neopakuje se donekonečna
  (`autosave/use-autosave.ts`, `conflictedHash`).
- Barvy značky projektu se propisují do nových dokumentů a uložení značky
  převleče existující (`packages/core/src/templates/redress.ts`).

---

## 1. Proč

Zpětná vazba od reálných uživatelů: editor je neintuitivní, uživatel nechápe, co má dělat.
Příčina je architektonická, ne kosmetická. Plán P12 se v R7 a R8 rozhodl takto:

- **R7:** bohatý text se edituje v panelu vlastností, plátno je jen vybíratelný náhled bez `contenteditable`.
- **R8:** plátno kreslí „přiblížení", závazný vzhled je oddělený náhled.

Důsledek: uživatel skládá strom (`Sekce`, `Nadpis`, `Text`), píše do postranního pole a jak e-mail
vypadá, zjistí až po přepnutí do jiného režimu. Skládá strukturu, ne e-mail.

**Obě rozhodnutí se ruší.** Nové znění:

- **R7-new:** bohatý text se edituje přímo na plátně (`contenteditable` přes Tiptap na místě bloku).
  Panel vlastností zůstává pro to, co v ploše nejde (tón, šířka obsahu, tmavý režim, podmínky zobrazení).
- **R8-new:** plátno kreslí e-mail v jeho skutečné podobě: skutečná šířka obsahu, skutečné barvy motivu,
  skutečné písmo, skutečné odsazení, skutečná struktura sloupců. Závazný zůstává náhled ze serveru,
  ale rozdíl mezi ním a plátnem musí být neznatelný.

## 2. Co se nemění (pevná hranice)

- **Dokumentový model** `packages/emails/src/document/*` a `document.v1.schema.json`.
- **Emitter** `packages/emails/src/emitter/*` a zlaté vzorky. Výstup e-mailu se nesmí změnit.
- **Odesílací cesta**, kompilace kampaně, kontrola před odesláním (nálezy, kontrast, odkazy).
- **Store** `state/editor-store.ts`, operace `model/ops.ts`, `model/moves.ts`, `model/tree.ts`.
  Jsou čisté a otestované, WYSIWYG je jen jiný pohled na tentýž stav.
- **Personalizace, slučovací značky a Liquid.** Do odesílaného HTML dál jde `{{ … }}`.

Mění se **výhradně vrstva `components/`** editoru.

## 3. React Email 6.x: co z něj jde použít

Ověřeno 4. 8. 2026 z npm registry, GitHub Releases API a `react.email/docs/*`.

| Zjištění | Použitelnost |
|---|---|
| `react-email` 6.9.1 sloučil komponenty i `render` do jednoho balíčku; `@react-email/components` 1.0.12 (náš) je **deprecated** | **Ne teď.** Je to změna odesílací cesty a musí projít proti zlatým vzorkům. Samostatný návrh, viz kapitola 9. |
| `@react-email/editor` 1.6.13, vizuální WYSIWYG editor nad Tiptapem/ProseMirrorem, MIT | **Ne.** Pracuje s HTML a Tiptap JSON, ne s naším blokovým dokumentem. Nezná `visibleWhen`, `ColorRef`, sloty filtrů, vokativ ani Liquid. Přijetí by znamenalo zahodit model, což je mimo zadání. |
| `render()` z `@react-email/render` 2.1.0 **běží v prohlížeči** (podmíněné exporty `browser`/`worker`/`edge`, `renderToReadableStream`) | **Ne teď.** Náš emitter kolem `render()` používá `node:crypto` (`RawSlotSink`) a syrové sloty pro VML a podmíněné komentáře; v prohlížeči by z nich byl viditelný nepořádek. Zajímavé do budoucna, viz 9. |
| Komponenty React Emailu jsou obyčejné React komponenty, které kreslí `<table>` s vloženými styly | **Nepřímo ano.** Tohle je klíč: náš emitter dělá totéž ručně. Plátno může kreslit **stejnou strukturu tabulek se stejnými vloženými styly** a tím být věrné. |

**Závěr:** převzít se nedá žádný kus React Emailu jako hotová věc. Převzít se dá jeho **princip**:
e-mail je React strom tabulek s vloženými styly, takže když ho vykreslíme v prohlížeči,
je to zároveň skutečný vzhled i editovatelný DOM.

## 4. Jak bude plátno postavené

### 4.1 Sdílená matematika motivu, ne druhá kopie

Plátno **nepřepisuje** logiku vzhledu. Importuje tytéž čisté funkce, které používá emitter:

- `resolveTheme` z `@mlain/emails/theme/resolve` (barvy rolí, velikosti nadpisů, písma, šířka obsahu, mobilní hodnoty),
- `paddingStyle`, `lineHeightStyle`, `px`, `ALIGN_TO_TEXT_ALIGN` z `@mlain/emails/emitter/style`.

Obojí je bez závislosti na Node a `package.json` je vystavuje přes `"./*": "./src/*.ts"`.
Ověřeno čtením souborů, ne odhadem.

Věrnost je tím zaručená tam, kde se nejčastěji rozjíždí: v číslech. Barva `text.muted`
je na plátně tatáž hodnota jako v e-mailu, protože ji spočítá tentýž kód.

### 4.2 Struktura plátna

```
EmailCanvas                 ← pozadí plátna (theme.roles['surface.canvas'])
  └ ContentFrame            ← šířka theme.contentWidth, pozadí surface.content, radius
      └ SectionView*        ← svislý sled sekcí
          └ BlockView*      ← nadpis, text, tlačítko, obrázek, oddělovač, mezera, sociální, patička, html
          └ ColumnsView     ← skutečné sloupce vedle sebe, ne odsazený seznam
```

Žádné `flatten()`, žádné `role="tree"` s odsazením podle úrovně. Plátno kreslí **zanoření tak,
jak vypadá**, tedy sloupce vedle sebe.

Nová komponenta stromu je jen kolem: `BlockChrome` obalí každý blok průhledným rámem, který
při najetí ukáže obrys a nad ním ovládání (nahoru, dolů, duplikovat, smazat) a pod ním „+".
Obrys ani ovládání **nesmí měnit rozměry obsahu** (kreslí se `outline` a absolutně pozicovaná
lišta, ne `border` a ne blokový prvek v toku).

### 4.3 Přístupnost zůstává

Klávesová cesta z P12 (R3, R4, R5) se nezahazuje. Plátno si drží `role="tree"` s roving tabindexem
na obalech `BlockChrome`, jen položky stromu teď vypadají jako skutečný e-mail místo jako řádky seznamu.
`Alt+↑/↓/←/→`, oznámení přes `useAnnouncer()` a jediný tabstop platí dál.

Text v režimu úprav je uvnitř položky `contenteditable`. Vstup do něj je `Enter` nebo dvojklik,
výstup `Escape`. To je táž smlouva jako dnes, jen cíl fokusu je na plátně, ne v panelu.

## 5. Editace textu na místě

`InlineRichText` je Tiptap editor namontovaný přímo do bloku na plátně, se **stejnými rozšířeními**
jako dnešní `RichTextField` (`personalization-extension.ts` zůstává beze změny).

- Styly písma a barvy dostane z motivu, takže psaný text vypadá jako výsledný text.
- Panel formátování se z pevné lišty nad polem mění na **bublinu nad výběrem** (`BubbleMenu`).
  Nezabírá místo, dokud uživatel něco neoznačí.
- `Ctrl+Z` uvnitř Tiptapu patří Tiptapu, mimo něj dokumentu. R15 platí beze změny.
- Zápis do dokumentu jde přes `store.patchProps(id, { content })` po `onUpdate` s odskokem,
  aby se historie neplnila po znaku.

Blok, který bohatý text nemá (obrázek, oddělovač, mezera, sociální sítě), se dál edituje v panelu.
Obrázek dostane na plátně klikací plochu „Vyberte obrázek", která otevře tentýž výběr z knihovny.

## 6. Personalizace v plátně (povinné)

1. **Vkládání je tam, kde se píše.** Značka se vkládá z bubliny nad výběrem a z rychlé nabídky.
   Nemizí do postranního panelu.
2. **Značka se kreslí jako štítek**, ne jako `{{ contact.greeting }}`. Štítek nese lidský popisek
   („Oslovení"), má barvu odlišnou od textu a je to jeden atomický uzel: `Backspace` ho smaže celý.
   To dnes zajišťuje `personalization-node-view.tsx` a zůstává.
3. **Oslovení je první položka nabídky** a má vysvětlení, čím se liší od holého křestního jména.
   Zůstává `greeting-guidance.ts` a skupina `personalization.groupGreeting`.
4. **Náhled umí obojí:** plátno kreslí štítky, režim náhledu kreslí dosazené hodnoty přes
   `contactPreviewData` (server). Beze změny.
5. **Do HTML jde dál `{{ … }}`.** Emitter se nemění.

### 6.1 Oprava: náhradní hodnota nefunguje

> **Hotovo 6. 8. 2026.** Doplňování filtrů dělá `exprWithFilters`
> v `apps/web/src/features/editor/model/richtext.ts`, tedy na jediném převodním
> místě mezi Tiptapem a dokumentem. Emitter ani zlaté vzorky se neměnily.

Uzel `var` nese `fallback`, ale `varOutput` v emitteru náhradu **doplňuje záměnou za název filtru**:

```ts
expr = expr.replace(/(\|\s*default)(?![\w])/, `$1:${filterSlotMarker(...)}`);
```

Editor do `expr` filtr `| default` nikdy nepřidá, takže záměna nemá co najít a náhrada se
do výstupu nedostane. Zlatý vzorek `08-filter-slots.json` má přitom `expr` ve tvaru
`"contact.first_name | default"`, tedy **kontrakt filtr v `expr` očekává** a rozbitá je strana editoru.

**Oprava je v editoru, ne v emitteru.** Inspektor žetonu při nastavení náhrady doplní ` | default`
do `expr` a při vymazání ho odebere. Totéž pro `dateFormat` a ` | date`. Emitter a zlaté vzorky
zůstávají beze změny.

## 7. Vady, které se opraví při tom

| # | Vada | Projev | Oprava |
|---|---|---|---|
| V1 | `createBlock('image')` dává `assetId: ''`, schéma chce formát `uuid` | Po přidání obrázku vrací `PATCH` **422 donekonečna**, hlavička hlásí „Nepodařilo se uložit" a šablonu nejde uložit vůbec | Přidání obrázku otevře rovnou výběr z knihovny; blok vznikne až s vybraným souborem. Autosave při klientsky neplatném dokumentu neposílá požadavek a řekne proč, místo opakování. |
| V2 | `!ctx.assetIds.has('')` u nového obrázku hlásí `content_asset_not_found` | „Obrázek už v knihovně není." u obrázku, který tam nikdy nebyl | Editor pro prázdné `assetId` ukáže vlastní hlášku „Vyberte obrázek", ne serverový kód. |
| V3 | `InsertBetween` je uvnitř položky stromu; po zavření nabídky se fokus vrátí na spouštěč a `onFocus={onSelect}` vybere zpátky **původní** blok | Uživatel přidá blok a panel vlastností ukazuje předchozí blok | Výběr po vložení se nastaví po zavření nabídky; `onFocus` nevybírá, když fokus přišel zevnitř položky. |
| V4 | `BlockPreview` používá třídy `bg-accent`, `text-accent-foreground`, `text-muted-foreground`, `bg-muted`, které v `packages/ui/src/tokens.css` **neexistují** | Štítek personalizace je neviditelný, popisky splývají | Zaniká s přepsáním plátna; nové plátno používá hodnoty z motivu, ne třídy. |
| V5 | `block.props as Record<string, never>` v `BlockPreview` | Každý přístup k vlastnosti potřebuje přetypování; při přidávání bloků to hlásí chyby | Plátno čte vlastnosti přes typované čtečky nad `EditorBlock`, bez `never`. |

## 8. Postup po krocích

Po každém kroku musí být aplikace použitelná.

- [x] **K1** Vady V1 až V3 a oprava náhradní hodnoty (6.1). Nezávislé na plátně, opraví okamžitou bolest.
- [x] **K2** Vrstva vykreslování `components/canvas/render/`: `CanvasProvider` s rozřešeným motivem, `BlockView` pro všech dvanáct typů, `RichView` se štítky personalizace.
- [x] **K3** Výměna `BlockPreview` za `BlockView` a `flatten` za zanořené vykreslení; `BlockChrome` s obrysem a ovládáním.
- [x] **K4** `InlineRichText`: editace textu, nadpisu, popisku tlačítka a patičky přímo na plátně, lišta u textu.
- [x] **K5** Personalizace v liště u textu, štítek v plátně, body 1 až 5 kapitoly 6 splněné.
- [x] **K6** Přidávání bloků na plátně („+" na spodní hraně bloku), výběr obrázku rovnou z plátna, přesouvání beze změny.
- [x] **K7** Testy a ověření klikáním.

### Co zbývá (nebylo v rozsahu tohohle průchodu)

- [x] **Z1** *(hotovo 6. 8. 2026)* Přetahování myší bylo tenká vrstva nad `@dnd-kit` nad **plochým**
  seznamem (`verticalListSortingStrategy` a `dropTargetFor`, které mířily jen mezi sourozence), takže
  neumělo upustit blok dovnitř sloupce. Dnes je vrstva tažení zanořená:
  `components/canvas/dnd/accepts.ts` bere gramatiku z `model/tree.ts` (`canContain`), takže do sloupce
  se upustit dá, a `DropSlot` se kreslí i uvnitř sloupce (`canvas.tsx`, `typeAt(document, parent) === 'column'`).
- [ ] **Z2** Historie se plní po znaku: `InlineRichText` volá `store.patchProps` na každý úhoz, stejně
  jako to dělalo pole v panelu. Slučování po sobě jdoucích úprav téhož bloku do jednoho kroku
  historie chce podporu ve storu. **Stále otevřené k 6. 8. 2026:** `onUpdate` v
  `render/inline-rich-text.tsx` volá `onChange` bez odskoku a `mutate` v `state/editor-store.ts`
  zapíše krok historie při každé změně.
- [x] **Z3** *(hotovo 6. 8. 2026)* Plátno umí tmavý režim: `darkOverride(role, light)` z
  `render/canvas-context.tsx` používá `canvas.tsx` i `render/block-view.tsx`, hodnoty bere
  z `resolveTheme().dark`.
- [ ] **Z4** Ikony sociálních sítí jsou na plátně kolečka se zkratkou. Skutečné ikony dodává produkt
  z adresy, kterou zná až kompilace na serveru (`socialIconUrl`). **Stále otevřené k 6. 8. 2026**,
  viz `SocialView` v `render/block-view.tsx`.
- [x] **Z5** *(hotovo 6. 8. 2026)* Mobilní náhled je přímo na plátně: `canvas.tsx` zúží plochu na
  375 px podle `view.mode === 'mobile'` a chytnou se tím tytéž mobilní hodnoty motivu.

## 9. Samostatné návrhy mimo tento plán

- **N1: přechod na `react-email` 6.9.1.** `@react-email/components` 1.0.12 a `@react-email/tailwind`
  jsou na npm označené jako deprecated. Migrace je podle release notes jen změna importů
  (`@react-email/components` a `@react-email/render` → `react-email`), ale je to zásah do odesílací cesty,
  takže musí proběhnout jako vlastní úkol s porovnáním všech zlatých vzorků bajt po bajtu.
- **N2: náhled bez cesty na server.** `render()` běží v prohlížeči. Kdyby se `RawSlotSink` zbavil
  `node:crypto` a syrové sloty se řešily až v kompilaci, mohl by editor kreslit **skutečné** e-mailové
  HTML živě, bez čekání na server. Velký zisk, ale je to přepis emitteru, který zadání zakazuje.

## 10. Testy

- Jednotkové (Vitest + Testing Library) v `apps/web/src/features/editor`:
  vykreslení každého typu bloku, editace textu na místě zapíše do dokumentu, štítek personalizace
  se kreslí jako popisek a ne jako `{{ }}`, nastavení náhrady doplní `| default` do `expr`.
- Beze změny musí projít: `@mlain/emails` (zlaté vzorky), `i18n-check`, `@mlain/i18n`, typecheck.
- Ruční ověření klikáním v běžící instalaci se snímky obrazovky.
