# Revize P06: nastavení projektu a přístupy, třináct obrazovek nad P04 a P05

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Revize plánu P06 (nastavení a přístupy) z prověrky plánů
> (31. 7. až 1. 8. 2026), tedy kontrola **textu plánu před stavbou**, ne kontrola kódu.
> **Verdikt typu „plán není proveditelný" se týkal tehdejšího plánu, ne dnešního produktu.** Ten stojí a funguje.
> Opravy se prováděly podle `docs/superpowers/plans/POSTUP-OPRAV.md`; **stav jednotlivých nálezů neověřen**.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

**Recenzovaný plán:** `/Users/petr/Projects/Mailing_Tool/docs/superpowers/plans/2026-07-31-p06-nastaveni-pristupy-ui.md` (13 995 řádků, 36 úkolů)
**Zdroj pravdy pro komponenty:** `2026-07-31-p05-design-system-i18n-skorapka.md`
**Normativní zdroj:** část 6 (`06-ui-ux.md`) kapitoly 11, 12, 15; část 1 kapitola 5.3
**Datum:** 2026-08-01

Nálezy jsou ověřené proti skutečnému kódu obou plánů, ne proti jejich průvodnímu textu. U každého je číslo úkolu a číslo řádku.

---

## Verdikt

**NALEZENY PROBLÉMY.**

P06 je řemeslně jeden z nejlépe napsaných plánů v repozitáři. Má vlastní preflight, který předpoklady **ověřuje spuštěním, ne pohledem**, katalogy s úplnými českými plurály, mapování chybových kódů statickou tabulkou místo skládání klíčů, důsledné importy podcestou a poctivé přiznání, že zelený axe test není doklad přístupnosti. Vlastnictví souborů má vymezené na řádek a dvě úzké výjimky jsou obě legitimní.

Blokuje ho ale něco, co si sám způsobit nemohl: **kapitola 2.2 popisuje rozhraní P05, které P05 nedodává.** Preflight v úkolu 1 je napsaný tak, aby to zachytil hned, což je správně, jenže tím se plán zastaví na prvním kroku a nedojde ani k úkolu 2.

Druhý nález je vlastní: **čtyři české zprávy vyrábějí ve větvi `=0` negramatickou češtinu**, protože `plural` stojí jen nad podstatným jménem a sloveso zůstalo mimo blok. Je to přesně ta past, kterou specifikace v 12.3 popisuje.

Třetí nález je společný s P12 a je z těch nepříjemných: **komponentní testy plánu nemají jak běžet**, protože konfiguraci Vitestu pro `apps/web` vlastní P01 a je napsaná pro serverové testy.

| Závažnost | Počet |
|---|---|
| KRITICKÉ | 4 |
| DŮLEŽITÉ | 4 |
| POZNÁMKA | 3 |

---

## KRITICKÉ

### K1. Preflight v úkolu 1 importuje sedm stavových komponent, které P05 neexportuje

**Kde v P06:** úkol 1, soubor `apps/web/test/p06/ui-contract.ts`, ř. 370 až 382:

```ts
import {
  EmptyState,
  ErrorState,
  FilteredEmptyState,
  ForbiddenState,
  LimitReachedState,
  LoadingSkeleton,
  NotFoundState,
  OfflineBanner,
  PartialErrorBoundary,
  ReadOnlyBanner,
  StaleDataBanner,
} from '@mlain/ui/patterns/states';
```

**Co P05 skutečně exportuje** (barrel `packages/ui/src/patterns/states/index.ts`, úkol 17): `EmptyState`, `ErrorBlock`, `ForbiddenState`, `NotFoundState`, `OverLimitState`, `PrerequisiteState`, `ReadOnlyBanner`, `ReadOnlyValue`, `StaleBanner`, `StaleContent`, `DetailSkeleton`, `TableSkeleton`.

