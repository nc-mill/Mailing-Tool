# Revize P12: editor šablon nad blokovým modelem

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Revize plánu P12 (editor šablon) z prověrky plánů
> (31. 7. až 1. 8. 2026), tedy kontrola **textu plánu před stavbou**, ne kontrola kódu.
> **Verdikt typu „plán není proveditelný" se týkal tehdejšího plánu, ne dnešního produktu.** Ten stojí a funguje.
> Opravy se prováděly podle `docs/superpowers/plans/POSTUP-OPRAV.md`; **stav jednotlivých nálezů neověřen**.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

**Recenzovaný plán:** `/Users/petr/Projects/Mailing_Tool/docs/superpowers/plans/2026-07-31-p12-editor-sablon.md` (7 549 řádků, 30 úkolů)
**Zdroje pravdy:** `2026-07-31-p05-design-system-i18n-skorapka.md` (komponenty), `2026-07-31-p08-sablony-model-renderer.md` (blokový model), `2026-07-31-p01-kostra-provoz-ci.md` (kostra a konfigurace)
**Normativní zdroj:** část 6 kapitoly 12, 13.1, 15; část 3 kapitoly 3.3 a 5.5
**Datum:** 2026-08-01

Nálezy jsou ověřené proti skutečnému kódu, ne proti průvodnímu textu. U každého je číslo úkolu a číslo řádku.

---

## Verdikt

**NALEZENY PROBLÉMY.**

P12 je po stránce návrhu nejlépe promyšlený plán ze tří recenzovaných. Klávesová cesta k přetahování není dodatek, ale páteř: operace jsou registrované v jednom místě a **pojistka rovnocennosti** kontroluje, že ke každé myší operaci existuje klávesová. Kritérium 54 plní doslova, včetně tvaru oznámení „Nadpis, pozice 3 z 7". Kapitola 9 s jedenácti požadavky na šest cizích plánů je nejlepší registr rozhraní v celém repozitáři. Licence jsou ověřené obsahem tarballu, ne dokumentací, a `@maily-to/core` je odmítnutý přesně tím kritériem, kvůli kterému licenční brána existuje.

Blokují ho čtyři věci. Jedna je vlastní a levná (chybějící kategorie `many` ve třech českých zprávách), jedna je vlastní a nepříjemná (**testy plánu nemají jak běžet**), a dvě jsou neshody rozhraní s P05, které si P12 opravit nesmí.

| Závažnost | Počet |
|---|---|
| KRITICKÉ | 4 |
| DŮLEŽITÉ | 3 |
| POZNÁMKA | 4 |

---

## KRITICKÉ

### K1. Testy plánu nemají jak běžet: konfiguraci Vitestu vlastní P01 a nepokrývá ani jeden testovací soubor P12

**Kde v P12:** mapa souborů ř. 195, úkol 1 ř. 258 a 296, vlastnictví ř. 7493.

P12 si nárokuje `apps/web/vitest.config.ts` a `apps/web/vitest.setup.ts` s podmínkou **„jen pokud ještě neexistuje"** a v úkolu 1 pro ně dodává obsah:

```ts
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

**Jenže ten soubor už existuje.** P01 ho zakládá na ř. 4971 a jeho obsah je na ř. 5100:

```ts
export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

Podmínka „pokud ještě neexistuje" se tedy nikdy nesplní a P12 zůstane s konfigurací P01, která má tři neslučitelné rozdíly:

| Věc | P01 dodává | P12 potřebuje |
|---|---|---|
| Prostředí | `node` | `jsdom` |
| Vzor souborů | `test/**/*.test.ts` | `src/**/*.test.{ts,tsx}` |
| JSX | žádný plugin | `@vitejs/plugin-react` |
| Setup | žádný | `@testing-library/jest-dom/vitest` |

Všechny testovací soubory P12 leží v `apps/web/src/features/editor/**`, tedy **mimo vzor `test/**`**. Vitest je nenajde. Kroky typu „Spustit test, musí spadnout" v celém plánu nevypíšou selhání testu, ale hlášku, že žádné testy nejsou, a to je horší: vypadá to jako úspěch. Ani po opravě vzoru by neprošly, protože komponentní testy potřebují jsdom a React plugin.

Podmíněné vlastnictví je navíc samo o sobě proti řídicímu pravidlu. „Vlastním to, pokud to nikdo jiný nezaložil" znamená, že soubor má dva vlastníky a rozhoduje pořadí, což je přesně ta nejistota, které se dělení vyhýbá.

