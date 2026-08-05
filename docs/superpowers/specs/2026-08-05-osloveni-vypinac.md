# Vypínač oslovení a 5. pádu

Datum: 5. 8. 2026
Stav: hotovo. Etapa 1 (mapa) i etapa 2 (implementace) dokončené a ověřené
v prohlížeči v obou polohách přepínače.

Zadání zadavatele doslova: „V angličtině se vůbec neřeší 5. pád a oslovení. Mělo by to být
možné v nastavení celé vypnout a pak by se to nezobrazovalo nikde. Takže v kontaktech,
přehledu, detailu, editoru všechny ty možnosti oslovení v 5. pádě. Nech to zmapovat a udělat
jako zapínací vypínací toggle. Asi v General kde je teď oslovení Oslovení v e-mailech, tykání
vykání. To je asi taky věc spíš češtiny než angličtiny."

---

## 0. Shrnutí rozhodnutí

| Otázka | Rozhodnutí |
| --- | --- |
| Kde se vypínač ukládá | Nový sloupec `workspaces.greeting_enabled boolean NOT NULL DEFAULT true` |
| Co se stane s daty při vypnutí | NIC. Sloupce zůstávají, výpočet běží dál, skrývá se jen rozhraní |
| Šablony s `{{ contact.greeting }}` | Odesílají se beze změny. Pole se v katalogu označí `deleted: true`, což ho schová z nabídky, ale ponechá platné pro validaci |
| Tykání a vykání | Vypíná TÝŽ přepínač. `workspaces.address_form` nemá v celém repozitáři jiného konzumenta než `buildGreeting` |
| Výchozí hodnota | Nový projekt: podle jazyka (`cs`, `sk` → zapnuto, jinak vypnuto). Existující projekty: migrace dosype týmž pravidlem |
| Rod (`gender`) | ZŮSTÁVÁ viditelný. Není to 5. pád ani oslovení, je to údaj o člověku |
| Export CSV | ZŮSTÁVÁ beze změny, viz kapitola 8 |

---

## 1. Kde se oslovení a 5. pád projevuje uživateli

### 1.1 Nastavení projektu → Obecné (`/w/{slug}/settings/general`)

`apps/web/src/app/[locale]/w/[workspaceSlug]/settings/general/page.tsx`

- `AddressFormSection` (`features/workspace-settings/address-form-section.tsx`) — „Oslovení
  v e-mailech", volba vykání/tykání, potvrzovací dialog s počtem kontaktů k přepočtu.
- `GreetingLocaleSection` (`features/workspace-settings/greeting-locale-section.tsx`) —
  „Jazyk oslovení kontaktů", rozpad kontaktů podle jazyka a tlačítko na hromadné sjednocení
  a přepočet.
- Stránka navíc dělá dva síťové dotazy jen kvůli těmhle dvěma sekcím:
  `/api/v1/contacts/count` a `/api/v1/greeting-locale`.

### 1.2 Seznam kontaktů (`/w/{slug}/contacts`)

`app/[locale]/w/[workspaceSlug]/contacts/page.tsx`, `features/contacts/contacts-table.tsx`

- Sloupec tabulky `greeting` s hlavičkou „Oslovení" a odznakem `GreetingBadge`
  (`features/contacts/greeting-badge.tsx`, stavy `locked | noVocativeLocale | derived |
  guessed | noName`).
- Tlačítko „Kontrola oslovení ({count})" (`data-testid="vocative-review-link"`).
- Stránka kvůli tomu tlačítku volá `/api/v1/vocative-review/count`.
- Filtr `?vocative_confidence=low` (`features/contacts/filters.ts`) a jeho odznak
  `chip.vocative` = „nejisté oslovení" (`features/contacts/filter-chips.ts`).
- Filtr se propisuje i do exportu publika (`features/contacts/export-audience.ts`).

### 1.3 Detail kontaktu (`/w/{slug}/contacts/{id}`)

`app/[locale]/w/[workspaceSlug]/contacts/[id]/page.tsx`, `features/contacts/contact-detail.tsx`

- Blok `GreetingField` (`features/contacts/greeting-field.tsx`): hotová věta, odznak stavu,
  „Upravit oslovení", „Uvolnit zámek", pole „Jak ho máme oslovovat", varování
  `greeting-locale-mismatch` a odkaz „Zkontrolovat nejistá oslovení" na obrazovku kontroly.