| P06 importuje | P05 má | Stav |
|---|---|---|
| `EmptyState`, `ForbiddenState`, `NotFoundState`, `ReadOnlyBanner` | totéž | sedí |
| `ErrorState` | `ErrorBlock` | jiné jméno |
| `StaleDataBanner` | `StaleBanner` | jiné jméno |
| `LimitReachedState` | `OverLimitState` | jiné jméno |
| `LoadingSkeleton` | `TableSkeleton`, `DetailSkeleton` | jiné jméno, a jsou dvě |
| `FilteredEmptyState` | jen typ `EmptyStateVariant` | chybí jméno |
| `PartialErrorBoundary` | nic | chybí úplně |
| `OfflineBanner` | `SystemBar` s `kind: 'offline'` v `patterns/shell` | jinde a jinak |

Není to jen preflight: `LimitReachedState` se skutečně používá na ř. 9478 a 11296, `FilteredEmptyState` na ř. 11970 a 12655. Čtyři obrazovky by se tedy nezkompilovaly ani po opravě preflightu.

Věcně je pokryto všechno. `PartialErrorBoundary` obsluhuje `ErrorBlock` v dlaždici a offline řeší `SystemBar`. Je to spor o jména, ne o funkci, což ho nedělá méně blokujícím.

**Navržená oprava:** převzít jména z P05 a opravit je v P06 na všech čtyřech místech použití i v preflightu. Jediná výjimka: požádat P05 o re-export offline pruhu i pod `patterns/states`, protože offline je podle katalogu stavů 7.1 stav obrazovky, ne prvek skořápky.

**Kde se opravuje:** přejmenování **v P06, úkol 1** (kontrakt), úkoly 27, 29, 31 a 32 (použití) a **kapitola 2.2, předpoklad U4**. Re-export offline **v P05, úkol 17**.

---

### K2. Registr navigace má jiný tvar, a příznak `mvp0`, na kterém P06 staví, v P05 vůbec neexistuje

**Kde v P06:** kapitola 2.2, předpoklad U6 na ř. 146; vysvětlení na ř. 151; kontraktní typ v úkolu 1 na ř. 386 až 394:

```ts
export type NavItemContract = {
  id: string;
  section: 'main' | 'settings';
  labelKey: string;
  permission?: string;
  mvp0: boolean;
  href: (params: { workspaceSlug: string }) => string;
};
```

a import na ř. 369: `import { NAVIGATION, type NavItem } from '@mlain/ui/patterns/navigation/registry';`

**Co P05 dodává** (úkol 28, ř. 10859 až 10870):

```ts
export type NavigationItem = {
  id: string;
  labelKey: string;
  path: string;
  permission?: string;
  children?: NavigationItem[];
  reservedFor?: 'MVP2';
};
export const NAVIGATION: NavigationItem[] = [ … ]
```

Rozdílů je šest:

| Věc | P06 očekává | P05 dodává |
|---|---|---|
| Název typu | `NavItem` | `NavigationItem` |
| Struktura | plochý `readonly NavItem[]` | strom o sedmi kořenech s `children` |
| Hierarchie | pole `section: 'main' \| 'settings'` | vnoření do `children` |
| Cesta | `href(params)` jako **funkce** | `path` jako řetězec, `href` vzniká až v `visibleNavigation()` |
| Příznak MVP | `mvp0: boolean` na každé položce | **neexistuje**, jen `reservedFor?: 'MVP2'` na jediné položce |
| Mutabilita | `readonly` | běžné pole |

Nejzávažnější je `mvp0`. P06 na ř. 151 popisuje, jak pozdější plány svoje obrazovky zveřejní: „Pozdější plán, který svou obrazovku nastavení dodá, **přehodí jeden boolean** v souboru P05 jako deklarovanou úzkou výjimku." Kapitola 10.6 to opakuje: „P06 ho jen čte a filtruje podle oprávnění a **podle příznaku `mvp0`**."

**Ten boolean neexistuje.** P05 má v sekci Nastavení dvanáct položek (`settings-general`, `settings-sending`, `settings-fields`, `settings-members`, `settings-api-keys`, `settings-webhooks`, `settings-consent`, `settings-tracking`, `settings-ai`, `settings-audit`, `settings-backups`, `settings-account`) a žádná nenese informaci, že se v MVP 0 nezobrazuje. P06 dodává šest z nich. Zbylých šest by se v menu zobrazilo a vedlo na cestu, kterou v MVP 0 nikdo nenaplní.