**Navržená oprava:** vyjmout oba soubory z vlastnictví P12 a zapsat do kapitoly 9 nový požadavek na P01, například:

> **P01-R1** | P01 | `apps/web/vitest.config.ts` musí mít `environment: 'jsdom'`, plugin `@vitejs/plugin-react`, `setupFiles: ['./vitest.setup.ts']` a `include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}']`, protože obrazovkové plány testují komponenty vedle zdrojů.

**Kde se opravuje:** konfigurace **v P01**; vlastnictví a nový požadavek **v P12, kapitoly 8 a 9, a úkol 1**.

**Týká se to i P06.** Jeho komponentní testy leží ve stejné nepokryté oblasti (`apps/web/src/features/auth/login-form.test.tsx` a dalších devatenáct souborů), takže požadavek na P01 je společný a má se vyřešit jednou.

---

### K2. Tři české zprávy v katalogu `editor` nemají kategorii `many` a shodí kontrolu, kterou dodává P05

**Kde v P12:** úkol 27, ř. 6556, 6694 a 6695.

```json
"socialCount":  "{count, plural, =0 {žádná síť}     one {# síť}      few {# sítě}      other {# sítí}}",
"errorCount":   "{count, plural, =0 {žádná chyba}   one {# chyba}    few {# chyby}     other {# chyb}}",
"warningCount": "{count, plural, =0 {žádné varování} one {# varování} few {# varování} other {# varování}}"
```

Ve všech třech chybí `many`.

**Co říká norma.** Část 6, kapitola 12.3 (ř. 4520): „Kategorie `many` je v češtině pro desetinná čísla (1,5 kontaktu), ne pro velké počty. **Musí být vyplněná**, jinak desetinné hodnoty spadnou na `other`."

**Co to udělá.** P05 dodává v úkolu 9 kontrolu `packages/i18n/src/checks/icu-validity.test.ts`, která je nekompromisní:

```ts
it('každý plural v češtině má kategorie =0, one, few, many i other', async () => {
  for (const category of ['=0 {', 'one {', 'few {', 'many {', 'other {']) {
    if (!value.includes(category)) missing.push(`${key} postrádá ${category.trim()}`);
```

Kontrola načítá **složený strom všech namespace**, takže `editor.json` prochází také. Job `i18n-check` tedy spadne a s ním build.

Vlastní kontrola P12 v úkolu 27 (ř. 6496 až 6519) to nezachytí: ověřuje paritu klíčů, dlouhou pomlčku, slovník merge tagů a tvary tlačítek, ale **kategorie plurálu nekontroluje vůbec**.