### 1.4 Zakládání a úprava kontaktu

`contacts/new/page.tsx`, `contacts/[id]/edit/page.tsx`, `features/contacts/contact-form.tsx`

- Panel `data-testid="greeting-preview"` — „Jak ho oslovíme / V e-mailu bude: {greeting}",
  varování o nejistém 5. pádu, o neurčeném rodu a o zamknutém oslovení.
- Panel se plní živě přes `previewGreetingAction` (`features/contacts/edit-actions.ts`),
  tedy jde i o síťový dotaz na `POST /api/v1/contacts/preview-greeting`.
- Nápověda u pole Rod: „Podle rodu skloňujeme oslovení."

### 1.5 Obrazovka kontroly 5. pádu (`/w/{slug}/contacts/vocative-review`)

`contacts/vocative-review/page.tsx`, `features/contacts/vocative-review*.tsx`

Celá obrazovka. Cesty, kterými se na ni dá dostat (všechny je nutné zavřít):

1. tlačítko v seznamu kontaktů,
2. odkaz „Zkontrolovat nejistá oslovení" na detailu kontaktu,
3. položka hlavní navigace `contacts-greeting-queue`
   (`packages/ui/src/patterns/navigation/registry.ts`),
4. odkaz z výsledku importu (`features/import/import-result.tsx`,
   `?import_id=…`),
5. přímé zadání URL.

### 1.6 Průvodce importem

- Krok mapování: cíl `gender` má mezi aliasy i „osloveni"
  (`packages/core/src/contacts/import/mapping.ts`). Cíl pro vokativ ani pro hotové oslovení
  v mapování NEEXISTUJE, mapovat se dá jen rod.