**Navržená oprava:** požádat P05 o doplnění `mvp0: boolean` do `NavigationItem` a o nastavení `false` u šesti položek, které P06 nedodává. Zbytek (`NavItem` proti `NavigationItem`, `section`, `href` jako funkce, `readonly`) srovnat na straně P06, protože registr vlastní P05 a uzávěr S5 zakazuje, aby ho měnil někdo jiný.

**Kde se opravuje:** příznak `mvp0` **v P05, úkol 28**. Název typu a tvar kontraktu **v P06, úkol 1 a kapitola 2.2**.

---

### K3. Čtyři české zprávy dávají ve větvi `=0` negramatickou větu, protože `plural` nestojí nad celou větou

**Kde:** úkol 10, katalogy `auth` a `settings`.

Specifikace v 12.3 (ř. 4535 souboru `06-ui-ux.md`) varuje výslovně: „v češtině se s číslem mění nejen podstatné jméno, ale i sloveso. Řešení je `plural` nad **celou větou**, ne jen nad podstatným jménem." P06 to v ostatních zprávách dodržuje, ale ve čtyřech případech nechal sloveso mimo blok a větev `=0` se pak s ním nepotká.

| Ř. | Klíč | Výstup při nule | Proč je špatně |
|---|---|---|---|
| 2886 | `auth.formErrorsSummary` | „Formulář se nepodařilo odeslat. **Opravte nic** níž." | Sloveso musí být záporné: „Není co opravovat." |
| 2890 | `auth.password.tooShort` | „Heslo musí mít aspoň 12 znaků. **Zadali jste žádný znak**." | Čeština vyžaduje zápor u „žádný": „Nezadali jste nic." |
| 3269 | `settings.logoutAllConsequence` | „**Ukončíme žádnou relaci**, tuhle kartu nevyjímaje." | Totéž: „Neukončíme žádnou relaci." |
| 3296 | `settings.dialogConsequence1` | „**Přepočítáme 5. pád u žádného kontaktu**." | Totéž: „Nepřepočítáme 5. pád u žádného kontaktu." |

Pátý případ je jiného druhu, ale patří sem:

| Ř. | Klíč | Výstup při nule |
|---|---|---|
| 3466 | `settings.webhook.failing` | „Selhává, **žádný neúspěch** po sobě" |

Tenhle řetězec navíc není věta, ale fragment sestavovaný do delšího textu, což je proti pravidlu z 12.2 „Nikdy neskládáme věty z fragmentů".

Ostatní zprávy jsou v pořádku, například `auth.rateLimit.body` na ř. 2977: „Počkejte **chvíli** a zkuste to znovu." Tady větev `=0` do věty zapadne, protože sloveso zápor nepotřebuje.

**Navržená oprava:** u všech pěti přesunout celou větu dovnitř každé větve, tedy tvar

```
"{count, plural, =0 {Není co opravovat.} one {Opravte # pole níž.} few {Opravte # pole níž.} many {Opravte # pole níž.} other {Opravte # polí níž.}}"
```

Anglické protějšky (ř. 3035, 3039, 3798, 3825, 3995) se musí upravit stejně, aby zůstala parita klíčů.

**Kde se opravuje:** **v P06, úkol 10**, oba katalogy.

**Proč to vadí:** kontrola z úkolu 10 na ř. 4337 sice ověřuje, že každá zpráva s `plural` má všechny kategorie, ale kategorie jsou přítomné. Test tedy projde a chyba se pozná až v provozu, u uživatele, který ve formuláři nic nepokazil.

---

### K4. Dvacet komponentních testů leží mimo vzor, který konfigurace Vitestu hlídá, a P06 tu konfiguraci nevlastní

**Kde v P06:** testovací soubory rozeseté po úkolech 12 až 33, například `apps/web/src/features/auth/login-form.test.tsx`, `apps/web/src/features/api-keys/secret-reveal.test.tsx`, `apps/web/src/features/profile/sessions-section.test.tsx`. Celkem dvacet souborů v `apps/web/src/features/**`.

**Co dodává P01** (ř. 4971 a 5100 plánu P01), a je jediným vlastníkem toho souboru:

```ts
// apps/web/vitest.config.ts
export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

Tři neslučitelné rozdíly:

| Věc | P01 dodává | P06 potřebuje |
|---|---|---|
| Vzor souborů | `test/**/*.test.ts` | i `src/**/*.test.tsx` |
| Prostředí | `node` | `jsdom` |
| JSX | žádný plugin | `@vitejs/plugin-react` |

Testy v `apps/web/test/p06/` (preflight, kontrakt, změna hesla) do vzoru padnou, ale dvacet komponentních testů v `src/features/**` **Vitest vůbec nenajde**. Kroky „spustit test, musí spadnout" pak nevypíšou červený test, ale hlášku, že žádné testy nejsou. To vypadá jako úspěch a je to horší než selhání.

Ani po opravě vzoru by neprošly: `render()` a `screen.getByRole()` potřebují jsdom a React plugin, ani jedno v konfiguraci není.

P06 přitom **nemá jak to opravit**: kapitola 0.3 dovoluje jen přidat `msw` do `devDependencies` a `vitest.config.ts` nemá ve vlastnictví (kapitola 10) ani mezi předpoklady na P05 (kapitola 2.2).

**Navržená oprava:** zapsat požadavek na P01, aby konfigurace zněla:

```ts
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});
```

**Kde se opravuje:** konfigurace **v P01**; požadavek **v P06, v nové kapitole podle nálezu D3**, a zároveň v předpokladech kapitoly 2.

**Týká se to i P12**, který má tentýž problém a navíc si soubor nárokuje podmínkou „jen pokud ještě neexistuje", která se nikdy nesplní. Požadavek na P01 je společný a má se vyřešit jednou.

---

## DŮLEŽITÉ

### D1. Sweep přes axe se jmenuje „na všech třinácti obrazovkách", ale dvě obrazovky vynechává

**Kde:** úkol 34, ř. 13210 (název) a ř. 13280 až 13298 (seznamy).

Seznamy mají třináct položek: šest veřejných a sedm pro přihlášeného uživatele. Dvě z nich jsou ale varianty téže cesty (`/reset-password` bez tokenu a s tokenem), takže **různých obrazovek je dvanáct**.

Proti tomu kapitola 10.4 vypisuje vlastní cesty v routeru a jsou mezi nimi dvě, které v sweepu nejsou:

- `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/webhooks/[endpointId]/page.tsx`, tedy **detail webhooku s logem doručení**, který dodává úkol 31 a je to plnohodnotná obrazovka s tabulkou, filtry a akcemi
- `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/page.tsx`, tedy rozcestník nastavení

Detail webhooku je z těch dvou důležitější: má nejsložitější tabulku v celém plánu.

**Navržená oprava:** doplnit obě cesty do `PRIVATE_SCREENS` a název úkolu opravit na skutečný počet.
**Kde se opravuje:** **v P06, úkol 34, krok 2.**

---

### D2. Deklarované počty souborů nesedí se seznamy hned pod nimi

**Kde:** kapitola 10.

| Podkapitola | Deklarováno | Skutečně vypsáno |
|---|---|---|
| 10.4 Cesty v routeru | „19 souborů" | **22** (pět souborů skořápky nastavení je na jednom řádku, layout, page, loading, error, not-found, a dva řádky nesou po dvou souborech) |
| 10.5 Testy a dokumentace | „6 souborů" | **8** |

Kapitola 10.4 navíc slučuje víc souborů na jeden řádek, takže se to snadno přehlédne. Vlastnictví je tím jednoznačné, chybný je jen součet.

**Navržená oprava:** přepočítat obě čísla, nebo je nahradit větou bez počtu.
**Kde se opravuje:** **v P06, kapitoly 10.4 a 10.5.**

---

### D3. Požadavek na `csrf_token` v odpovědi `/auth/me` je nový a P04 ho potvrdit musí, jinak je sekundární obrana jen na papíře

**Kde:** kapitola 2.1, předpoklad E1 na ř. 123 a zdůvodnění na ř. 135.

P06 sám přiznává, že jde o **jediný nový požadavek vůči tabulce 4.8 části 1**, a zdůvodňuje ho správně: double submit token se odvozuje z `sessions.csrf_secret`, ke kterému má přístup jen backend, takže bez vydání přes API by ho Server Action neměl odkud vzít.

Argument je platný, ale zůstává to požadavek na cizí plán, který v P06 nikde není zapsaný jako **formální požadavek na P04**. P06 nemá kapitolu „Požadavky na jiné plány", jakou má P05 (kapitola 8) a P12 (kapitola 9). Předpoklady v kapitole 2 nejsou totéž: ty se ověřují, ty se nepředávají.

Totéž platí pro E8 (pole `requiredPermission`, `currentRole`, `grantedByRoles[]`, `contactableMembers[]` v chybě `forbidden`). Ten požadavek vznáší nezávisle i P05 v kapitole 8 pod značkou P05→P04, takže na něj někdo dohlédne. Na `csrf_token` nikdo.

**Navržená oprava:** doplnit do P06 krátkou kapitolu „Požadavky na jiné plány" a zapsat do ní E1 (`csrf_token`) a E8. Pokud P04 obojí nedodává, patří to i do evidence nálezů.
**Kde se opravuje:** **v P06, nová kapitola za kapitolou 9**, a případně v P04.

---

### D4. Filtrování navigace si P06 píše sám, přestože ho P05 dodává hotové

**Kde:** kapitola 10.6: „P06 ho jen čte a **filtruje podle oprávnění** a podle příznaku `mvp0`."

P05 v úkolu 28 dodává funkci `visibleNavigation({ permissions, workspaceSlug })`, která filtrování podle oprávnění provede, skryje rezervované položky, zahodí sekci bez jediné viditelné podpoložky a dopočítá `href` se slugem projektu. Má na to osm testů.

Kdyby si P06 filtrování napsal znovu, vzniknou dvě pravidla pro totéž a rozejdou se. Pravidlo „sekce bez jediné viditelné podpoložky zmizí celá" je přesně to, co se při druhém psaní zapomíná.

**Navržená oprava:** v kapitole 2.2 doplnit `visibleNavigation` mezi předpoklady (je to funkce, kterou P06 potřebuje) a v kapitole 10.6 změnit větu na „P06 ho jen čte a vykresluje výstup `visibleNavigation`".
**Kde se opravuje:** **v P06, kapitoly 2.2 a 10.6.**

---

## POZNÁMKY

### P1. Vzor pro rody se P06 netýká, a je to v pořádku

Ověřeno grepem: **P06 neobsahuje ani jednu ICU zprávu s `gender, select`.** Není to opomenutí. P06 zobrazuje nastavení projektu, členy, klíče a webhooky, tedy žádnou větu o konkrétním kontaktu, u kterého by se rod uplatnil. Chybný vzor ze specifikace (nález N5 v evidenci) se sem tedy nekopíruje, protože se sem kopírovat nemá.

Pro srovnání: P05 vzor správně opravuje v úkolu 8 a P14 opravenou podobu používá ve všech čtrnácti zprávách časové osy.

### P2. Licence jsou v pořádku a `pa11y` se nikde nevyskytuje

Jediná nová závislost je `msw` 2.15.0, **MIT**, a je to `devDependency` (kapitola 3.2, ř. 176). Zdůvodnění na ř. 184 je věcné: obálka `apiFetch` musí posílat konkrétní hlavičky a to jde ověřit jen odchycením skutečného požadavku, kdežto `vi.mock` nad `fetch` by testoval mock.

Ostatní závislosti P06 jen používá a nezavádí. `axe-core` a `@axe-core/playwright` jsou MPL-2.0, správně vedené jako vývojové s odkazem na `licenses.allow.json`, který P06 nemění. Grep potvrdil **nula výskytů `pa11y`** v celém plánu. Žádná GPL, LGPL ani AGPL.

### P3. Co dál je ověřené jako v pořádku

- **Počet úkolů sedí:** 36 nadpisů `### Úkol N`, číslování souvislé, bez duplicit.
- **Žádné zástupné texty:** grep na `TODO`, `FIXME`, `doplnit`, `zde bude`, `analogicky`, `obdobně`, `atd.` nevrátil ani jeden zásah.
- **Žádná dlouhá pomlčka:** znak U+2014 se v P06 nevyskytuje ani jednou.
- **Importy jsou důsledně podcestou:** 97 importů tvaru `@mlain/ui/...` a **nula** z holého barrelu `@mlain/ui`. P06 tím jako jediný z konzumujících plánů dodržuje uzávěr S11. Pro srovnání, P11, P13 a P16 mají dohromady devatenáct barrel importů, které se nevyřeší.
- **Kritérium 18 je dodržené a otestované.** Úkol 11 na ř. 4424 pravidlo cituje a řeší ho změnou textu a `aria-busy` místo zašednutí; dvojité odeslání ošetřuje idempotence z úkolu 5, ne zablokované tlačítko. Testy na ř. 4444, 4452 a 4843 skutečně ověřují nepřítomnost atributu.
- **Vlastnictví i18n je čisté.** P06 vlastní právě čtyři soubory: `messages/{cs,en}/auth.json` a `messages/{cs,en}/settings.json`. Ověřeno napříč všemi šestnácti plány: do namespace `auth` ani `settings` nesahá žádný jiný plán a P06 nesahá do `common`. Uzávěr S4 je dodržený.
- **Dvě úzké výjimky z vlastnictví jsou legitimní.** Kapitola 0.3 dovoluje jen přidat `msw` do `devDependencies` v `apps/web/package.json` a u `packages/i18n/package.json` výslovně „nic". Ani jedna nesahá do `packages/ui`.
- **Kolize s P12 žádná.** Oba plány pracují v `apps/web`, ale v oddělených větvích stromu: P06 v `(auth)`, `(account)` a `w/[workspaceSlug]/settings`, P12 v `features/editor` a v cestách šablon. Žádný sdílený soubor.
- **Chybové kódy se nemapují skládáním klíče.** Úkol 7 dodává statickou tabulku kód na klíč, čímž plní kritérium 71 i pravidlo z 12.8 o zákazu skládání klíčů za běhu. Neznámý kód spadne na `detail` ze serveru a `request_id`, tedy kritérium 76.
- **Testy nekontrolují doslovné znění.** Úkol 35 staví prázdné stavy strukturálně (existence vysvětlení a aspoň jednoho prvku s rolí tlačítka nebo odkazu), přesně jak žádá kritérium 20 a jak zakazuje 76c.
- **České plurály mají mimo pět případů z nálezu K3 všechny čtyři kategorie plus `=0`**, včetně `many` pro desetinná čísla, a anglické správně jen `one` a `other`.

---

## Shrnutí pro rozhodnutí

Dva ze tří kritických nálezů (K1 a K2) nejsou chybou P06. Vznikly tím, že se P05 a P06 psaly souběžně a nikdo nepostavil vedle sebe seznam exportů proti seznamu importů. P06 si toho je částečně vědom, protože si postavil preflight, který to zachytí, jenže preflight umí jen zastavit, ne opravit.

Doporučuji je řešit v jednom sjednocujícím průchodu přes rozhraní `packages/ui` společně s nálezy z revize P05, ne odděleně. Rozhodnutí je jednoduché: **jména určuje P05**, protože vlastní balíček, s jedinou výjimkou příznaku `mvp0`, který v registru chybí a doplnit ho musí P05.

Čtvrtý nález (K4) je nejnaléhavější, protože se netýká jen P06. Konfiguraci Vitestu pro `apps/web` vlastní P01 a je napsaná pro serverové testy, zatímco **oba obrazovkové plány, P06 i P12, testují komponenty vedle zdrojů**. Kdyby se to nechalo být, oba by proběhly se zdánlivě zelenými kroky, ve kterých se ve skutečnosti nespustil ani jeden test. To je horší než červený test a je to přesně ta situace, před kterou řídicí dokument varuje větou „Hlášení agenta není doklad hotové práce."

Třetí nález (K3) je vlastní a levný: pět zpráv, čtvrthodina práce. Zaslouží si ale pozornost, protože kontrola z úkolu 10 ho nezachytí. Test ověřuje, že kategorie existují, ne že věta dává smysl. Stojí za zvážení doplnit do kontroly pravidlo, že větev `=0` nesmí začínat slovem „žádn" bez záporného slovesa ve zbytku zprávy, protože právě tahle kombinace je v češtině spolehlivá známka rozbité věty.