Plán přitom v kapitole 7.2 na ř. 7469 uvádí kritérium 72 („Počty používají ICU `plural` včetně kategorie `=0`") jako pokryté úkolem 27. Kategorie `=0` tam skutečně je, `many` ne.

**Navržená oprava:** doplnit `many` do všech tří zpráv:

```json
"socialCount":  "{count, plural, =0 {žádná síť} one {# síť} few {# sítě} many {# sítě} other {# sítí}}",
"errorCount":   "{count, plural, =0 {žádná chyba} one {# chyba} few {# chyby} many {# chyby} other {# chyb}}",
"warningCount": "{count, plural, =0 {žádné varování} one {# varování} few {# varování} many {# varování} other {# varování}}"
```

**Kde se opravuje:** **v P12, úkol 27**, český katalog. Anglické protějšky (ř. 6758, 6759) jsou správně jen s `one` a `other`.

---

### K3. Volání komponenty K6 se neshoduje s tím, co P05 dodává, a P12 navíc žádá slabší izolaci, než norma dovoluje

**Kde v P12:** předpoklad E2 na ř. 40, požadavek P05-R1 na ř. 7509, volání v úkolu 25 na ř. 6193:

```tsx
<EmailPreview html={result.html} width={width} dark={dark} title={t('preview.frameTitle')} />
```

**Co P05 dodává** (úkol 24, ř. 9569):

```tsx
export function EmailPreview({ html, labels, className }: { html: string; labels: EmailPreviewLabels; className?: string })
```

Dva nezávislé problémy.

**1. Props se neshodují.** P05 nezná `width`, `dark` ani `title` a naopak vyžaduje povinný objekt `labels` se šesti řetězci. Volání se nezkompiluje.

Za tím je věcný spor o to, kdo drží stav. P05 drží šířku i tmavý režim uvnitř komponenty ve vlastním `useState` a vykresluje si k tomu vlastní tlačítka (ř. 9584 až 9594). P12 chce obojí řídit zvenčí, protože přepínače má ve své liště nástrojů; úkol 25 se jmenuje „Náhled pro počítač, mobil, tmavý režim, text a zdroj" a nabízí navíc textovou verzi a zdroj, které komponenta neumí. Kdyby se to nechalo být, uživatel by v editoru viděl dvě sady stejných přepínačů.

**2. P12 žádá `sandbox="allow-same-origin"`.** To je proti tvrdému požadavku K6 v 13.1 na izolaci stylů e-mailu od stylů aplikace.

P05 to má vyřešené správně a lépe, než požadavek zní: `sandbox=""` bez jediné výjimky (ř. 9600) plus CSP uvnitř `srcdoc`:

```
default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; script-src 'none'
```

Tohle je jediná konstrukce, která plní i druhou půlku požadavku, **„bez odchozích požadavků na cizí zdroje"**. Samotný atribut `sandbox` odchozí požadavky neblokuje: obrázek s `src="https://cizi.example/a.png"` v těle e-mailu by se načetl a odesílatel by se dozvěděl, že si někdo náhled otevřel. P05 na to má test (ř. 9498).

Přidání `allow-same-origin` by rámci vrátilo původ aplikace a izolaci oslabilo bez jakéhokoli zisku, protože skripty stejně neběží.

**Navržená oprava:** P05 doplní volitelné řízené props `width`, `dark` a `title`, aby šly přepínače nechat na obrazovce editoru, a `labels` dostane výchozí hodnotu. P12 **stáhne požadavek na `allow-same-origin` bez náhrady** a v úkolu 25 přestane vykreslovat vlastní přepínače tam, kde je vykresluje komponenta.

**Kde se opravuje:** props **v P05, úkol 24**. Požadavek na `allow-same-origin` **v P12, předpoklad E2 a požadavek P05-R1**.

---

### K4. `useAnnounce` a `Alert`: P12 staví na dvou exportech, které v P05 nejsou

**Kde v P12:** předpoklad E3 na ř. 41, požadavek P05-R3 na ř. 7511.

P12 žádá:

> Oblast `aria-live` aplikace s funkcí **`useAnnounce()`** vracející `(message: string) => void`
> Export `useAnnounce()` z `@mlain/ui/a11y/live-region` a komponenty stavů **`Alert`**, `EmptyState`, `NotFoundState` pod `@mlain/ui/patterns/states/*`.

**Co P05 dodává:**

- `useAnnouncer(): Announcer` (úkol 18, ř. 6831), tedy **jiné jméno a jiný návratový typ**. Vrací objekt s metodami, jak je vidět na ř. 6839: `const { polite } = useAnnouncer();`
- `EmptyState` a `NotFoundState` ano
- **`Alert` neexistuje.** Barrel `patterns/states/index.ts` exportuje dvanáct jmen a `Alert` mezi nimi není.

`Alert` není drobnost. P12 ho potřebuje pro pruh nálezů (úkol 24) a nezávisle na něm ho importuje třikrát i P13, takže jde o obecný informační blok, který v katalogu stavů 7.1 skutečně chybí.

Oznamování pozice bloku je navíc nosné pro kritérium 54, takže na `useAnnounce` stojí jedno z akceptačních kritérií plánu.

**Navržená oprava:** ponechat `useAnnouncer()` a opravit P12, protože objekt s `polite` a `assertive` je věcně správnější (kritérium 54 potřebuje zdvořilé oznámení, chyba potřebuje důrazné). Komponentu `Alert` s variantami `info`, `warning`, `danger` a `success` naopak doplnit do P05, protože ji žádají dva plány nezávisle na sobě.

**Kde se opravuje:** `useAnnounce` na `useAnnouncer` **v P12, předpoklad E3, požadavek P05-R3 a úkoly 15 a 19**. Komponenta `Alert` **v P05, úkol 17**.

---

## DŮLEŽITÉ

### D1. Požadavek P05-R2 stojí na premise, která neplatí, takže spor o „Personalizaci" zůstane skrytý

**Kde v P12:** rozhodnutí R10 na ř. 78, požadavek P05-R2 na ř. 7510, test v úkolu 27 na ř. 6505.

P12 tvrdí:

> Kontrola slovníku v `packages/i18n/src/checks/glossary.ts` a akceptační kritérium 69 části 6 se musí upravit, **jinak job `i18n-check` shodí build na katalogu `editor`**.

Ověřil jsem to a **build by nespadl**. Seznam `BANNED_CS` v P05 (úkol 9, ř. 3582 až 3603) má dvacet položek a slovo `personalizace` mezi nimi **není**. P05 z celého řádku slovníku 9.2 pro merge tag (`personalizace, proměnná, placeholder, slučovací značka, merge tag`) přepsal jen `placeholder` a `slučovací značka`.

Důsledek je horší než pád buildu: spor se neprojeví nijak. Specifikace v 9.2 na ř. 3708 dál mandátně žádá „Doplňovaný údaj" a zakazuje „personalizace", zatímco P12 má v úkolu 27 test, který vynucuje **opak**:

```ts
expect(czech).toContain('personalizace');
for (const forbidden of ['doplňovaný údaj', 'slučovací značk', 'merge tag', 'placeholder', 'proměnná']) {
  expect(czech, forbidden).not.toContain(forbidden);
}
```

Dva dokumenty tedy budou tvrdit opak a žádná kontrola to nezachytí. Právě proto je rozhodnutí potřeba udělat **před** spuštěním P12, ne až podle toho, co spadne.

Věcně je pozice P12 obhajitelná: „Personalizace" je slovo, které uživatelé znají z Ecomailu, a část 3 ho v 5.4 už používá v klíči `liquid.tokenTooltip`. Je to ale rozhodnutí zadavatele, ne implementační volba, a P12 to sám takhle označuje.

**Navržená oprava:** povýšit P05-R2 na položku v `NALEZY-NAPRIC-PLANY.md`, protože se týká specifikace, P05 i P12 naráz a žádný z nich ho nemůže uzavřít sám. V textu požadavku opravit tvrzení o pádu buildu na „kontrola slovníku dnes tenhle výraz nehlídá, takže rozpor zůstane bez povšimnutí".

**Kde se opravuje:** znění **v P12, kapitola 9**; evidence nálezů; doplnění seznamu **v P05, úkol 9**, jakmile padne rozhodnutí.

---

### D2. Rozsah je proti odhadu řídicího dokumentu dvojnásobný

**Kde:** řídicí dokument, kapitola 5, P12: „Rozsah je změřený: zhruba **3000 řádků** při **6 až 8 typech bloků**, z toho polovina je panel vlastností, který se generuje z popisu."

Skutečnost:

| Věc | Odhad | Skutečnost |
|---|---|---|
| Typů bloků | 6 až 8 | **12** (`section`, `columns`, `column`, `heading`, `text`, `button`, `image`, `divider`, `spacer`, `social`, `html`, `footer`) |
| Rozsah plánu | zhruba 3 000 řádků | **7 549** |

Není to chyba P12: počet typů určuje blokový model z P08 a P12 ho jen musí obsloužit. Je to ale informace, která patří do plánování vlny 2, protože P12 je v ní nejdelší položka a odhad, podle kterého se vlna skládala, byl o polovinu nižší.

Za zmínku stojí, že architektura ten nárůst tlumí přesně tak, jak měla: dvanáct typů bloků obsluhuje **dvanáct ovládacích prvků**, ne osmdesát, protože prvek zná druh vlastnosti a ne blok. Ověřil jsem, že jich je skutečně dvanáct a všechny jsou napsané.

**Navržená oprava:** opravit odhad v řídicím dokumentu, ať se podle něj neplánuje vlna.
**Kde se opravuje:** **v `2026-07-31-rozdeleni-implementacnich-planu.md`, kapitola 5.**

---

### D3. Vlastní kontrola katalogu `editor` neověřuje to, co kritérium 72 žádá

**Kde:** úkol 27, ř. 6496 až 6519.

Kontrola ověřuje čtyři věci: paritu klíčů (kritérium 70), nepřítomnost dlouhé pomlčky (68), slovník merge tagů (rozhodnutí R10) a zakázané tvary tlačítek (9.3). Neověřuje kategorie plurálu, přestože plán v kapitole 7.2 uvádí kritérium 72 jako pokryté právě tímhle úkolem. Nález K2 je přímý důsledek.

**Navržená oprava:** doplnit do testu případ, který projde všechny zprávy s `, plural,` a ověří přítomnost `=0`, `one`, `few`, `many` a `other` v češtině. Duplikuje to sice kontrolu z P05, ale zachytí chybu v jednotkovém běhu plánu, ne až v CI po commitu.

**Kde se opravuje:** **v P12, úkol 27, krok 1.**

---

## POZNÁMKY

### P1. Kritérium 54 je splněné doslova, včetně tvaru věty

Toho si cením nejvíc na celém plánu. Kritérium žádá nejen klávesový přesun, ale i oznámení „ve tvaru **Nadpis, pozice 3 z 7**". P12 to bere vážně (ř. 3290: „Bez toho je klávesová cesta formálně splněná a prakticky nepoužitelná") a dodává:

- klíč `"blockMoved": "{block}, pozice {position} z {total}"` (ř. 6637), tedy přesně ten tvar
- oznámení jako **data**, ne jako hotový řetězec: `{ key: 'a11y.blockMoved', params: { block, position, total } }` (ř. 3438), takže se neskládá z fragmentů a je lokalizovatelné
- e2e test, který ověřuje výstup v `aria-live` regulárním výrazem `/pozice \d+ z \d+/` (ř. 7277)
- **pojistku rovnocennosti** v úkolu 14: registr operací hlídá, že ke každé operaci dostupné myší existuje klávesová cesta

Poslední bod je nejcennější, protože je to mechanismus, ne přání. Řídicí dokument u P12 varuje, že klávesová cesta „se nedědí po knihovně, navrhuje se od nuly", a P12 to udělal.

Zprávy `{position}` a `{total}` nejsou v ICU `plural`, což je v pořádku: jde o pořadové údaje, ne o počty s podstatným jménem, a čeština u nich tvar nemění.

### P2. Vzor pro rody se P12 netýká

Ověřeno grepem: **P12 neobsahuje ani jednu ICU zprávu s `gender, select`.** Není to opomenutí. Editor pracuje se šablonou, ne s konkrétním kontaktem, takže věta o tom, kdo co udělal, se v něm nevyskytuje. Chybný vzor ze specifikace (nález N5 v evidenci) se sem tedy nekopíruje, protože se sem kopírovat nemá.