- Krok náhledu (`features/import/step-preview.tsx`): sloupce „Rod" a „Oslovení" a věta
  `preview.vocativeNotice` („u # řádků si nejsme jistí 5. pádem").
- Krok výsledku (`features/import/import-result.tsx`): odkaz „Zkontrolovat 5. pád".
- Chyba řádku `vocative_low_confidence` v `features/import/labels.ts`.

### 1.7 Editor šablon a obsahu kampaně

- Nabídka personalizace (`features/editor/components/richtext/personalization-menu.tsx`):
  vlastní skupina „Oslovení" nahoře nabídky, pod ní `contact.greeting` s nápovědou.
- Popisky polí (`features/editor/components/richtext/field-labels.tsx`):
  `field.firstNameVocative`, `field.lastNameVocative`, `field.greeting`.
- Nápověda k rozdílu mezi hotovou větou a surovinou
  (`features/editor/components/richtext/greeting-guidance.ts`), zobrazuje se v nabídce
  i v inspektoru značky (`token-inspector.tsx`, `token.greetingHint`).
- Kontrola dokumentu: kód `liquid_vocative_filter` (`features/editor/model/issue-codes.ts`,
  `packages/contracts/src/liquid/validator.ts`), který u zapsaného filtru `| vocative`
  radí `{{ contact.first_name_vocative }}`.
- Ovládání viditelnosti bloku (`properties/controls/visibility-control.tsx`) staví nabídku
  polí z téhož katalogu.

### 1.8 Segmenty a filtry

- Pole `vocative_confidence` v nabídce polí segmentu
  (`apps/web/src/features/segments/operator-matrix.ts` → `buildFieldCatalog`),
  jádrová dvojčata `packages/core/src/segments/ast.ts`, `operators.ts`,
  `compile/columns.ts`.

### 1.9 Ukázková data

`packages/core/src/demo/dataset.ts` — obě ukázkové šablony začínají
`{{ contact.greeting }}`, ukázkové kontakty mají předpočítané „Dobrý den, …".

### 1.10 Náhledová data

`packages/emails/src/preview-data.ts` a `packages/core/src/templates/api/preview-data.ts`
dodávají do náhledu `greeting`, `first_name_vocative`, `last_name_vocative`.

### 1.11 Go odesílač

`apps/sender` s oslovením NEPRACUJE. Jediný výskyt slova `greeting` v Go kódu je
`provider/smtp/client.go:78`, což je pozdrav SMTP serveru, nic společného. Odesílač
interpoluje hotové `render_data`, které mu připravila materializace publika.

---

## 2. Kde se oslovení počítá a ukládá

### 2.1 Sloupce `contacts`

`packages/db/src/schema/contacts.ts`

| Sloupec | Význam |
| --- | --- |
| `first_name_vocative`, `last_name_vocative` | 5. pád, surovina |
| `vocative_confidence` (`high\|low\|none`) | jistota, řídí odznak i frontu kontroly |
| `vocative_locked`, `vocative_locked_for`, `vocative_reviewed_at`, `vocative_reviewed_by` | ruční potvrzení člověkem |
| `greeting` | hotová věta, `NOT NULL DEFAULT ''` |
| `greeting_neutral` | tatáž věta bez jména |

Částečný index `idx_contacts__ws_vocative_review` (`vocative_confidence = 'low' AND
vocative_locked = false`) obsluhuje frontu kontroly.

### 2.2 Výpočet

`packages/core/src/contacts/naming/resolve.ts` → `resolveName()` je jediné veřejné rozhraní.
Skládá `gender.ts`, `vocative.ts` a `greeting.ts`. Je to čistá funkce a volá se při KAŽDÉM
zápisu kontaktu: API, formulář, import (`import/row-pipeline.ts`), ukázková data
(`demo/seed.ts`), potvrzení ve frontě kontroly (`vocative-review/actions.ts`).

Vstupy nastavení: `workspaces.address_form`, `settings.contacts.salutation_by`,
`settings.contacts.vocative_policy`, `contacts.locale`.

### 2.3 Fronty a přepočty na pozadí

| Fronta | Kdo ji zařazuje |
| --- | --- |
| `contacts.recompute_greeting` | změna jazyka projektu a změna `address_form` (`identity/workspace-service.ts:315–332`), hromadné sjednocení jazyka (`contacts/greeting-locale.ts:103`) |
| `contacts.bulk_vocative_review` | hromadné potvrzení nad 5 000 kontaktů z obrazovky kontroly (`contacts/vocative-review/actions.ts:348`) |

Obě běží ze sestaveného kódu ve `apps/worker/dist`.

### 2.4 API

- `PUT /api/v1/contacts/{id}/greeting`, `DELETE` totéž (`contacts/api/greeting.routes.ts`)
- `GET /api/v1/greeting-locale`, `POST /api/v1/greeting-locale:align`
- `GET /api/v1/vocative-review`, `/count`, `POST /vocative-review/confirm`
- `POST /api/v1/contacts/preview-greeting` (`contacts/api/contact-edit.routes.ts`)
- `PUT /api/v1/name-overrides` (přepisy rodu a vokativu na úrovni projektu). **Nález mimo
  zadání: tenhle endpoint nemá v aplikaci žádnou obrazovku, `name-overrides` se v `apps/web`
  nevyskytuje ani jednou.**

### 2.5 Cesta do e-mailu

`campaigns/audience/render-data.ts` vezme jen ta pole, která šablona doopravdy používá
(`CompileMeta.usedPaths`), a `campaigns/repo/outbox.ts` je vytáhne ze sloupců kontaktu
(`SELECT … c.greeting …`) do `messages.render_data`. Odesílač už jen dosazuje.

---

## 3. Co se stane s daty při vypnutí

**Nemaže se nic a nic se ani nepřestane počítat.**

Vypínač je čistě zobrazovací. `resolveName()` běží dál při každém zápisu kontaktu,
`contacts.greeting` je pořád vyplněné, `first_name_vocative` taky, `vocative_locked`
zůstává. Skrývá se jen rozhraní.

Proč ne opačně (nepočítat, když je vypnuto):

1. **Zapnutí zpátky by muselo přepočítat celou databázi.** U sto tisíc kontaktů to je
   fronta na minuty a mezitím by seznam kontaktů ukazoval prázdná oslovení. Vypínač
   v nastavení, po kterém se aplikace na deset minut rozbije, není vypínač.
2. **Ručně potvrzené tvary by se ztratily nebo by zůstaly viset.** `vocative_locked` je
   práce člověka. Přestat ji udržovat znamená, že po zapnutí bude buď zastaralá
   (jméno se mezitím změnilo), nebo se přepíše.
3. **Šablony by se rozbily.** Podrobně kapitola 4.
4. **Nic to neušetří.** `resolveName` je čistá funkce nad jedním řádkem, žádný dotaz navíc.

Jediné, co se vypnutím fakticky zastaví, jsou fronty, protože jejich spouštěče leží na
obrazovkách, které zmizí (změna `address_form`, sjednocení jazyka, hromadné potvrzení).
Změna jazyka projektu přepočet zařadí dál, a to je správně: až se vypínač zapne, data sedí.

---

## 4. Nejnebezpečnější místo: šablony, které oslovení už používají

### 4.1 Co by se stalo naivním řešením

Nejpřirozenější nápad je vyhodit `greeting`, `first_name_vocative` a `last_name_vocative`
z katalogu polí (`packages/core/src/contacts/fields/catalog.ts`), protože ten katalog
napájí nabídku v editoru. **Tohle by rozbilo odesílání.**

Řetěz: `getFieldCatalog()` → `toLiquidRoots()` (`packages/emails/src/paths.ts:26`) →
`contactFirstClass` → validátor (`packages/contracts/src/liquid/validator.ts:389`):

```
if (segments.length === 2 && !ctx.fields.contactFirstClass.includes(segments[1] ?? '')) {
  push('liquid_unknown_field', start, end, 'error', { params: { path } });
}
```

`liquid_unknown_field` je **error**, ne warning. `compileTemplate()`
(`packages/core/src/templates/compile.ts:47`) na chybě vrátí `{ ok: false }` a kampaň
neodejde. Uživatel, který má v šabloně `{{ contact.greeting }}` a vypne oslovení, by tak
přišel o možnost tu kampaň vůbec odeslat, a hláška by mluvila o neznámém poli.

### 4.2 Zvolené chování

Katalog polí má už dnes přesně na tenhle případ příznak `deleted`, popsaný v jeho vlastním
komentáři: *„true u archivovaného pole. Šablona ho smí mít, ale editor ho nenabízí."*

- `usableFields()` (`apps/web/src/features/editor/model/field-catalog.ts:54`) filtruje
  `deleted` → pole zmizí z nabídky personalizace i z výběru pole u podmíněného bloku.
- `toLiquidRoots()` příznak `deleted` IGNORUJE → validátor pole dál zná, šablona je platná,
  kampaň se zkompiluje a odešle.

Takže: **při vypnutém oslovení se `greeting`, `first_name_vocative` a `last_name_vocative`
označí v katalogu jako `deleted: true`.** Nové značky do šablony nikdo nevloží, existující
dál fungují a v e-mailu bude pořád „Dobrý den, Petře", protože sloupec `contacts.greeting`
se nepřestal počítat (kapitola 3).

Vedlejší efekt, který je v pořádku: `FieldCatalog.version` je hash počítaný i z příznaku
`deleted`, takže přepnutí vypínače samo zneplatní cache katalogu.

### 4.3 Co se v editoru stane s už vloženou značkou

Vykreslí se dál (`rich-view.tsx` ukazuje popisek místo syrového výrazu, popisek bere
`field-labels.tsx`, což je statická mapa nezávislá na katalogu). Inspektor značky ukáže
nápovědu „tohle je hotová věta i s 5. pádem". Je to informace o tom, co v šabloně je,
ne nabídka něčeho nového, takže zůstává.

---

## 5. Tykání a vykání

**Vypíná je týž přepínač.**

Důvod je měřitelný, ne názorový: `workspaces.address_form` má v celém repozitáři jediného
konzumenta, a tím je `buildGreeting()` v `packages/core/src/contacts/naming/greeting.ts`.
Ověřeno grepem přes `packages/emails`, `packages/ui`, `apps/sender`, `apps/worker`
i `packages/core` — mimo skládání oslovení, mimo obrazovku nastavení a mimo přepočtovou
frontu se nevyskytuje nikde.

Když se tedy oslovení nikde nezobrazuje ani nevkládá, `address_form` neovlivňuje vůbec
nic. Samostatný druhý přepínač by byl ovládací prvek bez následku, tedy přesně to mrtvé
tlačítko, které zadání zakazuje.

(Angličtina rozdíl formálnosti sice zná, `Hello` versus `Hi`, ale projeví se jedině
uvnitř `contact.greeting`. Kdo v anglickém projektu tuhle volbu chce, zapne si oslovení.)

---

## 6. Výchozí hodnota a existující projekty

Sloupec `workspaces.greeting_enabled boolean NOT NULL DEFAULT true`.

- **Nový projekt:** hodnota se odvodí z jazyka při zakládání. `cs` a `sk` → `true`,
  cokoli jiného → `false`. Jsou to jediné dva jazyky, které umí `computeVocative`
  (`VOCATIVE_LOCALES` v `naming/vocative.ts`), takže je to totéž rozhodnutí, které už
  aplikace dělá o řádek níž.
- **Existující projekty:** migrace dosype týmž pravidlem, tedy vypne oslovení projektům
  s jiným jazykem než `cs`/`sk`. Je to bezpečné, protože se nemažou žádná data a přepnutí
  zpátky je jedno kliknutí, a je to přesně to, co zadavatel na anglickém projektu popsal.
- **Změna jazyka projektu vypínač NEPŘEPÍNÁ.** Odvození platí jen při vzniku. Přepnutí
  cizí volby při nesouvisející změně nastavení je přesně ten druh tichého chování, kvůli
  kterému lidé nastavením přestanou věřit.

### Proč sloupec, a ne větev v `workspaces.settings`

`settings` je `jsonb` a migrace by nebyla potřeba, ale:

1. **Vypínač musí být v odpovědi `GET /api/v1/workspaces/{id}`**, protože z ní čte úplně
   každá obrazovka přes `getWorkspaceAccess()` (je `cache()`ovaná, takže je to nula dotazů
   navíc). Ten endpoint vlastní doména identity.
2. **Doména identity nesmí parsovat větev `settings.contacts`.** Je to výslovné pravidlo
   zapsané v `packages/core/src/contacts/settings.ts`: každá doména parsuje jen svou větev.
   Uložení do jsonb by si vynutilo buď porušení pravidla, nebo druhý síťový dotaz z každé
   obrazovky.
3. **Je to sourozenec `address_form`**, který je sloupec, mění se na téže obrazovce a týmž
   `PATCH /api/v1/workspaces/{id}`. Uložit jednu polovinu jedné volby do sloupce a druhou
   do jsonb by byla zbytečná asymetrie.

---

## 7. Seznam změn (etapa 2)

### Databáze

1. `packages/db/src/schema/identity.ts` — `greetingEnabled: boolean().notNull().default(true)`.
2. `packages/db/migrations/0020_workspaces_greeting_enabled.sql` + záznam v `meta/_journal.json`.
   Ruční SQL, ne `drizzle-kit generate` (migrace od 0007 výš snapshoty nemají).
   V migraci NESMÍ být `now()` mimo `DEFAULT`, `migration-lint` to zakazuje.

### Jádro

3. `identity/workspace-service.ts` — `PublicWorkspace.greeting_enabled`, `toPublicWorkspace`,
   `RETURNING` v `restoreWorkspace`, odvození při `createWorkspace`, přijetí v `updateWorkspace`.
4. `identity/api/workspaces.routes.ts` — schéma odpovědi i těla `PATCH`.
5. `contacts/fields/catalog.ts` — při vypnutém oslovení `deleted: true` u `greeting`,
   `first_name_vocative`, `last_name_vocative`.

### Web

6. `lib/identity/workspace-access.ts` — `Workspace.greeting_enabled`.
7. Nastavení → Obecné: nová sekce s přepínačem; `AddressFormSection` a `GreetingLocaleSection`
   se při vypnutí nevykreslí, včetně dotazů, které je napájejí.
8. Seznam kontaktů: sloupec, odznak, tlačítko kontroly, dotaz na počty, filtr i jeho odznak.
9. Detail kontaktu: blok `GreetingField`.
10. Formulář kontaktu: panel náhledu oslovení.
11. Obrazovka kontroly 5. pádu: při vypnutí `notFound()`.
12. Navigace: skrýt položku `contacts-greeting-queue` (nový parametr `hiddenIds`
    u `visibleNavigation`, aby se registr nerozšiřoval o příznak).
13. Import: sloupec „Oslovení" a věta o nejistotě v náhledu, odkaz ve výsledku.
14. Segmenty: pole `vocative_confidence` v nabídce.
15. Katalog textů `cs` i `en`.

---

## 8. Co se záměrně NEMĚNÍ

- **Export CSV** (`packages/core/src/contacts/export/columns.ts`) si nechává sloupce
  `gender`, `first_name_vocative` i `greeting`. Není to obrazovka, je to výsyp dat, a jeho
  ochuzení by znamenalo, že kolečko export → import ztratí ručně potvrzené tvary.
- **Rod (`gender`)** zůstává všude, kde je dnes: v katalogu polí, v mapování importu,
  v náhledu importu, ve formuláři kontaktu i v segmentech. Není to 5. pád ani oslovení,
  je to údaj o člověku a má i jiná použití.
- **REST odpovědi kontaktů** dál vracejí `greeting` a spol. Skrývá se rozhraní, ne data;
  ořezávání odpovědi by si vyžádalo změnu kontraktů bez užitku.
- **`liquid_vocative_filter`** ve validátoru zůstává. Je to náprava chyby v už napsané
  šabloně, ne nabídka.

---

## 9. Co se může rozbít a jak to poznám

## 9a. Co přibylo až při implementaci

Dvě místa, která v mapě nebyla a našla se až proklikáním:

1. **Nápověda u suroviny jména** („Jen jméno. Oslovení z něj neskládejte." v nabídce
   personalizace a „Na oslovení použijte pole Oslovení." v inspektoru značky). Posílala
   uživatele za polem, které v nabídce není. Skrývá se, a stav se pozná Z KATALOGU,
   ne další propou: `contact.greeting` je při vypnutém oslovení `deleted`.
2. **Nápovědy ve formuláři kontaktu** u rodu a u rozbalovátka „Další údaje" mluvily
   o skloňování oslovení. Mají druhé znění bez té zmínky (`form.genderHintPlain`,
   `form.moreDetailsHintPlain`).

## 9b. Odvolaný nález: krok „Náhled" v průvodci importem funguje

Průběžně jsem tvrdil, že se ten krok nikdy nevykreslí. **Bylo to špatně a bylo to měřením.**
Doloženo záznamem sítě: `GET /api/v1/contacts/imports/{id}/preview` vrací 200 s daty a
tabulka se vykreslí, včetně sloupce „Oslovení" při zapnutém přepínači a bez něj při vypnutém.

Dvě chyby mé sondy, obě stojí za zapsání, protože je zdědí každý, kdo bude průvodce zkoušet:

1. **Krok „Kontrola souboru" má DVĚ tlačítka „Pokračovat"**, jedno inline pod výběrem
   oddělovače a jedno vpravo dole. Playwrightí `.first()` bere to inline, kterým se dá
   krok „Náhled" přeskočit. Správně je `.last()`, tedy tlačítko průvodce.
2. **Rozpracovaný import blokuje další nahrání.** `POST /api/v1/contacts/imports` odpoví
   **409**, dokud předchozí běh visí ve stavu `previewing`; průvodce si o něm 24 hodin
   pamatuje. Druhá a třetí sonda proto vůbec nenahrály soubor, `importId` zůstalo `null`,
   `loadPreview()` se na prvním řádku vrátilo a krok vypadal prázdně. Před ručním
   zkoušením importu je potřeba předchozí rozpracovaný běh dokončit nebo zahodit.

Co ale **platí**: `importId` žije jen v paměti komponenty a v adrese není. Otevření
`?step=preview` z uložené záložky nebo obnovení stránky uprostřed průvodce proto vyrobí
prázdný krok. Uvnitř normálního průchodu se to neprojeví, protože `goToStep` používá
`history.pushState` a komponentu neodmontuje.

## 10. Co se může rozbít a jak to poznám

| Riziko | Projev | Kontrola |
| --- | --- | --- |
| Odebrání polí z katalogu místo `deleted` | Kampaň se nezkompiluje, `liquid_unknown_field` | Odeslat testovací kampaň ze šablony s `{{ contact.greeting }}` při vypnutém oslovení a najít vyrenderované tělo v outboxu |
| Osiřelá položka navigace | „Kontrola oslovení" v menu vede na skrytou obrazovku | Proklikat menu při vypnutém přepínači |
| Osiřelý odkaz z výsledku importu | Odkaz „Zkontrolovat 5. pád" na skrytou obrazovku | Projít import až do výsledku při vypnutém přepínači |
| Přímé zadání URL `/contacts/vocative-review` | Obrazovka se otevře, i když je vypnuto | Ručně v prohlížeči |
| Ztráta dat po zapnutí zpět | Prázdné oslovení u kontaktů | Vypnout, zapnout, porovnat detail kontaktu |
| `exactOptionalPropertyTypes` | `pnpm typecheck` | Kompletní série na konci |
| Chybějící klíč v `en` katalogu | `node tools/ci/i18n-check.mjs` | Tamtéž |
| Změna schématu odpovědi `workspaces` | `pnpm ci:openapi-drift` | Přegenerovat kontrakty |
| Migrace nenasazená do `mlain_clean` | 500 na každé obrazovce, která čte projekt | Spustit migraci hned po vygenerování |