Pro srovnání: P05 vzor opravuje v úkolu 8 a P14 opravenou podobu používá ve všech čtrnácti zprávách časové osy.

### P3. Licence jsou ověřené přísněji, než norma žádá

Kapitola 2.1 vypisuje sedmnáct nových produkčních závislostí (čtrnáct balíčků Tiptapu, tři `@dnd-kit`) a **všechny jsou MIT**. Ověření nešlo přes dokumentaci, ale přes obsah tarballu (ř. 113): „`@tiptap/extensions@3.29.2` skutečně exportuje `UndoRedo`, `Placeholder` a `CharacterCount` (kontrola obsahu tarballu, ne dokumentace)". To je přesně ta úroveň, kterou řídicí dokument žádá větou „Ověřování grepem nestačí".

Zamítnutí `@maily-to/core` (ř. 130) je učebnicová ukázka licenční brány: „pole `license` prázdné, v balíčku není LICENSE" a verdikt „Neprojde licenční bránou". Hlavní specifikace přesně tohle pravidlo má.

`@dnd-kit/core` má poslední vydání z prosince 2024 a P12 na to reaguje pravidlem vlastního rozhraní z 13.2: používá se jen zevnitř `features/editor/components/canvas/dnd/`, typy neunikají ven a výměna je změna dvou souborů.

Grep potvrdil **nula výskytů `pa11y`**. Žádná GPL, LGPL ani AGPL.

Za pozornost stojí i to, že se **nepoužije `StarterKit`** (ř. 115): přinesl by nadpisy, citace a bloky kódu, tedy uzly, které blokový model nezná a které by šlo do dokumentu propašovat vložením ze schránky. Schéma se skládá výslovně z uzlů, které `RichText` povoluje. To je bezpečnostní úvaha, kterou by většina plánů neudělala.

### P4. Co dál je ověřené jako v pořádku

- **Počet úkolů sedí:** 30 nadpisů `### Úkol N`, číslování souvislé, bez duplicit.
- **Dvanáct ovládacích prvků sedí.** Úkol 20 slibuje dvanáct souborů a dvanáct jich skutečně je: `asset`, `code`, `color`, `link`, `number`, `padding`, `rich-text`, `select`, `social-items`, `text`, `toggle`, `visibility`. Každý má exportovanou komponentu.
- **Žádné zástupné texty:** grep na `TODO`, `FIXME`, `doplnit`, `zde bude`, `analogicky`, `obdobně`, `atd.` nevrátil ani jeden zásah.
- **Jediný výskyt dlouhé pomlčky v celém plánu je uvnitř testu, který ji zakazuje** (ř. 6503, `expect(text).not.toContain(...)` s literálem znaku U+2014). To není porušení, to je vynucení kritéria 68.
- **Vlastnictví je jinak čisté.** Kromě `vitest.config.ts` z nálezu K1 si plán nárokuje jen `apps/web/src/features/editor/**`, tři cesty šablon, `apps/web/e2e/editor/**` a dva katalogy i18n. Výslovně nesahá do `packages/emails` (P08), `packages/ui` (P05), `packages/contracts` (P02) ani na `proxy.ts`.
- **Žádná kolize s P06.** Oba plány pracují v `apps/web`, ale v oddělených větvích stromu: P06 v `(auth)`, `(account)` a `settings`, P12 v `features/editor` a v cestách `templates`. Sdílený soubor žádný, s jedinou výjimkou konfigurace Vitestu, kterou ale nevlastní ani jeden.
- **Vlastnictví i18n je čisté.** P12 vlastní právě `messages/{cs,en}/editor.json`. Ověřeno napříč všemi šestnácti plány: do namespace `editor` nesahá žádný jiný plán a P12 nesahá do `common` ani do cizích namespace. Uzávěr S4 je dodržený.
- **Rozsah MVP 0 je vymezený jako strop, ne jako návrh.** Kapitola 5 uvádí tabulku „Je v MVP 0 / Není v MVP 0" a k ní větu „Co je vpravo, se v tomhle plánu nedělá, ani když to vypadá jako maličkost". Svislý seznam sekcí ano, volné plátno ne, přesně podle části 3.
- **Neznámý typ bloku a blok `repeat` se otevřou a uloží beze ztráty dat**, i když se v paletě nenabízejí. To je ošetření, na které se běžně zapomíná a které chrání dokumenty vyrobené jinou verzí.
- **Kritérium 82 je pokryté mechanismem, ne slibem:** editor se načítá přes `next/dynamic` s `ssr: false` (rozhodnutí R12, ř. 80 a 7173), takže není v základním balíku.
- **Kapitola 9 je vzor pro ostatní plány.** Jedenáct požadavků na šest plánů (P05, P08, P07, P02, P13, P15), každý s číslem, adresátem a přesným zněním rozhraní. Zvlášť dobrá je položka P15-R1, která dopředu vymezuje **jedinou** změnu, na kterou má P15 v souborech P12 svolení, a žádá ji jedním commitem.

---

## Shrnutí pro rozhodnutí

Dva ze čtyř kritických nálezů (K3 a K4) jsou neshody rozhraní s P05 a patří do stejného sjednocujícího průchodu jako nálezy z revizí P05 a P06. Rozhodnutí je jednoduché: **jména a tvary určuje P05**, protože vlastní `packages/ui`, s jedinou výjimkou komponenty `Alert`, kterou P05 doplnit musí, protože ji nezávisle žádají dva plány.

Jeden nález (K3, druhá půlka) je ale opačný: **tady má pravdu P05 a mýlí se P12.** Požadavek na `sandbox="allow-same-origin"` je krok zpět proti tvrdému požadavku K6 a nemá se mu vyhovět.

Nález K1 (testy nemají jak běžet) je nejnaléhavější, protože se netýká jen P12. Konfiguraci Vitestu pro `apps/web` vlastní P01 a je napsaná pro serverové testy, zatímco **oba obrazovkové plány vlny 1 a 2 testují komponenty vedle zdrojů**. Kdyby se to nechalo být, oba plány by proběhly se zdánlivě zelenými kroky, ve kterých se ve skutečnosti nespustil ani jeden test. To je horší než červený test a je to přesně ta situace, před kterou řídicí dokument varuje větou „Hlášení agenta není doklad hotové práce."

Nález K2 je vlastní, levný a zachytí ho CI. Doplnit `many` do tří zpráv je práce na pět minut.
