# P06 Nastavení projektu a přístupy: implementační plán

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Implementační plán P06 (nastavení projektu a přístupy) z 31. 7. 2026, sepsaný před
> začátkem stavby. Zachycuje, co se tehdy plánovalo, ne dnešní podobu kódu.
> **Postaveno:** obrazovky nastavení, přihlášení a profilu v aplikaci jsou; stránka detailu úlohy (`/w/{slug}/jobs/...`, nález N30) v repozitáři **není**.
> **Zaškrtávátka nikdo neodškrtával**, prázdné políčko tady tedy neznamená nedodělek.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

> **Pro agentní pracovníky:** POVINNÁ PODŘÍZENÁ DOVEDNOST: použij `superpowers:subagent-driven-development` (doporučeno) nebo `superpowers:executing-plans` a proveď plán úkol po úkolu. Kroky mají zaškrtávací syntaxi (`- [ ]`) kvůli sledování postupu.

**Cíl:** Dodat čtrnáct obrazovek nad jádrem identity produktu Mlain Mailer, tedy přihlášení a první spuštění (`/setup`, `/login`, `/forgot-password`, `/reset-password`, `/invitations/accept`, `/no-workspace`), profil uživatele (`/settings/profile`), pět obrazovek nastavení projektu (`/w/{slug}/settings/general`, `members`, `api-keys`, `webhooks`, `audit`) s detailem webhooku a stránku detailu úlohy (`/w/{slug}/jobs/{kind}/{jobId}`, nález N30), včetně namespace i18n `auth` a `settings` v češtině a angličtině, se všemi povinnými stavy seznamu a s doloženou přístupností.

**Architektura:** Obrazovky jsou Server Components v Next.js 16 App Routeru, které čtou data přes tenkou serverovou obálku nad veřejným API `/api/v1` (vlastní ho P04). Obálka nikdy nevyhazuje výjimku: vrací `Result<T>`, tedy buď data, nebo `Problem` podle RFC 9457, takže každá obrazovka umí vykreslit stav chyby s `request_id`, aniž by k tomu potřebovala `try`/`catch` v JSX. Zápisy jdou přes Server Actions, které tutéž obálku volají metodou `POST`, `PATCH` nebo `DELETE` a doplňují hlavičky `Origin`, `X-CSRF-Token` a `Idempotency-Key`. Veškerá prezentace stojí na komponentách z `packages/ui` (vlastní je P05); P06 do sdíleného balíčku nezapisuje ani řádek. Oprávnění se vyhodnocují **na serveru** a do klientských komponent jde jen prostý seznam řetězců, takže se do prohlížeče nedostane nic z `packages/core`.

**Technologie:** TypeScript, React 19 v Next.js 16 App Router, Tailwind CSS 4 a shadcn/ui přes `@mlain/ui`, `next-intl` 4.13.4 s ICU MessageFormat, Vitest 4.1.10 s jsdom a Testing Library pro testy komponent, `msw` 2.15.0 pro testy HTTP obálky, Playwright 1.62.1 s `@axe-core/playwright` 4.12.1 pro průchody a přístupnost.

---

## 0. Rámec plánu

### 0.1 Povinná četba, než napíšeš první řádek

| Dokument | Kapitoly |
|---|---|
| `docs/superpowers/plans/2026-07-31-rozdeleni-implementacnich-planu.md` | celý, hlavně 1.1, 2 (S3, S4, S5, S9, S11), 4 a 5 (P06) |
| `docs/superpowers/specs/parts/01-platforma.md` | 3.1 až 3.9, 4.2, 4.3, 4.4, 4.8, **5.3 celá**, 8 |
| `docs/superpowers/specs/parts/06-ui-ux.md` | 4.3, 4.4, 4.5, **5**, **6**, **7**, **9**, **10**, **11**, 12.3, 12.4, 13.1, 15 |
| `docs/superpowers/plans/2026-07-31-p04-jadro-api-identita.md` | 0.1 až 0.9 (co P06 volá a co nesmí měnit) |
| `docs/superpowers/plans/2026-07-31-p05-design-system-i18n-skorapka.md` | 0 až 4 (co P06 importuje) |

### 0.2 Jediné řídicí pravidlo

> **Každý soubor v repozitáři má právě jeden plán, který ho smí vytvořit a měnit. Ostatní plány ho jen čtou.**

Úplný seznam souborů, které vlastní P06, je v kapitole 10 na konci plánu. **Mimo ně tenhle plán nesahá.** Konkrétně se nedotýká:

- **`packages/ui` celý** a **`packages/i18n/src`, `packages/i18n/messages/*/common.json`**: vlastní P05. P06 komponenty jen importuje. Když komponenta chybí nebo neumí, co je potřeba, **nedopisuje se do `packages/ui`**, ale doplní se požadavek do P05 a P06 na něj počká. Vlastní komponenta v `apps/web` je povolená jen tehdy, když je specifická pro obrazovku a nikdo jiný ji nepoužije.
- **`packages/core` celý** a **`apps/web/src/lib/api`**: vlastní P04. P06 volá HTTP endpointy, nevolá doménové služby přímo.
- **`packages/db` celý**: vlastní P03. P06 nesahá na schéma ani nespouští žádný dotaz.
- **`apps/web/src/proxy.ts`**, kořenový `apps/web/src/app/layout.tsx`, `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/w/[workspaceSlug]/layout.tsx`, `apps/web/playwright.config.ts`, **registr navigace**: vlastní P05.
- **kořen repozitáře, `packages/config`, `docker/`, `.github/workflows`, registr chybových kódů, registr front**: vlastní P01.
- **`/w/{slug}/settings/backups`**: viz rozhodnutí R2.

### 0.3 Úzké výjimky, které si plán bere vědomě

Dvě věci nejdou udělat bez zásahu do cizího souboru. Obě jsou vyjmenované a nic dalšího si plán nedovolí.

| Soubor | Vlastník | Co P06 smí | Co nesmí |
|---|---|---|---|
| `apps/web/package.json` | P01 | přidat položky do `devDependencies` (`msw`) | měnit `name`, `scripts`, `next` konfiguraci, produkční závislosti |
| `packages/i18n/package.json` | P05 | nic | nic; nové namespace soubory se přidávají jen do `messages/`, loader je generický a mění se nemusí |

### 0.4 Git

Commit kroky provádí **hlavní agent**. Subagent, který úkol vykonává, píše soubory a spouští testy, ale gitu se nedotýká. Plán běží ve vlastním worktree založeném z `HEAD`, na vlastní větvi.

### 0.5 Pokrytá akceptační kritéria

Z kapitoly 8 části 1 (`01-platforma.md`):

| Kritérium | Kde je pokryté |
|---|---|
| 15 | Úkol 13 (`423 account_locked` má vlastní stav obrazovky přihlášení s časem odemčení) |
| 17 | Úkol 19 (po změně hesla zůstane aktuální relace, ostatní zmizí ze seznamu relací) |
| 18 | Úkol 20 (odhlášení ze všech zařízení vyhodí i tuhle kartu na `/login`) |
| 22 | Úkol 25 (`last_owner_cannot_be_removed` má vlastní hlášku, role se v tabulce nezmění) |
| 23 | Úkol 21 a 35 (role `viewer` nevidí sekce nastavení, přímý přístup je stav S11) |
| 25 | Úkol 27 (sekret klíče v seznamu není v žádném poli, zobrazí se právě jednou po vytvoření) |
| 26c | Úkol 28 (rotace s `grace_seconds` a text o dožívajícím sekretu) |
| 27, 28 | Úkol 4, 12 (`validation_failed` se mapuje na pole formuláře podle `errors[].path`) |
| 29 | Úkol 8 (`request_id` je v každém chybovém bloku a jde zkopírovat) |
| 30 | Úkol 5 (`Idempotency-Key` u každého vytvářejícího Server Action) |
| 32 | Úkol 13 (`429` se `Retry-After` má vlastní stav a odpočet) |
| 33 | Úkol 6 (kurzorové stránkování bez čísel stránek, kurzor v URL) |
| 37, 40 | Úkol 29 a 31 (stav `disabled` a znovuaktivace) |
| 51, 52, 53 | Úkol 10 (parita klíčů, výjimka u chybějícího klíče, ICU `plural` se čtyřmi kategoriemi) |

Úplná tabulka i se zněním kritérií je v kapitole 9 na konci plánu.

Z kapitoly 15 části 6 (`06-ui-ux.md`):

| Kritérium | Kde je pokryté |
|---|---|
| 1 | Úkol 5 (každý Server Action má právě jeden primární kanál zpětné vazby, hlídá to test) |
| 3 | Úkol 25 a 26 (chybový toast u akcí nad členy se sám nezavře) |
| 5 | Úkol 25 (selhaná optimistická změna role vrátí výběr na původní hodnotu) |
| 18 | Úkol 11 (žádné primární tlačítko v P06 nemá `disabled`) |
| 19 | Úkol 36 (sada testů simuluje prázdnou odpověď, chybu, 403, 404 a offline na každém seznamu) |
| 20, 21 | Úkol 36 a 31 (strukturální test prázdného stavu a prázdného stavu po filtrování) |
| 22 | Úkol 8 (sbalitelné technické detaily s kódem, `request_id` a tlačítkem zkopírovat) |
| 23 | Úkol 22 (jen pro čtení jako text, ne zašedlá pole, s pruhem s důvodem) |
| 68, 69, 70 | Úkol 10 (dlouhá pomlčka, slovník 9.2, parita klíčů) |
| 71 | Úkol 7 (statická mapa kódu na klíč, žádné skládání klíče za běhu) |
| 72 | Úkol 10 (ICU `plural` s `=0` a všemi českými kategoriemi) |
| 76 | Úkol 7 (neznámý kód zobrazí `detail` ze serveru a `request_id`) |
| 76b | Úkol 10 (každý kód z mapování 10.2, který P06 zobrazuje, má klíč v obou katalozích) |
| 76c | Úkol 10 (žádný test nekontroluje doslovné znění věty) |
| 78, 79 | Úkol 6 (žádná čísla stránek, kurzor v URL, neplatný kurzor vrátí první stránku téhož filtru) |
| 80 | Úkol 11 a 33 (indikátor se nezobrazí do 300 ms a pak zůstane aspoň 400 ms) |

---

## 1. Rozhodnutí, která tenhle plán udělal sám

Devět míst, kde se zdroje rozcházely nebo mlčely. Kdo plán provádí, se jimi řídí a nevymýšlí je znovu.

| # | Věc | Rozhodnutí | Důvod |
|---|---|---|---|
| **R1** | Kde končí `/setup` a začíná onboarding | P06 dodává **jen** `/setup`, tedy formulář na prvního uživatele a první projekt proti `POST /api/v1/setup`, a po úspěchu přesměruje na `/w/{slug}`. Průvodce z 8.1.2 až 8.1.5 (ukázková data, nastavení odesílání, první import) dodává P16 a P06 na něj nečeká. | Řídicí dokument dává 8.1 plánu P16, ale část 1 v 5.3 dává `/setup` plánu P06. Rozpor je jen zdánlivý: `/setup` je jediná obrazovka, která musí existovat, aby šlo instalaci vůbec použít, kdežto onboarding je nadstavba. Rozdělení na hranici endpointu `POST /api/v1/setup` je jednoznačné a testovatelné. |
| **R2** | Obrazovka Zálohy | **P06 ji nedodává.** Patří P16 spolu s `mlain backup` a dostane vlastní namespace i18n `backups`, ne klíče uvnitř `settings`. | Kapitola 5 řídicího dokumentu vyjmenovává u P06 pět obrazovek nastavení a zálohy mezi nimi nejsou; 5.3 části 1 je má v tabulce, protože tabulka popisuje celou doménu, ne dělbu práce. Vlastní namespace pro P16 je nutný, protože `settings` má vlastníka a dva zapisovatelé do jednoho katalogu jsou přesně ten konflikt, kterému se dělení vyhýbá. |
| **R3** | Audit log jako tabulka, ne časová osa | Audit log je **tabulka s filtry**, ne časová osa. Komponenta K8 se na něm nepoužívá a komponenta K1 taky ne: tabulku kreslí P06 sám, viz poznámka v kapitole 2.2. | Část 1 v 5.3, kterou P06 vlastní, popisuje obrazovku jako „seznam s filtry". Řídicí dokument sice uvádí audit mezi třemi místy, kde se K8 použije, ale zároveň říká, že K8 **plní P14**, tedy plán z vlny 3. P06 je ve vlně 1 a nesmí na něj čekat. Tabulka navíc unese filtry, kurzorové stránkování i sloupec `request_id`, což je u auditu to, co se doopravdy dělá. Kdyby P14 chtěl přidat pohled časové osy, je to rozšíření obrazovky, ne její základ. |
| **R4** | Typ `Problem` na straně rozhraní | P06 definuje vlastní `apps/web/src/lib/api-client/problem.ts` podle 4.8 části 1, včetně `findings` a `params`. Typový test ověří shodu tvaru. | `packages/sdk-node` nemá v dělení vlastníka a `apps/web/src/lib/api/problem.ts` vlastní P04 pro **stavbu** odpovědi, ne pro její čtení. Duplicita jednoho typu je levnější než sdílený soubor se dvěma vlastníky. Až `sdk-node` vlastníka dostane, typ se do něj přesune. |
| **R5** | Selhání sítě vůči vlastnímu API | Syntetizuje se `Problem` s **registrovaným** kódem `service_unavailable` (spojení se nenavázalo) nebo `dependency_timeout` (vypršel čas), s prázdným `request_id`. Blok technických detailů řádek s číslem požadavku vynechá a místo něj ukáže cestu. | Vymyslet `request_id` by znamenalo dát uživateli číslo, které v logu neexistuje, a to je horší než ho nemít. Zavést nový kód by porušilo pravidlo, že kódy zakládá P01. Oba použité kódy v katalogu 4.2 jsou a významem sedí. |
| **R6** | Popisek sbaleného bloku | „Technické detaily" (`Technical details`). | Část 1 v 5.3 a zadání plánu říkají „Technické detaily", část 6 v 7.4 „Podrobnosti pro technickou podporu". Jde o tentýž prvek. Volím kratší variantu ze dvou zdrojů proti jednomu; obsah bloku (kód, číslo požadavku, čas, cesta, tlačítko zkopírovat) se řídí částí 6, protože ta je konkrétnější. |
| **R7** | Odebrání člena je N2, ne N1 s vrácením | Odebrání člena má **potvrzovací dialog úrovně N2** se jménem, e-mailem a rolí a s větou, že zpět se člověk dostane jen novou pozvánkou. | Tabulka 6.2 části 6 dává odebrání člena N1, tedy „provést a nabídnout Vrátit zpět". Jenže vrácení technicky neexistuje: `DELETE /api/v1/members/{user_id}` je jednosměrný a zpětná cesta vede přes novou pozvánku, kterou musí druhá strana přijmout. Tlačítko „Vrátit zpět", které ve skutečnosti pošle pozvánku, je lež. Vlastní pravidlo kapitoly 6 zní „když akci jde nabídnout jako vratnou, je vratnost lepší než potvrzování"; tady vratnost neexistuje, takže platí potvrzení. |
| **R8** | Rozlišení prázdného stavu S1 a S3 | Stav S3 („všechno jste smazali") se pozná podle příznaku `?emptied=1`, který do URL vloží akce mazání. Bez příznaku se ukáže S1. | Rozlišení je otázka historie, kterou API nevrací, a druhý dotaz jen kvůli textu prázdného stavu je špatná cena. Příznak v URL je přesný v okamžiku, kdy na tom záleží (hned po smazání), a po znovunačtení stránky spadne na S1, což je pravdivé: seznam je prázdný a uživatel má stejnou primární akci. |
| **R9** | Autentizační brána je v obrazovkách, ne v `proxy.ts` | Přesměrování nepřihlášeného uživatele na `/login?next=` dělá serverová funkce `requireUser()` volaná v Server Component každé chráněné obrazovky. | `apps/web/src/proxy.ts` vlastní P05 a P06 do něj nesmí zapsat matcher. Kontrola v obrazovce je navíc přesnější: `proxy.ts` nezná role ani členství a musel by na každý požadavek volat API. Řešení funguje i tehdy, když P05 do `proxy.ts` nějakou autentizační logiku doplní, protože dvojí kontrola nikomu nevadí. |

---

## 2. Předpoklady a požadavky na jiné plány

Plán P06 běží po smergování celé vlny 0 do `main`. **Úkol 1 je preflight, který každý předpoklad ověří spuštěním, ne pohledem.** Když některý chybí, doplní se do plánu, který ho vlastní, a P06 se spustí až potom. Neopravuj to za běhu v P06, protože ty soubory P06 nevlastní.

Kapitoly 2.1 až 2.3 vyjmenovávají, co musí existovat. Kapitola 2.4 je něco jiného: **formální požadavky na cizí plány**, tedy věci, které P06 potřebuje a které v cizím plánu zatím nejsou. Předpoklad se ověřuje, požadavek se předává. Bez té kapitoly by požadavek nikdo nepřevzal a P06 by se o něj opřel jen ve svém textu.

### 2.1 Na P04 (backend)

| # | Co musí existovat | Kde to plán potřebuje |
|---|---|---|
| E1 | `GET /api/v1/auth/me` vrací `{ user: { id, email, name, locale, timezone }, memberships: [{ workspace_id, name, slug, role }] }` a nově i `csrf_token` | přepínač projektů, `requireUser`, každý Server Action |
| E2 | `GET /api/v1/workspaces` vrací `{ data: [{ id, name, slug, locale, timezone, address_form, created_at }] }` | `/no-workspace`, nastavení projektu |
| E3 | `GET /api/v1/auth/sessions` vrací `{ data: [{ id, ip, user_agent, last_used_at, created_at, current }] }` | seznam aktivních relací |
| E4 | `GET /api/v1/webhook-endpoints/{id}` existuje (P04 to potvrzuje rozhodnutím R8) | detail webhooku |
| E5 | `GET /api/v1/audit-log/count` a `GET /api/v1/webhook-deliveries/count` existují (P04 R8) | počet nad tabulkou |
| E6 | `POST /api/v1/api-keys` vrací `secret` právě jednou; `POST /api/v1/api-keys/{id}/rotate` přijímá `grace_seconds` a vrací `secret` | zobrazení sekretu, rotace |
| E7 | `POST /api/v1/webhook-endpoints` vrací `secret` právě jednou | podpisový sekret webhooku |
| E8 | `Problem` s `code: "forbidden"` nese `params.requiredPermission`, `params.currentRole`, `params.grantedByRoles[]` a `params.contactableMembers[]` (požadavek U→1.1 části 6, hláška 22 v 10.3) | stav S11 |
| E9 | `POST /api/v1/invitations/accept` přijímá `{ token }` a vrací `{ workspace, role }` | přijetí pozvánky |
| E10 | `DELETE /api/v1/workspaces/{id}` vyžaduje v těle `{ confirm_name }` | smazání projektu |
| E11 | Neplatný `cursor` vrací 422 `validation_failed` s `errors[0].path = "cursor"` | pravidlo 79 části 6, kapitola 15.6 |
| E12 | `GET /api/v1/jobs` a `GET /api/v1/jobs/{kind}/{id}` existují a chtějí oprávnění `timeline:read` (P04 R8, úkol 45) | Centrum úloh a stránka detailu úlohy |

**Členství se jmenuje `name` a `slug`, ne `workspace_name` a `workspace_slug`.** `MembershipSchema` v P04 zní `{ workspace_id, name, slug, role }`. Dřívější znění téhle tabulky si vymyslelo delší jména a preflight by na nich spadl. Jména polí API vlastní P04, P06 se jim přizpůsobuje.

**E1 a `csrf_token` je jediný nový požadavek vůči tabulce 4.8 části 1, a P04 ho zatím nesplňuje.** Ověřeno čtením schématu odpovědi v P04: `z.object({ user: PublicUserSchema, memberships: z.array(MembershipSchema) })`, tedy bez tokenu. Funkci `csrfTokenFor(csrfSecret)` P04 má a při zápisu token ověřuje, ale **nikde ho klientovi nevydává**. Server Action by ho neměl odkud vzít a sekundární obrana z 3.2 části 1 by existovala jen na papíře. Je to formální požadavek P06→P04.1 v kapitole 2.4, ne jen poznámka; doplnění jednoho pole do už existující odpovědi není breaking change podle 4.6.

### 2.2 Na P05 (design systém, i18n, skořápka)

Tabulka je srovnaná se **skutečným zněním P05 po sjednocení rozhraní** (jeho kapitola 8.1, nález N30 v evidenci), ne s tím, co si P06 pamatoval z rozepsané verze. Jména komponent určuje P05, protože vlastní balíček.

| # | Co musí existovat | Import |
|---|---|---|
| U1 | Primitiva, která P06 skutečně vykresluje: `button`, `input`, `label`, `checkbox`, `radio-group`, `select`, `badge`, `skeleton`, `copy-button` | `@mlain/ui/components/<jméno>` |
| U2 | *(P06 komponentu K1 nepoužívá, viz poznámka pod tabulkou)* | |
| U3 | K5 toast s frontou, odpočtem u vrácení akce a bez automatického zavírání chyb | `@mlain/ui/patterns/toast` |
| U4 | Stavy obrazovek jako komponenty `EmptyState`, `FilteredEmptyState`, `ErrorBlock`, `ForbiddenState`, `NotFoundState`, `OverLimitState`, `PrerequisiteState`, `ReadOnlyBanner`, `ReadOnlyValue`, `StaleBanner`, `StaleContent`, `DetailSkeleton`, `TableSkeleton`, `Alert` | `@mlain/ui/patterns/states` |
| U5 | `ConfirmDialog` s úrovněmi rizika N2 až N4, s `confirmPhrase` pro N4 a s povinným propem `labels` | `@mlain/ui/patterns/feedback` |
| U6 | Registr navigace `NAVIGATION: NavigationItem[]` jako **strom** se `children` a s příznakem `mvp0`, plus funkce `visibleNavigation({ permissions, workspaceSlug })` | `@mlain/ui/patterns/navigation` |
| U7 | `packages/i18n` skládá katalogy z `messages/{locale}/<namespace>.json` do jednoho stromu a `apps/web/src/app/[locale]/layout.tsx` obaluje strom do `NextIntlClientProvider` | `useTranslations('auth')`, `useTranslations('settings')` |
| U8 | `apps/web/playwright.config.ts` s adresářem `apps/web/e2e` a s `webServer`, který instanci nastartuje | testy v úkolech 35, 36 a 37 |
| U9 | `useDelayedFlag` s prodlevou 300 ms a minimem zobrazení 400 ms | kritérium 80 části 6 |
| U10 | *(P06 `JobsCenter` nevykresluje, jen stránku detailu úlohy, viz úkol 34)* | |

**P06 komponentu K1 nepoužívá a tvrdí to nahlas.** Všech pět seznamů si kreslí `<table>` samo. Není to opomenutí ani lenost: `DataTable` z P05 žádá `columns`, `getRowId`, `labels`, `count` a `pagination` v tvaru, který P06 nemá čím naplnit, protože jeho endpointy vracejí kurzorové stránkování bez celkového počtu u čtyř z pěti seznamů, a u dvou tabulek je řádek formulářem se Server Action, ne jen daty. **Dřívější znění tvrdilo opak** a rozhodnutí R3 mluvilo o „datové tabulce K1" u audit logu, přestože kód žádnou nevykresloval. Jestli se sem K1 má vrátit, je rozhodnutí na jeden průchod přes všech pět tabulek a je zapsané jako nález v evidenci, ne skryté v tvrzení, které kód vyvrací.

**Importuje se na úroveň adresáře, ne souboru.** Mapa `exports` v `packages/ui/package.json` má jen tři vzory: `./components/*` na `./src/components/*.tsx`, `./patterns/*` na `./src/patterns/*/index.ts` a `./lib/*` na `./src/lib/*.ts`. Import `@mlain/ui/patterns/feedback` by se tedy hledal jako `src/patterns/feedback/confirm-dialog/index.ts`, což je adresář, který neexistuje. Správně je `@mlain/ui/patterns/feedback`. Totéž platí pro registr navigace: `@mlain/ui/patterns/navigation`, ne `.../navigation/registry`.

**Kořenový import `@mlain/ui` neexistuje.** P05 klíč `"."` z mapy `exports` odstranil, takže by skončil chybou `ERR_PACKAGE_PATH_NOT_EXPORTED` už při sestavení. Uzávěr S11 je tím vynucený překladačem, ne jen napsaný. P06 ho dodržoval od začátku a kontrolu na to má v úkolu 1.

**U4 a pět jmen, která se nezaložila.** Dřívější znění téhle tabulky žádalo `LoadingSkeleton`, `StaleDataBanner`, `PartialErrorBoundary`, `ErrorState` a `OfflineBanner`. P05 je vědomě nezaložil a má pravdu: P06 je měl jen v typovém kontraktu a **v žádném JSX je nevykresloval**. Věcně je pokryto všechno:

| Chtělo se | Co se použije | Kde v P06 |
|---|---|---|
| `ErrorState` | `ErrorBlock` | úkol 8: `problem-block.tsx` je **jen převod tvaru**, `ErrorBlock` kreslí celý blok S9 |
| `LoadingSkeleton` | `DetailSkeleton` a `TableSkeleton` | úkol 33: `settings-skeleton.tsx` obojí vykresluje |
| `StaleDataBanner` | `StaleBanner` a `StaleContent` | úkol 32: obojí vykresluje `audit-table.tsx` při `staleSince` |
| `PartialErrorBoundary` | `ErrorBlock` v dlaždici místo dat | úkol 22, stav S8 |
| `OfflineBanner` | `SystemBar` s `kind: 'offline'` ve skořápce P05 | úkol 33, `offline-watcher.tsx` je lokální pojistka |

**Tabulka mluví o kódu, ne o záměru.** Dřívější znění u čtyř řádků tvrdilo konkrétní místo použití, které kód vyvracel: chybový blok si P06 kreslil ručně a duplikoval tím komponentu z P05, kostry skládal z primitiva, banner zastaralých dat nevykresloval vůbec (existovaly jen texty v katalogu) a stav bez oprávnění si psal ručně, přestože ho měl v kontraktu. **Tvrzení o použití, které kód vyvrací, je horší než chybějící komponenta**, protože se podle něj nedá nic ověřit. Všechny čtyři jsou teď skutečně vykreslené a typový kontrakt v úkolu 1 obsahuje jen to, co v JSX opravdu je.

**U6 a příznak `mvp0`.** Registr obsahuje všech dvanáct položek Nastavení z mapy 4.1 části 6 jako `children` sekce `settings`. Šest, které dodává P06 (`settings-general`, `settings-members`, `settings-api-keys`, `settings-webhooks`, `settings-audit`, `settings-account`), má `mvp0: true`; zbylých šest má `mvp0: false` a `visibleNavigation` je odfiltruje. Pozdější plán, který svou obrazovku nastavení dodá, přehodí jeden boolean v souboru P05 jako **deklarovanou úzkou výjimku** ve svém vlastním plánu. Uzávěr S5 tím zůstává v platnosti: registr se nerozšiřuje, jen se u existující položky mění příznak.

**Filtrování si P06 nepíše.** `visibleNavigation({ permissions, workspaceSlug })` odfiltruje položky bez oprávnění, zahodí rezervované i nehotové, dopočítá `href` se slugem a **zahodí sekci, které nezbyla ani jedna viditelná podpoložka**. Právě tohle poslední pravidlo se při druhém psaní zapomíná, takže se nepíše podruhé. P06 volá funkci a vykresluje její výstup.

**Popisky navigace patří do `common`.** Registr nese klíče plnou cestou (`common.nav.settingsMembers`), protože nezná, kdo ho vykreslí. Katalog `common.json` vlastní P05. P06 klíč **nikdy neskládá ani neořezává**, předá ho tak, jak v registru je, přes `useTranslations()` bez namespace. Kritérium 71 části 6 tím zůstává splněné.

### 2.3 Na P01 (konfigurace testovacího běhu)

| # | Co musí existovat | Kde to plán potřebuje |
|---|---|---|
| T1 | `apps/web/vitest.config.ts` pouští i testy vedle zdrojů: `include` pokrývá `src/**/*.test.{ts,tsx}` | 44 ze 46 testovacích souborů P06 |
| T2 | `environment: 'jsdom'` a `plugins: [react()]` | `render()` a `screen` z Testing Library |
| T3 | `setupFiles` registruje **úklid mezi testy** (`cleanup` z `@testing-library/react`) a matchery `@testing-library/jest-dom` | bez úklidu se DOM z předchozího testu nezahodí |

**Proč je tenhle předpoklad nejnebezpečnější ze všech.** Konfigurace, kterou dnes P01 dodává, zní `{ environment: 'node', include: ['test/**/*.test.ts'] }`. Do vzoru padnou jen **dva** testovací soubory P06 (`test/p06/preflight.test.ts` a `test/p06/change-password.test.ts`), zbylých 44 v `src/**` Vitest **vůbec nenajde**.

Ověřeno spuštěním na Vitest 4.1.10, ne přečtením. Nad projektem s jedním procházejícím testem v `test/` a jedním **záměrně padajícím** testem v `src/`:

```
 ✓ test/ok.test.ts (1 test) 1ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
EXIT=0
```

Kompletní série tedy skončí zeleně a s návratovým kódem 0, přestože padající test nikdo nespustil. **To vypadá jako úspěch a je to horší než selhání.** Jednotlivý běh na konkrétní soubor mimo vzor skončí kódem 1 a hláškou `No test files found`, což je sice červené, ale hlásí to něco jiného, než se stalo.

Ověřením se zároveň ukázalo, že tvar konfigurace, na kterém se P05, P06 i P12 dohodly, **ještě nestačí**. Se samotným `plugins: [react()]`, `environment: 'jsdom'` a rozšířeným `include` běh na Vitest 4.1.10 skončí takhle:

```
TestingLibraryElementError: Found multiple elements with the role "button"
 Test Files  1 failed | 1 passed (2)
```

Příčina: automatický úklid `@testing-library/react` se registruje jen tehdy, když existuje globální `afterEach`, tedy při `globals: true`. Bez něj zůstane vykreslený strom z předchozího testu v dokumentu a `screen.getByRole` najde dva prvky. **Postihlo by to všech 27 testů komponent P06**, které vykreslují víc než jednou. Poznalo by se to až za běhu a vypadalo by to jako chyba testu, ne konfigurace. Obsah `vitest.setup.ts` v požadavku dosud nikdo nenapsal, takže by soubor mohl vzniknout prázdný a chyba by přišla i tak.

Přesné znění obou souborů je v požadavku P06→P01.1 v kapitole 2.4. **P06 ani jeden z nich nevlastní a nesmí je napsat.** Úkol 1 proto obsahuje kontrolu, která na chybějící pokrytí spadne dřív, než plán napíše první komponentu, a leží v `apps/web/test/p06/`, tedy uvnitř starého vzoru: kontrola se spustí i tehdy, když se nespustí nic jiného.

### 2.4 Požadavky na jiné plány

Předpoklady výš se **ověřují**. Tahle tabulka je jiná: jsou v ní věci, které v cizím plánu **dnes nejsou** a P06 je potřebuje. Bez formálního zápisu by je nikdo nepřevzal. Každý řádek je zároveň v evidenci `NALEZY-NAPRIC-PLANY.md`: P06→P01.1 jako nález N55, P06→P05.1 jako N58.

| # | Adresát | Požadavek | Proč |
|---|---|---|---|
| P06→P01.1 | P01 | `apps/web/vitest.config.ts` a `apps/web/vitest.setup.ts` v přesném znění níž. | Bez toho se 44 ze 46 testovacích souborů P06 nespustí a kompletní série to nepozná. Ověřeno spuštěním, ne přečtením. Společný požadavek s P05 (jeho 8.2) a P12. |
| P06→P04.1 | P04 | `GET /api/v1/auth/me` musí vracet i `csrf_token`. Dnes vrací jen `{ user, memberships }`. | 3.2 části 1 zavádí double submit token pro formuláře a Server Actions a hodnotu odvozuje z `sessions.csrf_secret`, ke kterému má přístup jen backend. P04 funkci `csrfTokenFor(csrfSecret)` má, ale **nikde ji klientovi nevydává**, takže Server Action nemá token odkud vzít a sekundární obrana existuje jen na papíře. Doplnění pole do existující odpovědi není breaking change podle 4.6. |
| P06→P04.2 | P04 | Potvrdit, že `params` chyby `forbidden` nese `requiredPermission`, `currentRole`, `grantedByRoles[]` a `contactableMembers[]`. | Stav S11 bez nich umí říct jen „nemáte oprávnění". Odpovídá požadavku U→1.1 části 6. **P04 to už dodal** (úkoly 12 a 32), požadavek je zapsaný, aby se při další úpravě neztratil. |
| P06→P05.1 | P05 | V `JobSummary` chybí `kind`, přestože detail úlohy je na `/api/v1/jobs/{kind}/{id}`. Kdo staví `href`, musí `kind` znát. | P06 stránku detailu dodává (úkol 34) a `kind` v cestě potřebuje. Ve skořápce P05 se `href` staví ze stejných dat, takže bez `kind` by odkaz nešlo složit. Odpověď endpointu `kind` obsahuje, chybí jen v typu komponenty. |

**Přesné znění pro P06→P01.1.** Obojí ověřeno spuštěním na Vitest 4.1.10, `@vitejs/plugin-react` 6.0.5, `jsdom` 30.0.1 a `@testing-library/react` 16.3.2, tedy na verzích z tabulky 3.1.

`apps/web/vitest.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});
```

`apps/web/vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Automatický úklid Testing Library se sám zaregistruje jen při `globals: true`.
 * Bez tohohle bloku zůstane strom z předchozího testu v dokumentu a
 * `screen.getByRole` najde dva prvky. Ověřeno spuštěním: bez něj padne
 * `Found multiple elements with the role "button"`.
 */
afterEach(() => {
  cleanup();
});
```

---

## 3. Knihovny a licence

Projekt je **MIT**. Povolené licence produkčních závislostí jsou MIT, Apache-2.0, BSD a ISC. **GPL, LGPL a AGPL jsou zakázané** a hlídá to job `licenses-node`.

**P06 nepřidává jedinou produkční závislost.** Všechno, co obrazovky potřebují, už je v `packages/ui` a `packages/i18n`.

### 3.1 Co P06 používá a odkud to je

| Balíček | Verze | Licence | Kdo ho zavedl |
|---|---|---|---|
| `next` | 16.2.12 | MIT | P01 |
| `react`, `react-dom` | 19.x | MIT | P01 |
| `next-intl` | 4.13.4 | MIT | P05 |
| `zod` | 4.4.3 | MIT | P01 (validace formulářů na klientu i v Server Actions) |
| `react-hook-form` | 7.83.0 | MIT | P05 |
| `@mlain/ui`, `@mlain/i18n` | workspace | MIT | P05 |

### 3.2 Jediná nová vývojová závislost

| Balíček | Verze | Licence | K čemu |
|---|---|---|---|
| `msw` | 2.15.0 | **MIT** | odchycení HTTP v testech obálky `apiFetch` a `apiMutate` |

Ověřeno příkazem `npm view msw license version` dne **31. 7. 2026**: `license = 'MIT'`, `version = '2.15.0'`.

Ostatní vývojové závislosti (`vitest` 4.1.10 MIT, `jsdom` 30.0.1 MIT, `@testing-library/react` 16.3.2 MIT, `@testing-library/user-event` 14.6.1 MIT, `@testing-library/jest-dom` 7.0.0 MIT, `@playwright/test` 1.62.1 Apache-2.0, `axe-core` 4.12.1 MPL-2.0, `@axe-core/playwright` 4.12.1 MPL-2.0) zavádí P05 a P06 je jen používá. Všechny verze a licence ověřené `npm view` dne 31. 7. 2026, hodnoty se shodují s tabulkou v P05.

**`axe-core` a `@axe-core/playwright` jsou MPL-2.0**, což na seznamu povolených licencí není. Jsou to vývojové závislosti, které se s produktem nedistribuují, a musí být v `licenses.allow.json` s vyplněným `expires_at` (předpoklad E5 plánu P05, zajišťuje ho P01). P06 tenhle soubor nemění.

**`msw` proč vůbec.** Obálka `apiFetch` musí posílat správné hlavičky (`Cookie`, `Accept-Language`, `X-Workspace-Id`, `Origin`, `X-CSRF-Token`, `Idempotency-Key`) a správně mapovat `application/problem+json`. To se dá ověřit jedině tak, že se odchytí skutečný požadavek. `vi.mock` nad `globalThis.fetch` by testoval mock, ne chování. U testů obrazovek se naopak `msw` nepoužívá: tam se mockuje modul `apiFetch`, protože obrazovka o HTTP nic vědět nemá.

---

## 4. Mapa souborů

```
apps/web/src/
├── lib/
│   ├── api-client/                    tenká obálka nad /api/v1, nikdy nevyhazuje výjimku
│   │   ├── problem.ts                 typ Problem podle 4.8, isProblem
│   │   ├── problem.test.ts
│   │   ├── result.ts                  Result<T>, ok, err, unwrapOr
│   │   ├── result.test.ts
│   │   ├── fetch.ts                   serverové čtení, Cookie, Accept-Language, X-Workspace-Id
│   │   ├── fetch.test.ts
│   │   ├── mutate.ts                  zápisy pro Server Actions, Origin, CSRF, Idempotency-Key
│   │   ├── mutate.test.ts
│   │   ├── cursor.ts                  kurzor v URL, neplatný kurzor, žádná čísla stránek
│   │   ├── cursor.test.ts
│   │   └── types.ts                   tvary odpovědí endpointů, které P06 volá
│   ├── errors/
│   │   ├── error-keys.ts              statická mapa code na překladové klíče
│   │   ├── error-keys.test.ts
│   │   ├── problem-block.tsx          stav S9: text, request_id, sbalené technické detaily
│   │   ├── problem-block.test.tsx
│   │   ├── field-errors.ts            errors[] z validation_failed na pole formuláře
│   │   └── field-errors.test.ts
│   ├── identity/
│   │   ├── current-user.ts            GET /auth/me, cache na požadavek
│   │   ├── require-user.ts            redirect na /login?next=
│   │   ├── require-user.test.ts
│   │   ├── workspace-access.ts        slug na id, role, oprávnění aktéra
│   │   ├── workspace-access.test.ts
│   │   ├── permissions.ts             matice 3.4 jako data pro klient, bez importu z core
│   │   └── permissions.test.ts
│   └── feedback/
│       ├── action-result.ts           jednotný výsledek Server Action pro kanál zpětné vazby
│       └── action-result.test.ts
├── features/
│   ├── auth/                          formuláře přihlášení a první spuštění
│   ├── profile/                       profil, změna hesla, relace
│   ├── workspace-settings/            obecné nastavení projektu, oslovení, smazání
│   ├── members/                       členové, role, pozvánky
│   ├── api-keys/                      klíče, sekret jednou, rotace, revokace
│   ├── webhooks/                      endpointy, log doručení, test, znovuaktivace
│   ├── audit/                         audit log s filtry
│   └── settings/
│       ├── settings-nav.tsx           sub-navigace složená z registru P05
│       ├── settings-nav.test.tsx
│       └── settings-page-shell.tsx    nadpis, popis, primární akce, pruh jen pro čtení
└── app/[locale]/
    ├── (auth)/                        obrazovky mimo skořápku aplikace
    │   ├── layout.tsx
    │   ├── setup/page.tsx
    │   ├── login/page.tsx
    │   ├── forgot-password/page.tsx
    │   ├── reset-password/page.tsx
    │   └── invitations/accept/page.tsx
    ├── (account)/                     přihlášený uživatel mimo projekt
    │   ├── layout.tsx
    │   ├── no-workspace/page.tsx
    │   └── settings/profile/page.tsx
    └── w/[workspaceSlug]/settings/
        ├── layout.tsx                 sub-navigace, filtr oprávněním
        ├── page.tsx                   přesměrování na general
        ├── general/page.tsx
        ├── members/page.tsx
        ├── api-keys/page.tsx
        ├── webhooks/page.tsx
        ├── webhooks/[endpointId]/page.tsx
        └── audit/page.tsx

packages/i18n/messages/
├── cs/auth.json      +  en/auth.json
└── cs/settings.json  +  en/settings.json

apps/web/e2e/settings/                 Playwright: průchody a axe
apps/web/test/                         preflight a integrační testy obálky
```

Každý soubor má jednu odpovědnost. Kdyby některý přerostl zhruba 400 řádků, je to signál, že v něm bydlí dvě věci.

---

## 5. Konvence, které platí v celém plánu

| Věc | Pravidlo |
|---|---|
| Soubory | `kebab-case.ts`, React komponenta `PascalCase` uvnitř souboru s `kebab-case.tsx` názvem |
| Importy z `@mlain/ui` | vždy podcesta: `import { Button } from '@mlain/ui/components/button'`. Barrel se nepoužívá, uzávěr S11 to zakazuje |
| Importy uvnitř `apps/web` | alias `@/`, tedy `import { apiFetch } from '@/lib/api-client/fetch'` |
| Barvy | jen tokeny z `@mlain/ui`. `bg-blue-500` v komponentě je chyba |
| Texty | žádný literál viditelný uživateli v `.tsx`. Vždy `useTranslations('auth')` nebo `useTranslations('settings')` |
| Klíče překladů | vždy literál. Skládání klíče za běhu je zakázané (kritérium 71 části 6), mapa kódu na klíč je v `error-keys.ts` |
| Vykání | celé rozhraní vyká. Nastavení `address_form` projektu se týká **e-mailů odesílaných kontaktům**, ne rozhraní |
| Dlouhá pomlčka | znak U+2014 se nesmí objevit v katalogu ani v kódu. Hlídá to test v úkolu 10 |
| Server versus klient | data se čtou v Server Component, zápis dělá Server Action. `'use client'` jen tam, kde je potřeba stav nebo posluchač události |
| Oprávnění | vyhodnocují se na serveru, do klienta jde `readonly string[]`. `@mlain/core` se do klientské komponenty nikdy neimportuje |
| Testy během práce | jen na změněných a nových souborech |
| Testy na konci | kompletní série v úkolu 37, všechno musí projít |

**Příkazy, které se opakují:**

```bash
# jednotkové testy a testy komponent, jeden soubor
pnpm --filter @mlain/web exec vitest run src/lib/api-client/fetch.test.ts

# celý balíček
pnpm --filter @mlain/web test:unit

# typová kontrola
pnpm --filter @mlain/web typecheck

# testy v prohlížeči, jeden soubor
pnpm --filter @mlain/web exec playwright test e2e/settings/api-keys.spec.ts

# kontrola katalogů
pnpm ci:i18n-check
```

---

## 6. Katalog stavů, který musí splnit každá obrazovka P06

Matice 7.2 části 6 dává řádek **Nastavení** a řádek **Tabulka**. Obrazovky P06 obsahují oboje, takže platí obojí: rám obrazovky se řídí řádkem Nastavení, seznam uvnitř řádkem Tabulka.

| Stav | Kde v P06 | Jak se pozná v testu |
|---|---|---|
| S1 prázdný poprvé | členové, klíče, webhooky, audit, relace, pozvánky | prázdná odpověď `data: []` bez filtru a bez `?emptied=1` |
| S2 prázdný po filtrování | audit, log doručení | prázdná odpověď s aspoň jedním filtrem v URL |
| S3 prázdný po vyprázdnění | webhooky | prázdná odpověď s `?emptied=1` |
| S4 načítání první | všechny | `loading.tsx` segmentu, skeleton ve tvaru budoucího obsahu |
| S6 obnovování na pozadí | všechny se `router.refresh()` | nenápadný indikátor, stará data zůstávají |
| S7 zastaralá data | audit, log doručení | selhaná obnova, data zůstanou ztlumená plus „Zkusit znovu" |
| S8 částečná data | nastavení projektu (formulář načten, počet členů ne) | jeden zdroj vrátí `Problem`, zbytek data |
| S9 chyba načtení | všechny | `Problem` se statusem 5xx nebo síťová chyba |
| S10 offline | všechny | `navigator.onLine === false` |
| S11 bez oprávnění | všechny sekce nastavení | `Problem` s `code: 'forbidden'` nebo chybějící oprávnění v roli |
| S12 jen pro čtení | nastavení projektu pro roli bez `workspace:update` | role bez zapisovacího oprávnění |
| S15 přes limit | webhooky (20 endpointů), pozvánky (100 čekajících) | počet položek dosáhl limitu |

**Povinné stavy každého seznamu** podle 5.3 části 1, doslova: načítání jako skeleton (ne spinner), prázdný stav s vysvětlením a primární akcí, chyba s tlačítkem „Zkusit znovu" a s `request_id` k okopírování, stav bez oprávnění. Test v úkolu 36 to prochází mechanicky pro všech sedm seznamů.

---

## 7. Úkoly

### Úkol 1: Preflight, ověření předpokladů spuštěním

**Soubory:**
- Create: `apps/web/test/p06/test-runner.test.ts`
- Create: `apps/web/test/p06/ui-contract.ts`
- Create: `apps/web/test/p06/ui-imports.test.ts`
- Create: `apps/web/test/p06/preflight.test.ts`

Tenhle úkol nic nestaví. Ověřuje, že P01, P04 a P05 dodaly, s čím P06 počítá. Bez něj by se chyba v předpokladu projevila až u dvacátého úkolu a opravovala by se na dvaceti místech.

**Pořadí kroků není libovolné.** První se ověřuje testovací běh, teprve pak všechno ostatní. Kdyby se to obrátilo, běžely by kontroly v prostředí, o kterém nevíme, jestli vůbec spouští testy, a jejich zelená barva by nic neznamenala.

- [ ] **Krok 1: Napiš kontrolu, že se testy P06 vůbec spouštějí**

`apps/web/test/p06/test-runner.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config';

// Nejtišší způsob, jak tenhle plán selhat, je proběhnout se zelenými kroky,
// ve kterých se nespustil ani jeden test.
//
// Soubor apps/web/vitest.config.ts vlastní P01 a jeho původní znění mělo
// prostředí node a vzor pokrývající jen adresář test. Testy komponent P06 leží
// vedle zdrojů v adresáři src, tedy mimo ten vzor. Vitest je nenajde,
// kompletní série vypíše „1 passed" a skončí kódem 0. Ověřeno spuštěním.
//
// Tenhle soubor leží v adresáři test, tedy uvnitř STARÉHO vzoru schválně:
// spustí se i tehdy, když se nespustí nic jiného, a je to jediné místo,
// kde se dá tichý úspěch zachytit zevnitř.
//
// Když spadne, NEOPRAVUJ to tady. Konfigurace patří P01 a požadavek na ni
// je P06→P01.1 v kapitole 2.4.
const WEB_ROOT = path.resolve(import.meta.dirname, '../..');

function testFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...testFilesUnder(full));
    } else if (/\.test\.tsx?$/.test(entry)) {
      out.push(path.relative(WEB_ROOT, full));
    }
  }
  return out;
}

const include = (config as { test?: { include?: string[] } }).test?.include ?? [];
const environment = (config as { test?: { environment?: string } }).test?.environment;
const setupFiles = (config as { test?: { setupFiles?: string[] } }).test?.setupFiles ?? [];
const plugins = (config as { plugins?: unknown[] }).plugins ?? [];

describe('testovací běh apps/web pokrývá testy P06', () => {
  it('každý testovací soubor pod src/ padne do některého vzoru include', () => {
    const isMatch = picomatch(include);
    const missed = testFilesUnder(path.join(WEB_ROOT, 'src')).filter((file) => !isMatch(file));
    expect(missed, `mimo vzor include (${include.join(', ')})`).toEqual([]);
  });

  it('prostředí je jsdom, jinak render() nemá kam vykreslit', () => {
    expect(environment).toBe('jsdom');
  });

  it('je zapojený plugin React, jinak se .tsx nepřeloží', () => {
    expect(plugins.length).toBeGreaterThan(0);
  });

  it('setupFiles registruje úklid mezi testy', () => {
    expect(setupFiles.length).toBeGreaterThan(0);
    const setup = setupFiles
      .map((file) => readFileSync(path.resolve(WEB_ROOT, file), 'utf8'))
      .join('\n');
    // Bez úklidu zůstane strom z předchozího testu v dokumentu a
    // screen.getByRole najde dva prvky. Ověřeno spuštěním.
    expect(setup).toMatch(/cleanup/);
  });
});
```

- [ ] **Krok 2: Spusť kontrolu testovacího běhu**

Run: `pnpm --filter @mlain/web exec vitest run test/p06/test-runner.test.ts`
Expected: PASS, `Tests  4 passed (4)`.

Když kterýkoli test spadne, **zastav plán**. Konfigurace patří P01 a přesné znění, které má dodat, je v kapitole 2.4. Do té doby by každý další krok „spusť test, musí projít" hlásil úspěch, který se nestal.

Balíček `picomatch` je tranzitivní závislost Vitestu (MIT). Kdyby v `node_modules` nebyl dosažitelný, doplní se do `devDependencies` `apps/web` stejnou úzkou výjimkou jako `msw`.

- [ ] **Krok 3: Napiš typový kontrakt na exporty z `@mlain/ui`**

`apps/web/test/p06/ui-contract.ts` (soubor se nespouští, jen se typuje):

```ts
// Typový kontrakt P06 vůči P05. Když se tenhle soubor nepodaří přeložit,
// packages/ui nedodal, s čím obrazovky P06 počítají. Neopravuj to tady,
// doplň chybějící komponentu do plánu P05.
//
// Importuje se NA ÚROVEŇ ADRESÁŘE. Mapa exports v packages/ui má vzor
// ./patterns/<jméno> mířící na ./src/patterns/<jméno>/index.ts, takže
// patterns/feedback/confirm-dialog by se hledal jako adresář a neexistuje.
// Kořenový import @mlain/ui neexistuje vůbec: P05 klíč "." odstranil.
//
// V kontraktu je JEN to, co P06 někde v JSX skutečně vykresluje. Jméno, které
// se nikde nevykresluje, je tvrzení, které nemá čím podložit, a přesně kvůli
// takovým jménům P05 pět komponent vědomě nezaložil. Primitiva jako `Dialog`
// nebo `Tabs` P06 nepoužívá, `DataTable` a `JobsCenter` taky ne, takže tady
// nejsou; kdyby je začal používat, přidají se sem zároveň s prvním použitím.
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { CopyButton } from '@mlain/ui/components/copy-button';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { RadioGroup } from '@mlain/ui/components/radio-group';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { Skeleton } from '@mlain/ui/components/skeleton';
import { Textarea } from '@mlain/ui/components/textarea';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import {
  NAVIGATION,
  visibleNavigation,
  type NavigationItem,
  type VisibleNavigationItem,
} from '@mlain/ui/patterns/navigation';
import {
  Alert,
  DetailSkeleton,
  EmptyState,
  ErrorBlock,
  FilteredEmptyState,
  ForbiddenState,
  NotFoundState,
  OverLimitState,
  ReadOnlyBanner,
  ReadOnlyValue,
  StaleBanner,
  TableSkeleton,
} from '@mlain/ui/patterns/states';
import { useToast } from '@mlain/ui/patterns/toast';
import { useDelayedFlag } from '@mlain/ui/lib/use-delayed-flag';

/**
 * Registr je strom se `children` a s příznakem `mvp0`. P06 ho jen čte
 * a filtrování nechává na `visibleNavigation`, protože pravidlo „sekce bez
 * jediné viditelné podpoložky zmizí celá" se při druhém psaní zapomíná.
 */
export type NavigationItemContract = {
  id: string;
  labelKey: string;
  path: string;
  permission?: string;
  mvp0: boolean;
  children?: NavigationItemContract[];
};

const navigationIsCompatible: NavigationItemContract[] = NAVIGATION;

/** Výstup filtrování musí nést hotové `href` se slugem projektu. */
const visibleNavigationIsCompatible: (input: {
  permissions: string[];
  workspaceSlug?: string;
}) => Array<{ id: string; href: string; children?: Array<{ id: string; href: string }> }> =
  visibleNavigation;

/**
 * Potvrzovací dialog musí umět úrovně N2 až N4 a u N4 opisování názvu.
 * Tlačítko nesmí být `disabled` (kritérium 18), výchozí fokus patří ústupu.
 * `labels` je povinný: texty do `packages/ui` natvrdo nepatří.
 */
export type ConfirmDialogContract = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  level: 'N2' | 'N3' | 'N4';
  title: string;
  consequences: string[];
  confirmLabel: string;
  cancelLabel: string;
  acknowledgement?: string;
  confirmPhrase?: string;
  confirmPhraseLabel?: string;
  onConfirmPhraseChange?: (value: string) => void;
  extraAction?: React.ReactNode;
  irreversible?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  labels: {
    irreversible: string;
    whatHappens: string;
    notYetConfirmed: string;
    notYetTyped: string;
    typeToConfirmMismatch: string;
    filterInWords: (filter: string) => string;
  };
};

const confirmDialogIsCompatible: (props: ConfirmDialogContract) => unknown = ConfirmDialog;

export const contract = {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  CopyButton,
  DetailSkeleton,
  EmptyState,
  ErrorBlock,
  FilteredEmptyState,
  ForbiddenState,
  Input,
  Label,
  NotFoundState,
  OverLimitState,
  RadioGroup,
  ReadOnlyBanner,
  ReadOnlyValue,
  Select,
  SelectItem,
  Skeleton,
  StaleBanner,
  TableSkeleton,
  Textarea,
  confirmDialogIsCompatible,
  navigationIsCompatible,
  visibleNavigationIsCompatible,
  useDelayedFlag,
  useToast,
} as const;

export type { NavigationItem, VisibleNavigationItem };
```

- [ ] **Krok 4: Spusť typovou kontrolu a ověř, že projde**

Run: `pnpm --filter @mlain/web typecheck`
Expected: PASS. Když padne na chybějícím exportu, **zastav plán** a doplň chybějící komponentu do P05.

- [ ] **Krok 5: Napiš kontrolu, že se nikde neimportuje z kořene ani z podsouboru**

`apps/web/test/p06/ui-imports.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_SRC = path.resolve(import.meta.dirname, '../../src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Povolené tvary podle mapy `exports` v `packages/ui/package.json`. */
const ALLOWED = [
  /^@mlain\/ui\/components\/[a-z0-9-]+$/,
  /^@mlain\/ui\/patterns\/[a-z0-9-]+$/,
  /^@mlain\/ui\/lib\/[a-z0-9-]+$/,
  /^@mlain\/ui\/(theme|a11y|tokens\.css|globals\.css)$/,
];

describe('importy z @mlain/ui', () => {
  it('žádný import nemíří na kořen balíčku ani hlouběji než na adresář vzoru', () => {
    const bad: string[] = [];
    for (const file of sourceFiles(WEB_SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/from '(@mlain\/ui[^']*)'/g)) {
        const specifier = match[1]!;
        if (!ALLOWED.some((pattern) => pattern.test(specifier))) {
          bad.push(`${path.relative(WEB_SRC, file)}: ${specifier}`);
        }
      }
    }
    // Kořenový import skončí ERR_PACKAGE_PATH_NOT_EXPORTED, import na úroveň
    // souboru se hledá jako adresář s index.ts a neexistuje. Obojí je chyba
    // sestavení, ale až v okamžiku, kdy se soubor poprvé načte.
    expect(bad).toEqual([]);
  });
});
```

- [ ] **Krok 6: Spusť kontrolu importů**

Run: `pnpm --filter @mlain/web exec vitest run test/p06/ui-imports.test.ts`
Expected: PASS, `Tests  1 passed (1)`. Na prázdném stromu `src/` projde triviálně a rozsvítí se v okamžiku, kdy někdo přidá špatný import.

- [ ] **Krok 7: Napiš preflight test proti reálnému API**

`apps/web/test/p06/preflight.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '@/lib/api/app';
import { ERROR_CODES } from '@mlain/core/errors';

const ORIGIN = process.env.APP_URL ?? 'http://localhost:3000';

const SETUP = {
  email: 'p06-preflight@example.com',
  password: 'preflight heslo dlouhe dost',
  name: 'Preflight',
  workspace_name: 'Preflight Projekt',
  locale: 'cs',
};

type Json = Record<string, unknown>;

let cookie = '';
let csrfToken = '';
let workspaceId = '';

async function body(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    origin: ORIGIN,
    cookie,
    'x-csrf-token': csrfToken,
    'x-workspace-id': workspaceId,
    ...extra,
  };
}

beforeAll(async () => {
  const setup = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(SETUP),
  });
  expect([201, 409]).toContain(setup.status);

  const login = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email: SETUP.email, password: SETUP.password }),
  });
  expect(login.status).toBe(200);
  const setCookie = login.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();
  cookie = setCookie!.split(';')[0]!;

  const me = await app.request('/api/v1/auth/me', { headers: { cookie } });
  const mine = await body(me);
  csrfToken = String(mine.csrf_token ?? '');
  const memberships = mine.memberships as Array<Json>;
  workspaceId = String(memberships[0]!.workspace_id);
});

describe('P06 preflight vůči P04', () => {
  it('E1: /auth/me vrací uživatele, členství se slugem a csrf_token', async () => {
    const response = await app.request('/api/v1/auth/me', { headers: { cookie } });
    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload.user).toMatchObject({
      id: expect.any(String),
      email: expect.any(String),
      name: expect.any(String),
      locale: expect.any(String),
      timezone: expect.any(String),
    });
    // Požadavek P06→P04.1. Dnes schéma odpovědi P04 tohle pole nemá, takže
    // tenhle řádek je červený schválně: bez tokenu nemá Server Action co
    // poslat v hlavičce X-CSRF-Token a sekundární obrana z 3.2 části 1
    // by existovala jen na papíře. Neopravuj to tady, patří to P04.
    expect(payload.csrf_token).toEqual(expect.any(String));
    const memberships = payload.memberships as Array<Json>;
    // MembershipSchema v P04 zní { workspace_id, name, slug, role }.
    expect(memberships[0]).toMatchObject({
      workspace_id: expect.any(String),
      name: expect.any(String),
      slug: expect.any(String),
      role: expect.any(String),
    });
  });

  it('E2: /workspaces vrací slug, locale, timezone a address_form', async () => {
    const response = await app.request('/api/v1/workspaces', { headers: { cookie } });
    const payload = await body(response);
    const rows = payload.data as Array<Json>;
    expect(rows[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      slug: expect.any(String),
      locale: expect.any(String),
      timezone: expect.any(String),
      address_form: expect.stringMatching(/^(formal|informal)$/),
    });
  });

  it('E3: /auth/sessions vrací příznak current', async () => {
    const response = await app.request('/api/v1/auth/sessions', { headers: { cookie } });
    const payload = await body(response);
    const rows = payload.data as Array<Json>;
    expect(rows.some((row) => row.current === true)).toBe(true);
  });

  it('E4 a E5: detail webhooku a endpointy na počty existují', async () => {
    const detail = await app.request('/api/v1/webhook-endpoints/00000000-0000-7000-8000-000000000000', {
      headers: authHeaders(),
    });
    // 405 by znamenalo, že cesta existuje, ale GET na ní není. 404 je v pořádku:
    // endpoint existuje a jen ten konkrétní webhook ne.
    expect(detail.status).not.toBe(405);
    expect([200, 404]).toContain(detail.status);

    const auditCount = await app.request('/api/v1/audit-log/count', { headers: authHeaders() });
    expect(auditCount.status).toBe(200);
    expect(await body(auditCount)).toMatchObject({ count: expect.any(Number) });

    const deliveryCount = await app.request('/api/v1/webhook-deliveries/count', { headers: authHeaders() });
    expect(deliveryCount.status).toBe(200);
  });

  it('E6: vytvoření klíče vrátí sekret a výpis už ne', async () => {
    const created = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: authHeaders({ 'idempotency-key': 'preflight-key-0001' }),
      body: JSON.stringify({ name: 'Preflight', scopes: ['contacts:read'] }),
    });
    expect(created.status).toBe(201);
    const key = await body(created);
    expect(String(key.secret)).toMatch(/^ml_live_[a-z2-7]{8}_[A-Za-z0-9_-]{43}$/);

    const list = await app.request('/api/v1/api-keys', { headers: authHeaders() });
    expect(JSON.stringify(await body(list))).not.toContain(String(key.secret));
  });

  it('E10: smazání projektu vyžaduje confirm_name', async () => {
    const response = await app.request(`/api/v1/workspaces/${workspaceId}`, {
      method: 'DELETE',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(422);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
  });

  it('E11: neplatný kurzor vrací validation_failed s path cursor', async () => {
    const response = await app.request('/api/v1/audit-log?cursor=nonsense', { headers: authHeaders() });
    expect(response.status).toBe(422);
    const problem = await body(response);
    expect(problem.code).toBe('validation_failed');
    const errors = problem.errors as Array<Json>;
    expect(errors.some((entry) => entry.path === 'cursor')).toBe(true);
  });

  it('E12: endpointy Centra úloh existují a detail nese druh v cestě', async () => {
    const list = await app.request('/api/v1/jobs?limit=20', { headers: authHeaders() });
    expect(list.status).toBe(200);
    const payload = await body(list);
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.running_count).toEqual(expect.any(Number));

    // Registr zdrojů je po vlně 0 prázdný, takže se čeká 404, ne 405 ani 500.
    // 405 by znamenalo, že cesta má jiný tvar, než na jaký P06 staví odkaz.
    const detail = await app.request('/api/v1/jobs/import/00000000-0000-7000-8000-000000000000', {
      headers: authHeaders(),
    });
    expect(detail.status).not.toBe(405);
    expect([200, 404]).toContain(detail.status);
  });

  it('E8: chyba forbidden nese, kdo oprávnění udělit může', async () => {
    // Vlastník má všechno, takže se 403 vyvolá cizím projektem: členství chybí.
    const foreign = '00000000-0000-7000-8000-0000000000ff';
    const response = await app.request('/api/v1/audit-log', {
      headers: authHeaders({ 'x-workspace-id': foreign }),
    });
    expect([403, 404]).toContain(response.status);
    if (response.status !== 403) return;
    const problem = await body(response);
    const params = (problem.params ?? {}) as Json;
    expect(params).toMatchObject({
      requiredPermission: expect.any(String),
      currentRole: expect.anything(),
    });
    expect(Array.isArray(params.grantedByRoles)).toBe(true);
    expect(Array.isArray(params.contactableMembers)).toBe(true);
  });

  it('registr chybových kódů zná všechny kódy, které P06 zobrazuje', () => {
    const used = [
      'unauthenticated',
      'invalid_credentials',
      'session_expired',
      'forbidden',
      'insufficient_scope',
      'origin_not_allowed',
      'csrf_token_invalid',
      'not_found',
      'conflict',
      'already_exists',
      'idempotency_key_reuse',
      'idempotency_request_in_progress',
      'last_owner_cannot_be_removed',
      'setup_already_completed',
      'validation_failed',
      'account_locked',
      'rate_limited',
      'internal_error',
      'service_unavailable',
      'dependency_timeout',
    ];
    for (const code of used) {
      expect(ERROR_CODES, `chybí kód ${code}`).toHaveProperty(code);
    }
  });
});
```

- [ ] **Krok 8: Spusť preflight**

Run: `pnpm --filter @mlain/web test:db -- test/p06/preflight.test.ts`
Expected: PASS, všech deset testů zelených. Každý červený test je chybějící předpoklad, který se doplňuje do plánu vlastníka, ne tady.

**Jeden červený test se čeká.** `E1` na `csrf_token` spadne, dokud P04 nesplní požadavek P06→P04.1 z kapitoly 2.4. Je to jediné povolené červené místo v celém plánu a je vypsané schválně: kdyby se assert vynechal, chyběl by zápisům token, obrana by tiše nefungovala a nikdo by se to nedozvěděl. **Dokud je červený, P06 nepokračuje.**

- [ ] **Krok 9: Commit**

```bash
git add apps/web/test/p06
git commit -m "test(web): p06 preflight against p01 test runner, p04 api and p05 ui contract"
```

---

### Úkol 2: Typ `Problem` a `Result`

**Soubory:**
- Create: `apps/web/src/lib/api-client/problem.ts`
- Create: `apps/web/src/lib/api-client/problem.test.ts`
- Create: `apps/web/src/lib/api-client/result.ts`
- Create: `apps/web/src/lib/api-client/result.test.ts`

- [ ] **Krok 1: Napiš padající test na `isProblem` a `localProblem`**

`apps/web/src/lib/api-client/problem.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest';
import { isProblem, localProblem, type Problem } from './problem';

const VALID: Problem = {
  type: 'https://docs.mlain.dev/errors/forbidden',
  title: 'Forbidden',
  status: 403,
  detail: 'Nemáte oprávnění.',
  instance: '/api/v1/api-keys',
  code: 'forbidden',
  request_id: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
};

describe('isProblem', () => {
  it('přijme obálku se všemi povinnými poli', () => {
    expect(isProblem(VALID)).toBe(true);
  });

  it('odmítne objekt bez code', () => {
    const { code: _unused, ...withoutCode } = VALID;
    expect(isProblem(withoutCode)).toBe(false);
  });

  it('odmítne objekt bez request_id', () => {
    const { request_id: _unused, ...withoutRequestId } = VALID;
    expect(isProblem(withoutRequestId)).toBe(false);
  });

  it('odmítne null, pole i řetězec', () => {
    expect(isProblem(null)).toBe(false);
    expect(isProblem([VALID])).toBe(false);
    expect(isProblem('forbidden')).toBe(false);
  });

  it('nese rozšiřující členy findings a params', () => {
    const rich: Problem = {
      ...VALID,
      params: { requiredPermission: 'api_keys:read', currentRole: 'viewer' },
      findings: [{ code: 'domain_dmarc_missing', severity: 'warning', message: 'Chybí DMARC.' }],
    };
    expect(isProblem(rich)).toBe(true);
    expect(rich.findings?.[0]?.severity).toBe('warning');
  });
});

describe('typ Problem odpovídá tvaru z 4.8 části 1', () => {
  it('má všechna pole včetně findings a params', () => {
    expectTypeOf<Problem>().toHaveProperty('type').toEqualTypeOf<string>();
    expectTypeOf<Problem>().toHaveProperty('title').toEqualTypeOf<string>();
    expectTypeOf<Problem>().toHaveProperty('status').toEqualTypeOf<number>();
    expectTypeOf<Problem>().toHaveProperty('detail').toEqualTypeOf<string>();
    expectTypeOf<Problem>().toHaveProperty('instance').toEqualTypeOf<string>();
    expectTypeOf<Problem>().toHaveProperty('code').toEqualTypeOf<string>();
    expectTypeOf<Problem>().toHaveProperty('request_id').toEqualTypeOf<string>();
    expectTypeOf<Problem>().toHaveProperty('errors');
    expectTypeOf<Problem>().toHaveProperty('findings');
    expectTypeOf<Problem>().toHaveProperty('params');
    expectTypeOf<Problem>().toHaveProperty('retry_after');
  });
});

describe('localProblem', () => {
  it('u nedostupné služby použije registrovaný kód a prázdné request_id', () => {
    const problem = localProblem({ code: 'service_unavailable', instance: '/api/v1/members' });
    expect(problem.code).toBe('service_unavailable');
    expect(problem.status).toBe(503);
    expect(problem.request_id).toBe('');
    expect(problem.instance).toBe('/api/v1/members');
    expect(problem.type).toBe('https://docs.mlain.dev/errors/service_unavailable');
  });

  it('u vypršeného času použije dependency_timeout', () => {
    expect(localProblem({ code: 'dependency_timeout', instance: '/x' }).status).toBe(504);
  });

  it('nikdy nevymyslí request_id', () => {
    for (const code of ['service_unavailable', 'dependency_timeout', 'internal_error'] as const) {
      expect(localProblem({ code, instance: '/x' }).request_id).toBe('');
    }
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/api-client/problem.test.ts`
Expected: FAIL, `Failed to resolve import "./problem"`.

- [ ] **Krok 3: Napiš `problem.ts`**

`apps/web/src/lib/api-client/problem.ts`:

```ts
/**
 * Typ chybové obálky podle RFC 9457, ve tvaru, který popisuje kapitola 4.8
 * části 1. Definuje ho P06, protože `packages/sdk-node` zatím nemá vlastníka
 * a `apps/web/src/lib/api/problem.ts` (P04) obálku staví, ne čte. Viz R4.
 */

export type Severity = 'error' | 'warning';

export type Finding = {
  code: string;
  severity: Severity;
  message: string;
  path?: string;
  params?: Record<string, unknown>;
};

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  request_id: string;
  /** Jen u validation_failed, porušení schématu. Tvar je zmrazený. */
  errors?: Array<{ path: string; code: string; message: string }>;
  /** Doménové kontroly s víc nálezy naráz, viz 4.2 části 1. */
  findings?: Finding[];
  /** Strojově čitelné parametry chyby, viz 4.2 části 1. */
  params?: Record<string, unknown>;
  /** Sekundy. Smí ho nést každý kód s příznakem opakovatelnosti. */
  retry_after?: number;
};

const REQUIRED_STRING_FIELDS = ['type', 'title', 'detail', 'instance', 'code', 'request_id'] as const;

export function isProblem(value: unknown): value is Problem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.status !== 'number') return false;
  return REQUIRED_STRING_FIELDS.every((field) => typeof candidate[field] === 'string');
}

/**
 * Kódy, které smí vzniknout na straně rozhraní, když se požadavek na vlastní
 * API vůbec neuskutečnil. Všechny tři jsou v registru P01, takže se nezavádí
 * nový kód a `request_id` se nikdy nevymýšlí. Viz R5.
 */
export type LocalProblemCode = 'service_unavailable' | 'dependency_timeout' | 'internal_error';

const LOCAL_PROBLEM_META: Record<LocalProblemCode, { status: number; title: string }> = {
  service_unavailable: { status: 503, title: 'Service unavailable' },
  dependency_timeout: { status: 504, title: 'Dependency timeout' },
  internal_error: { status: 500, title: 'Internal server error' },
};

export function localProblem(input: { code: LocalProblemCode; instance: string }): Problem {
  const meta = LOCAL_PROBLEM_META[input.code];
  return {
    type: `https://docs.mlain.dev/errors/${input.code}`,
    title: meta.title,
    status: meta.status,
    detail: '',
    instance: input.instance,
    code: input.code,
    request_id: '',
  };
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/api-client/problem.test.ts`
Expected: PASS, `Tests  9 passed (9)`.

- [ ] **Krok 5: Napiš padající test na `Result`**

`apps/web/src/lib/api-client/result.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { localProblem } from './problem';
import { err, isOk, ok, unwrapOr, type Result } from './result';

const PROBLEM = localProblem({ code: 'service_unavailable', instance: '/api/v1/members' });

describe('Result', () => {
  it('ok nese data', () => {
    const result = ok({ count: 3 });
    expect(result.ok).toBe(true);
    expect(isOk(result)).toBe(true);
    if (result.ok) expect(result.data.count).toBe(3);
  });

  it('err nese Problem', () => {
    const result: Result<number> = err(PROBLEM);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.code).toBe('service_unavailable');
  });

  it('unwrapOr vrátí data nebo náhradu', () => {
    expect(unwrapOr(ok(7), 0)).toBe(7);
    expect(unwrapOr(err(PROBLEM) as Result<number>, 0)).toBe(0);
  });

  it('zúžení typu funguje bez přetypování', () => {
    const result: Result<{ id: string }> = ok({ id: 'a' });
    if (isOk(result)) {
      const id: string = result.data.id;
      expect(id).toBe('a');
    }
  });
});
```

- [ ] **Krok 6: Napiš `result.ts` a spusť oba testy**

`apps/web/src/lib/api-client/result.ts`:

```ts
import type { Problem } from './problem';

export type Ok<T> = { readonly ok: true; readonly data: T };
export type Err = { readonly ok: false; readonly problem: Problem };
export type Result<T> = Ok<T> | Err;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function err(problem: Problem): Err {
  return { ok: false, problem };
}

export function isOk<T>(result: Result<T>): result is Ok<T> {
  return result.ok;
}

export function unwrapOr<T>(result: Result<T>, fallback: T): T {
  return result.ok ? result.data : fallback;
}
```

Run: `pnpm --filter @mlain/web exec vitest run src/lib/api-client/`
Expected: PASS, `Tests  13 passed (13)`.

- [ ] **Krok 7: Commit**

```bash
git add apps/web/src/lib/api-client
git commit -m "feat(web): problem and result types for the api client"
```

---

### Úkol 3: Serverová obálka `apiFetch`

**Soubory:**
- Create: `apps/web/src/lib/api-client/base-url.ts`
- Create: `apps/web/src/lib/api-client/fetch.ts`
- Create: `apps/web/src/lib/api-client/fetch.test.ts`
- Modify: `apps/web/package.json` (jen `devDependencies`, viz 0.3)

- [ ] **Krok 1: Přidej `msw` jako vývojovou závislost**

```bash
pnpm --filter @mlain/web add -D msw@2.15.0
```

Expected: `devDependencies` v `apps/web/package.json` obsahuje `"msw": "2.15.0"`. Nic jiného se v manifestu nemění.

- [ ] **Krok 2: Napiš padající test obálky**

`apps/web/src/lib/api-client/fetch.test.ts`:

```ts
import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./base-url', () => ({ getApiBaseUrl: () => 'http://api.test' }));

const cookieStore = { get: vi.fn() };
const requestHeaders = { get: vi.fn() };

vi.mock('next/headers', () => ({
  cookies: async () => cookieStore,
  headers: async () => requestHeaders,
}));

const { apiFetch, buildUrl } = await import('./fetch');

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  cookieStore.get.mockReset();
  requestHeaders.get.mockReset();
});
afterAll(() => server.close());

describe('buildUrl', () => {
  it('poskládá absolutní adresu a vynechá nedefinované parametry', () => {
    expect(buildUrl('/api/v1/members', { limit: 50, cursor: undefined, role: 'admin' })).toBe(
      'http://api.test/api/v1/members?limit=50&role=admin',
    );
  });

  it('bez parametrů nepřidá otazník', () => {
    expect(buildUrl('/api/v1/members', {})).toBe('http://api.test/api/v1/members');
  });
});

describe('apiFetch', () => {
  it('vrátí data u 200', async () => {
    server.use(http.get('http://api.test/api/v1/members', () => HttpResponse.json({ data: [{ id: 'a' }] })));
    const result = await apiFetch<{ data: Array<{ id: string }> }>('/api/v1/members');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.data[0]!.id).toBe('a');
  });

  it('vrátí undefined u 204', async () => {
    server.use(http.get('http://api.test/api/v1/x', () => new HttpResponse(null, { status: 204 })));
    const result = await apiFetch<void>('/api/v1/x');
    expect(result.ok).toBe(true);
  });

  it('přeposílá session cookie, Accept-Language a X-Workspace-Id', async () => {
    cookieStore.get.mockReturnValue({ name: 'ml_session', value: 'abc123' });
    requestHeaders.get.mockImplementation((name: string) => (name === 'accept-language' ? 'cs-CZ,cs;q=0.9' : null));
    let seen: Headers | undefined;
    server.use(
      http.get('http://api.test/api/v1/members', ({ request }) => {
        seen = request.headers;
        return HttpResponse.json({ data: [] });
      }),
    );

    await apiFetch('/api/v1/members', { workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071' });

    expect(seen?.get('cookie')).toBe('ml_session=abc123');
    expect(seen?.get('accept-language')).toBe('cs-CZ,cs;q=0.9');
    expect(seen?.get('x-workspace-id')).toBe('0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071');
    expect(seen?.get('accept')).toBe('application/json');
  });

  it('bez session cookie neposílá hlavičku cookie', async () => {
    cookieStore.get.mockReturnValue(undefined);
    let seen: Headers | undefined;
    server.use(
      http.get('http://api.test/api/v1/x', ({ request }) => {
        seen = request.headers;
        return HttpResponse.json({});
      }),
    );
    await apiFetch('/api/v1/x');
    expect(seen?.get('cookie')).toBeNull();
  });

  it('vrátí Problem u application/problem+json', async () => {
    server.use(
      http.get('http://api.test/api/v1/api-keys', () =>
        HttpResponse.json(
          {
            type: 'https://docs.mlain.dev/errors/forbidden',
            title: 'Forbidden',
            status: 403,
            detail: 'Nemáte oprávnění.',
            instance: '/api/v1/api-keys',
            code: 'forbidden',
            request_id: 'req_1',
            params: { requiredPermission: 'api_keys:read', currentRole: 'viewer' },
          },
          { status: 403, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const result = await apiFetch('/api/v1/api-keys');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.code).toBe('forbidden');
      expect(result.problem.request_id).toBe('req_1');
      expect(result.problem.params).toEqual({ requiredPermission: 'api_keys:read', currentRole: 'viewer' });
    }
  });

  it('u chyby bez problem+json vyrobí internal_error s prázdným request_id', async () => {
    server.use(http.get('http://api.test/api/v1/x', () => new HttpResponse('nginx', { status: 502 })));
    const result = await apiFetch('/api/v1/x');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.code).toBe('internal_error');
      expect(result.problem.request_id).toBe('');
    }
  });

  it('u nedostupné služby vrátí service_unavailable, ne výjimku', async () => {
    server.use(http.get('http://api.test/api/v1/x', () => HttpResponse.error()));
    const result = await apiFetch('/api/v1/x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.code).toBe('service_unavailable');
  });

  it('u vypršeného času vrátí dependency_timeout', async () => {
    server.use(
      http.get('http://api.test/api/v1/slow', async () => {
        await delay(200);
        return HttpResponse.json({});
      }),
    );
    const result = await apiFetch('/api/v1/slow', { timeoutMs: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.code).toBe('dependency_timeout');
  });

  it('nikdy nevyhodí výjimku, ani když tělo není JSON', async () => {
    server.use(
      http.get('http://api.test/api/v1/broken', () =>
        new HttpResponse('{', { status: 422, headers: { 'content-type': 'application/problem+json' } }),
      ),
    );
    await expect(apiFetch('/api/v1/broken')).resolves.toMatchObject({ ok: false });
  });
});
```

- [ ] **Krok 3: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/api-client/fetch.test.ts`
Expected: FAIL, `Failed to resolve import "./fetch"`.

- [ ] **Krok 4: Napiš `base-url.ts` a `fetch.ts`**

`apps/web/src/lib/api-client/base-url.ts`:

```ts
import { config } from '@mlain/core/config';

/**
 * Jediné místo, kde se bere základ adresy vlastního API. Vlastní modul proto,
 * aby ho testy mohly nahradit, aniž by musely sestavit celou konfiguraci.
 */
export function getApiBaseUrl(): string {
  return config.APP_URL.replace(/\/+$/, '');
}
```

`apps/web/src/lib/api-client/fetch.ts`:

```ts
import 'server-only';
import { cookies, headers } from 'next/headers';
import { getApiBaseUrl } from './base-url';
import { isProblem, localProblem, type LocalProblemCode } from './problem';
import { err, ok, type Result } from './result';

export const SESSION_COOKIE = 'ml_session';
const DEFAULT_TIMEOUT_MS = 10_000;

export type QueryValue = string | number | undefined;

export type ApiFetchOptions = {
  /** Posílá se jako X-Workspace-Id. Bez něj běží požadavek mimo kontext projektu. */
  workspaceId?: string;
  searchParams?: Record<string, QueryValue>;
  timeoutMs?: number;
};

export function buildUrl(path: string, searchParams: Record<string, QueryValue> = {}): string {
  const url = new URL(path, `${getApiBaseUrl()}/`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function buildRequestHeaders(workspaceId?: string): Promise<Headers> {
  const outgoing = new Headers({ accept: 'application/json' });

  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  if (session) outgoing.set('cookie', `${SESSION_COOKIE}=${session.value}`);

  const incoming = await headers();
  const acceptLanguage = incoming.get('accept-language');
  if (acceptLanguage) outgoing.set('accept-language', acceptLanguage);

  if (workspaceId) outgoing.set('x-workspace-id', workspaceId);
  return outgoing;
}

function statusToLocalCode(status: number): LocalProblemCode {
  if (status === 503) return 'service_unavailable';
  if (status === 504) return 'dependency_timeout';
  return 'internal_error';
}

export async function readResponse<T>(response: Response, instance: string): Promise<Result<T>> {
  if (response.status === 204) return ok(undefined as T);

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/problem+json')) {
    const parsed: unknown = await response.json().catch(() => null);
    if (isProblem(parsed)) return err(parsed);
    return err(localProblem({ code: statusToLocalCode(response.status), instance }));
  }

  if (!response.ok) {
    return err(localProblem({ code: statusToLocalCode(response.status), instance }));
  }

  const parsed: unknown = await response.json().catch(() => null);
  return ok(parsed as T);
}

export function networkResult<T>(cause: unknown, instance: string): Result<T> {
  const aborted = cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError');
  return err(localProblem({ code: aborted ? 'dependency_timeout' : 'service_unavailable', instance }));
}

/**
 * Čtení z vlastního API. Nikdy nevyhazuje výjimku: obrazovka dostane buď data,
 * nebo Problem, ze kterého umí vykreslit stav S9 včetně request_id.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<Result<T>> {
  const url = buildUrl(path, options.searchParams);
  const requestHeaders = await buildRequestHeaders(options.workspaceId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: requestHeaders,
      signal: controller.signal,
      cache: 'no-store',
    });
    return await readResponse<T>(response, path);
  } catch (cause) {
    return networkResult<T>(cause, path);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Krok 5: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/api-client/fetch.test.ts`
Expected: PASS, `Tests  11 passed (11)`.

- [ ] **Krok 6: Commit**

```bash
git add apps/web/src/lib/api-client apps/web/package.json
git commit -m "feat(web): server side api fetch wrapper that never throws"
```

---

### Úkol 4: Mapování `validation_failed` na pole formuláře

**Soubory:**
- Create: `apps/web/src/lib/errors/field-errors.ts`
- Create: `apps/web/src/lib/errors/field-errors.test.ts`

Přístupnost 11.3 žádá, aby fokus po odeslání formuláře s chybou skočil na první chybné pole. Bez převodu `errors[]` na mapu podle názvu pole to nejde udělat.

- [ ] **Krok 1: Napiš padající test**

`apps/web/src/lib/errors/field-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Problem } from '@/lib/api-client/problem';
import { fieldErrorsFrom, firstErrorField, formLevelErrors } from './field-errors';

function problem(overrides: Partial<Problem>): Problem {
  return {
    type: 'https://docs.mlain.dev/errors/validation_failed',
    title: 'Validation failed',
    status: 422,
    detail: 'Tělo neprošlo schématem.',
    instance: '/api/v1/api-keys',
    code: 'validation_failed',
    request_id: 'req_1',
    ...overrides,
  };
}

describe('fieldErrorsFrom', () => {
  it('seskupí hlášky podle path', () => {
    const result = fieldErrorsFrom(
      problem({
        errors: [
          { path: 'name', code: 'too_short', message: 'Název je moc krátký.' },
          { path: 'scopes', code: 'unknown_scope', message: 'Neznámé oprávnění.' },
          { path: 'name', code: 'invalid_chars', message: 'Nepovolený znak.' },
        ],
      }),
    );
    expect(result).toEqual({
      name: ['Název je moc krátký.', 'Nepovolený znak.'],
      scopes: ['Neznámé oprávnění.'],
    });
  });

  it('u jiného kódu než validation_failed vrátí prázdnou mapu', () => {
    expect(fieldErrorsFrom(problem({ code: 'forbidden', errors: [{ path: 'x', code: 'y', message: 'z' }] }))).toEqual({});
  });

  it('prázdnou path zařadí pod klíč formuláře', () => {
    const result = fieldErrorsFrom(problem({ errors: [{ path: '', code: 'x', message: 'Chyba formuláře.' }] }));
    expect(formLevelErrors(result)).toEqual(['Chyba formuláře.']);
  });

  it('hlavičku Idempotency-Key mapuje na klíč formuláře, ne na pole', () => {
    const result = fieldErrorsFrom(
      problem({ errors: [{ path: 'Idempotency-Key', code: 'missing', message: 'Chybí hlavička.' }] }),
    );
    expect(formLevelErrors(result)).toEqual(['Chybí hlavička.']);
  });
});

describe('firstErrorField', () => {
  it('vrátí první pole v pořadí, v jakém přišlo ze serveru', () => {
    const result = fieldErrorsFrom(
      problem({
        errors: [
          { path: 'timezone', code: 'a', message: 'a' },
          { path: 'name', code: 'b', message: 'b' },
        ],
      }),
    );
    expect(firstErrorField(result)).toBe('timezone');
  });

  it('u prázdné mapy vrátí undefined', () => {
    expect(firstErrorField({})).toBeUndefined();
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/errors/field-errors.test.ts`
Expected: FAIL, `Failed to resolve import "./field-errors"`.

- [ ] **Krok 3: Napiš implementaci**

`apps/web/src/lib/errors/field-errors.ts`:

```ts
import type { Problem } from '@/lib/api-client/problem';

/** Klíč pro chyby, které nepatří ke konkrétnímu poli. */
export const FORM_LEVEL_KEY = '__form__';

/** Cesty, které server vrací, ale uživatel je ve formuláři nevidí. */
const NON_FIELD_PATHS = new Set(['', 'Idempotency-Key', 'X-Reauth-Password']);

export type FieldErrors = Record<string, string[]>;

export function fieldErrorsFrom(problem: Problem): FieldErrors {
  if (problem.code !== 'validation_failed' || !problem.errors) return {};

  const grouped: FieldErrors = {};
  for (const entry of problem.errors) {
    const key = NON_FIELD_PATHS.has(entry.path) ? FORM_LEVEL_KEY : entry.path;
    (grouped[key] ??= []).push(entry.message);
  }
  return grouped;
}

export function formLevelErrors(errors: FieldErrors): string[] {
  return errors[FORM_LEVEL_KEY] ?? [];
}

export function firstErrorField(errors: FieldErrors): string | undefined {
  return Object.keys(errors).find((key) => key !== FORM_LEVEL_KEY);
}

export function hasFieldErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/errors/field-errors.test.ts`
Expected: PASS, `Tests  6 passed (6)`.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/lib/errors
git commit -m "feat(web): map validation_failed errors onto form fields"
```

---

### Úkol 5: Zápisová obálka `apiMutate` a jednotný výsledek akce

**Soubory:**
- Create: `apps/web/src/lib/api-client/mutate.ts`
- Create: `apps/web/src/lib/api-client/mutate.test.ts`
- Create: `apps/web/src/lib/feedback/action-result.ts`
- Create: `apps/web/src/lib/feedback/action-catalog.ts`
- Create: `apps/web/src/lib/feedback/action-catalog.test.ts`
- Create: `apps/web/src/lib/feedback/idempotency-field.tsx`

Kritérium 1 kapitoly 15.1 části 6 chce, aby každá mutační akce měla navázaný **právě jeden** primární kanál zpětné vazby podle tabulky 5.2 a aby to hlídal automatický test. Katalog akcí je přesně ten mechanismus.

- [ ] **Krok 1: Napiš padající test zápisové obálky**

`apps/web/src/lib/api-client/mutate.test.ts`:

```ts
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./base-url', () => ({ getApiBaseUrl: () => 'http://api.test' }));

const cookieStore = { get: vi.fn(() => ({ name: 'ml_session', value: 'sess' })) };
const requestHeaders = { get: vi.fn(() => null) };

vi.mock('next/headers', () => ({
  cookies: async () => cookieStore,
  headers: async () => requestHeaders,
}));

vi.mock('@/lib/identity/current-user', () => ({
  getCsrfToken: async () => 'csrf-token-value',
}));

const { apiMutate } = await import('./mutate');

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('apiMutate', () => {
  it('posílá Origin, X-CSRF-Token a JSON tělo', async () => {
    let seen: Headers | undefined;
    let body: unknown;
    server.use(
      http.post('http://api.test/api/v1/api-keys', async ({ request }) => {
        seen = request.headers;
        body = await request.json();
        return HttpResponse.json({ id: 'k1' }, { status: 201 });
      }),
    );

    const result = await apiMutate<{ id: string }>('/api/v1/api-keys', {
      method: 'POST',
      body: { name: 'E-shop' },
      workspaceId: 'ws1',
      idempotencyKey: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
    });

    expect(result.ok).toBe(true);
    expect(seen?.get('origin')).toBe('http://api.test');
    expect(seen?.get('x-csrf-token')).toBe('csrf-token-value');
    expect(seen?.get('x-workspace-id')).toBe('ws1');
    expect(seen?.get('idempotency-key')).toBe('0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071');
    expect(seen?.get('content-type')).toContain('application/json');
    expect(body).toEqual({ name: 'E-shop' });
  });

  it('u DELETE bez těla neposílá content-type', async () => {
    let seen: Headers | undefined;
    server.use(
      http.delete('http://api.test/api/v1/api-keys/k1', ({ request }) => {
        seen = request.headers;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await apiMutate('/api/v1/api-keys/k1', { method: 'DELETE', workspaceId: 'ws1' });
    expect(seen?.get('content-type')).toBeNull();
  });

  it('posílá X-Reauth-Password, když je zadané', async () => {
    let seen: Headers | undefined;
    server.use(
      http.post('http://api.test/api/v1/workspaces/w1/transfer-ownership', ({ request }) => {
        seen = request.headers;
        return HttpResponse.json({});
      }),
    );
    await apiMutate('/api/v1/workspaces/w1/transfer-ownership', {
      method: 'POST',
      body: { user_id: 'u2' },
      reauthPassword: 'tajne heslo',
    });
    expect(seen?.get('x-reauth-password')).toBe('tajne heslo');
  });

  it('vrátí Problem u 409 idempotency_key_reuse', async () => {
    server.use(
      http.post('http://api.test/api/v1/api-keys', () =>
        HttpResponse.json(
          {
            type: 'https://docs.mlain.dev/errors/idempotency_key_reuse',
            title: 'Idempotency key reused',
            status: 409,
            detail: 'Stejný klíč, jiné tělo.',
            instance: '/api/v1/api-keys',
            code: 'idempotency_key_reuse',
            request_id: 'req_2',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const result = await apiMutate('/api/v1/api-keys', { method: 'POST', body: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.code).toBe('idempotency_key_reuse');
  });

  it('u nedostupné služby vrátí service_unavailable, ne výjimku', async () => {
    server.use(http.post('http://api.test/api/v1/x', () => HttpResponse.error()));
    await expect(apiMutate('/api/v1/x', { method: 'POST', body: {} })).resolves.toMatchObject({ ok: false });
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/api-client/mutate.test.ts`
Expected: FAIL, `Failed to resolve import "./mutate"`.

- [ ] **Krok 3: Napiš `mutate.ts`**

`apps/web/src/lib/api-client/mutate.ts`:

```ts
import 'server-only';
import { getCsrfToken } from '@/lib/identity/current-user';
import { getApiBaseUrl } from './base-url';
import { buildRequestHeaders, buildUrl, networkResult, readResponse } from './fetch';
import type { Result } from './result';

const DEFAULT_TIMEOUT_MS = 15_000;

export type MutateOptions = {
  method: 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  workspaceId?: string;
  /** Povinný u endpointů z výčtu 4.4 části 1. Bere se ze skrytého pole formuláře. */
  idempotencyKey?: string;
  /** Re-autentizace heslem u předání vlastnictví, viz 3.3 části 1. */
  reauthPassword?: string;
  timeoutMs?: number;
};

/**
 * Zápis do vlastního API ze Server Action. Doplňuje obě vrstvy ochrany proti
 * CSRF podle 3.2 části 1: hlavičku Origin a double submit token.
 */
export async function apiMutate<T>(path: string, options: MutateOptions): Promise<Result<T>> {
  const url = buildUrl(path);
  const requestHeaders = await buildRequestHeaders(options.workspaceId);

  requestHeaders.set('origin', getApiBaseUrl());

  const csrfToken = await getCsrfToken();
  if (csrfToken) requestHeaders.set('x-csrf-token', csrfToken);
  if (options.idempotencyKey) requestHeaders.set('idempotency-key', options.idempotencyKey);
  if (options.reauthPassword) requestHeaders.set('x-reauth-password', options.reauthPassword);

  const hasBody = options.body !== undefined;
  if (hasBody) requestHeaders.set('content-type', 'application/json; charset=utf-8');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: options.method,
      headers: requestHeaders,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    return await readResponse<T>(response, path);
  } catch (cause) {
    return networkResult<T>(cause, path);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Krok 4: Napiš jednotný výsledek akce**

`apps/web/src/lib/feedback/action-result.ts`:

```ts
import type { Problem } from '@/lib/api-client/problem';
import { fieldErrorsFrom, type FieldErrors } from '@/lib/errors/field-errors';

/** Šest kanálů z 5.3 části 6. P06 používá čtyři, zbylé dva patří dlouhým úlohám. */
export type FeedbackChannel = 'inline' | 'inlineBlock' | 'toast' | 'page';

export type ActionSuccess<T> = {
  status: 'success';
  channel: FeedbackChannel;
  /** Klíč do katalogu, vždy literál. Skládání klíče za běhu je zakázané. */
  messageKey: string;
  values?: Record<string, string | number>;
  data?: T;
};

export type ActionFailure = {
  status: 'error';
  channel: FeedbackChannel;
  problem: Problem;
  fieldErrors: FieldErrors;
};

export type ActionState<T = void> = { status: 'idle' } | ActionSuccess<T> | ActionFailure;

export const IDLE: ActionState<never> = { status: 'idle' };

export function succeeded<T>(input: Omit<ActionSuccess<T>, 'status'>): ActionSuccess<T> {
  return { status: 'success', ...input };
}

export function failed(channel: FeedbackChannel, problem: Problem): ActionFailure {
  return { status: 'error', channel, problem, fieldErrors: fieldErrorsFrom(problem) };
}
```

- [ ] **Krok 5: Napiš katalog akcí a jeho test**

`apps/web/src/lib/feedback/action-catalog.ts`:

```ts
import type { FeedbackChannel } from './action-result';

/** Třídy akcí z 5.1 části 6. A0 je čtení a v katalogu není. */
export type ActionClass = 'A1' | 'A2' | 'A3' | 'A4' | 'A5';

/** Úrovně ochrany z 6.1 části 6. */
export type RiskLevel = 'N1' | 'N2' | 'N3' | 'N4';

/** Závazné mapování třídy na primární kanál podle rozhodovací tabulky 5.2. */
export const CHANNEL_BY_CLASS: Record<ActionClass, FeedbackChannel> = {
  A1: 'inline',
  A2: 'toast',
  A3: 'inlineBlock',
  A4: 'page',
  A5: 'page',
};

export type ActionDescriptor = {
  module: string;
  class: ActionClass;
  channel: FeedbackChannel;
  risk: RiskLevel;
};

/**
 * Každý Server Action plánu P06 má tady právě jeden řádek. Test v tomhle
 * adresáři ověří, že modul akci opravdu exportuje a že kanál sedí s třídou.
 */
export const ACTION_CATALOG = {
  setupAction: { module: 'features/auth/actions', class: 'A5', channel: 'page', risk: 'N1' },
  loginAction: { module: 'features/auth/actions', class: 'A3', channel: 'inlineBlock', risk: 'N1' },
  requestPasswordResetAction: { module: 'features/auth/actions', class: 'A3', channel: 'inlineBlock', risk: 'N1' },
  confirmPasswordResetAction: { module: 'features/auth/actions', class: 'A3', channel: 'inlineBlock', risk: 'N1' },
  acceptInvitationAction: { module: 'features/auth/actions', class: 'A3', channel: 'inlineBlock', risk: 'N1' },
  createWorkspaceAction: { module: 'features/auth/actions', class: 'A3', channel: 'page', risk: 'N1' },
  updateProfileAction: { module: 'features/profile/actions', class: 'A1', channel: 'inline', risk: 'N1' },
  changePasswordAction: { module: 'features/profile/actions', class: 'A3', channel: 'inlineBlock', risk: 'N2' },
  revokeSessionAction: { module: 'features/profile/actions', class: 'A2', channel: 'toast', risk: 'N1' },
  logoutAllAction: { module: 'features/profile/actions', class: 'A5', channel: 'page', risk: 'N2' },
  logoutAction: { module: 'features/profile/actions', class: 'A5', channel: 'page', risk: 'N1' },
  updateWorkspaceAction: { module: 'features/workspace-settings/actions', class: 'A1', channel: 'inline', risk: 'N1' },
  updateAddressFormAction: { module: 'features/workspace-settings/actions', class: 'A4', channel: 'page', risk: 'N2' },
  deleteWorkspaceAction: { module: 'features/workspace-settings/actions', class: 'A5', channel: 'page', risk: 'N4' },
  changeMemberRoleAction: { module: 'features/members/actions', class: 'A2', channel: 'toast', risk: 'N1' },
  removeMemberAction: { module: 'features/members/actions', class: 'A2', channel: 'toast', risk: 'N2' },
  inviteMemberAction: { module: 'features/members/actions', class: 'A3', channel: 'inlineBlock', risk: 'N1' },
  revokeInvitationAction: { module: 'features/members/actions', class: 'A2', channel: 'toast', risk: 'N1' },
  createApiKeyAction: { module: 'features/api-keys/actions', class: 'A3', channel: 'inlineBlock', risk: 'N1' },
  rotateApiKeyAction: { module: 'features/api-keys/actions', class: 'A5', channel: 'page', risk: 'N3' },
  revokeApiKeyAction: { module: 'features/api-keys/actions', class: 'A5', channel: 'page', risk: 'N3' },
  createWebhookAction: { module: 'features/webhooks/actions', class: 'A3', channel: 'inlineBlock', risk: 'N1' },
  updateWebhookAction: { module: 'features/webhooks/actions', class: 'A1', channel: 'inline', risk: 'N1' },
  deleteWebhookAction: { module: 'features/webhooks/actions', class: 'A2', channel: 'toast', risk: 'N2' },
  testWebhookAction: { module: 'features/webhooks/actions', class: 'A3', channel: 'inlineBlock', risk: 'N1' },
  enableWebhookAction: { module: 'features/webhooks/actions', class: 'A3', channel: 'inlineBlock', risk: 'N1' },
  retryDeliveryAction: { module: 'features/webhooks/actions', class: 'A3', channel: 'inlineBlock', risk: 'N1' },
} as const satisfies Record<string, ActionDescriptor>;

export type ActionName = keyof typeof ACTION_CATALOG;
```

`apps/web/src/lib/feedback/action-catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ACTION_CATALOG, CHANNEL_BY_CLASS, type ActionName } from './action-catalog';

describe('katalog akcí, kritérium 1 kapitoly 15.1 části 6', () => {
  it('kanál každé akce odpovídá její třídě podle tabulky 5.2', () => {
    for (const [name, descriptor] of Object.entries(ACTION_CATALOG)) {
      expect(descriptor.channel, `akce ${name}`).toBe(CHANNEL_BY_CLASS[descriptor.class]);
    }
  });

  it('každá akce z katalogu je opravdu exportovaná ze svého modulu', async () => {
    const names = Object.keys(ACTION_CATALOG) as ActionName[];
    for (const name of names) {
      const descriptor = ACTION_CATALOG[name];
      const loaded: Record<string, unknown> = await import(`../../${descriptor.module}`);
      expect(typeof loaded[name], `${descriptor.module} neexportuje ${name}`).toBe('function');
    }
  });

  it('destruktivní akce mají úroveň ochrany aspoň N2', () => {
    const destructive: ActionName[] = [
      'deleteWorkspaceAction',
      'removeMemberAction',
      'rotateApiKeyAction',
      'revokeApiKeyAction',
      'deleteWebhookAction',
      'logoutAllAction',
    ];
    for (const name of destructive) {
      expect(ACTION_CATALOG[name].risk, `akce ${name}`).not.toBe('N1');
    }
  });

  it('smazání projektu je jediná akce úrovně N4', () => {
    const n4 = Object.entries(ACTION_CATALOG)
      .filter(([, descriptor]) => descriptor.risk === 'N4')
      .map(([name]) => name);
    expect(n4).toEqual(['deleteWorkspaceAction']);
  });
});
```

- [ ] **Krok 6: Napiš skryté pole idempotence**

`apps/web/src/lib/feedback/idempotency-field.tsx`:

```tsx
'use client';

import { useState } from 'react';

export const IDEMPOTENCY_FIELD_NAME = '_idempotency_key';

/**
 * Klíč vzniká jednou při vykreslení formuláře, ne při každém odeslání. Díky
 * tomu je dvojklik na tlačítko dvakrát tentýž požadavek, tedy přesně případ,
 * na který je idempotence z 4.4 části 1. Nové odeslání po chybě používá stejný
 * klíč, dokud se stránka nepřenačte, což je správně: opakování stejného
 * špatného požadavku má dát stejnou odpověď.
 */
export function IdempotencyField() {
  const [key] = useState(() => crypto.randomUUID());
  return <input type="hidden" name={IDEMPOTENCY_FIELD_NAME} value={key} readOnly />;
}
```

- [ ] **Krok 7: Spusť testy obálky a katalogu**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/api-client/mutate.test.ts`
Expected: PASS, `Tests  5 passed (5)`.

Test katalogu zatím padá na neexistujících modulech akcí. To je v pořádku: pouští se poprvé v úkolu 37, kdy všechny akce existují. Do té doby ho přeskoč.

Run: `pnpm --filter @mlain/web exec vitest run src/lib/feedback/action-catalog.test.ts -t "kanál každé akce"`
Expected: PASS, `Tests  1 passed`.

- [ ] **Krok 8: Commit**

```bash
git add apps/web/src/lib/api-client apps/web/src/lib/feedback
git commit -m "feat(web): mutation wrapper, action feedback catalog, idempotency field"
```

---

### Úkol 6: Kurzorové stránkování v URL

**Soubory:**
- Create: `apps/web/src/lib/api-client/cursor.ts`
- Create: `apps/web/src/lib/api-client/cursor.test.ts`

Kritéria 78 a 79 kapitoly 15.6 části 6: žádná čísla stránek, stav stránkování v URL jako `cursor`, a odkaz s neplatným kurzorem ukáže **první stránku téhož filtru** plus hlášku, ne prázdnou tabulku ani chybu.

- [ ] **Krok 1: Napiš padající test**

`apps/web/src/lib/api-client/cursor.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { localProblem, type Problem } from './problem';
import { err, ok, type Result } from './result';
import {
  DEFAULT_LIMIT,
  buildListHref,
  fetchListWithCursorFallback,
  isInvalidCursorProblem,
  readCursor,
  readFilters,
  type Paginated,
} from './cursor';

const validationProblem = (path: string): Problem => ({
  type: 'https://docs.mlain.dev/errors/validation_failed',
  title: 'Validation failed',
  status: 422,
  detail: 'Neplatný kurzor.',
  instance: '/api/v1/audit-log',
  code: 'validation_failed',
  request_id: 'req_9',
  errors: [{ path, code: 'invalid_cursor', message: 'Kurzor nedává smysl.' }],
});

describe('readCursor a readFilters', () => {
  it('přečte kurzor z jednoduché hodnoty', () => {
    expect(readCursor({ cursor: 'abc' })).toBe('abc');
  });

  it('u pole vezme první hodnotu', () => {
    expect(readCursor({ cursor: ['abc', 'def'] })).toBe('abc');
  });

  it('u chybějícího kurzoru vrátí undefined', () => {
    expect(readCursor({})).toBeUndefined();
  });

  it('propustí jen povolené filtry', () => {
    const filters = readFilters({ action: 'api_key.created', evil: 'x', from: '2026-07-01' }, ['action', 'from', 'to']);
    expect(filters).toEqual({ action: 'api_key.created', from: '2026-07-01' });
  });

  it('prázdný filtr zahodí, aby v URL nezůstal action=', () => {
    expect(readFilters({ action: '' }, ['action'])).toEqual({});
  });
});

describe('buildListHref', () => {
  it('poskládá cestu s filtry a kurzorem', () => {
    expect(buildListHref('/w/eshop/settings/audit', { action: 'api_key.created' }, 'CUR')).toBe(
      '/w/eshop/settings/audit?action=api_key.created&cursor=CUR',
    );
  });

  it('bez kurzoru parametr nepřidá', () => {
    expect(buildListHref('/w/eshop/settings/audit', { action: 'api_key.created' })).toBe(
      '/w/eshop/settings/audit?action=api_key.created',
    );
  });

  it('nikdy nevyrobí parametr page', () => {
    expect(buildListHref('/x', { page: '3' } as Record<string, string>, 'CUR')).not.toContain('page=');
  });
});

describe('isInvalidCursorProblem', () => {
  it('pozná 422 s path cursor', () => {
    expect(isInvalidCursorProblem(validationProblem('cursor'))).toBe(true);
  });

  it('jiné validační chyby nepozná', () => {
    expect(isInvalidCursorProblem(validationProblem('limit'))).toBe(false);
  });

  it('jiné kódy nepozná', () => {
    expect(isInvalidCursorProblem(localProblem({ code: 'internal_error', instance: '/x' }))).toBe(false);
  });
});

describe('fetchListWithCursorFallback', () => {
  const page: Paginated<{ id: string }> = {
    data: [{ id: 'a' }],
    pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: DEFAULT_LIMIT },
  };

  it('u platného kurzoru zavolá načtení jednou', async () => {
    const load = vi.fn(async (): Promise<Result<Paginated<{ id: string }>>> => ok(page));
    const result = await fetchListWithCursorFallback(load, 'CUR');
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('CUR');
    expect(result.cursorDropped).toBe(false);
  });

  it('u neplatného kurzoru načte první stránku téhož filtru a oznámí to', async () => {
    const load = vi
      .fn<(cursor?: string) => Promise<Result<Paginated<{ id: string }>>>>()
      .mockResolvedValueOnce(err(validationProblem('cursor')))
      .mockResolvedValueOnce(ok(page));

    const result = await fetchListWithCursorFallback(load, 'ROZBITY');

    expect(load).toHaveBeenNthCalledWith(1, 'ROZBITY');
    expect(load).toHaveBeenNthCalledWith(2, undefined);
    expect(result.cursorDropped).toBe(true);
    expect(result.result.ok).toBe(true);
  });

  it('jinou chybu nepřepisuje a druhý pokus nedělá', async () => {
    const load = vi.fn(async (): Promise<Result<Paginated<{ id: string }>>> =>
      err(localProblem({ code: 'service_unavailable', instance: '/x' })),
    );
    const result = await fetchListWithCursorFallback(load, 'CUR');
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.cursorDropped).toBe(false);
    expect(result.result.ok).toBe(false);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/api-client/cursor.test.ts`
Expected: FAIL, `Failed to resolve import "./cursor"`.

- [ ] **Krok 3: Napiš implementaci**

`apps/web/src/lib/api-client/cursor.ts`:

```ts
import type { Problem } from './problem';
import type { Result } from './result';

export const DEFAULT_LIMIT = 50;
export const CURSOR_PARAM = 'cursor';

export type Paginated<T> = {
  data: T[];
  pagination: {
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
};

export type CollectionCount = {
  count: number;
  precision: 'exact' | 'estimated';
  computed_at: string;
  stale: boolean;
};

export type SearchParamsInput = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function readCursor(searchParams: SearchParamsInput): string | undefined {
  const value = single(searchParams[CURSOR_PARAM]);
  return value === '' ? undefined : value;
}

export function readFilters(searchParams: SearchParamsInput, allowed: readonly string[]): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const key of allowed) {
    const value = single(searchParams[key]);
    if (value !== undefined && value !== '') filters[key] = value;
  }
  return filters;
}

/**
 * Odkaz na stránku výsledků. Čísla stránek se nezavádějí, protože kurzor je
 * pozice v seřazené množině, ne pořadové číslo (4.3 části 1).
 */
export function buildListHref(basePath: string, filters: Record<string, string>, cursor?: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (key === 'page' || key === CURSOR_PARAM) continue;
    if (value !== '') params.set(key, value);
  }
  if (cursor) params.set(CURSOR_PARAM, cursor);
  const query = params.toString();
  return query === '' ? basePath : `${basePath}?${query}`;
}

export function isInvalidCursorProblem(problem: Problem): boolean {
  return problem.code === 'validation_failed' && (problem.errors ?? []).some((entry) => entry.path === CURSOR_PARAM);
}

export type ListFetchOutcome<T> = {
  result: Result<Paginated<T>>;
  /** true, když se kurzor ukázal jako neplatný a ukazuje se první stránka. */
  cursorDropped: boolean;
};

/**
 * Kritérium 79 části 6: odkaz s neplatným kurzorem zobrazí první stránku
 * stejného filtru a hlášku o tom, ne prázdnou tabulku ani chybu.
 */
export async function fetchListWithCursorFallback<T>(
  load: (cursor?: string) => Promise<Result<Paginated<T>>>,
  cursor?: string,
): Promise<ListFetchOutcome<T>> {
  const first = await load(cursor);
  if (first.ok || cursor === undefined || !isInvalidCursorProblem(first.problem)) {
    return { result: first, cursorDropped: false };
  }
  return { result: await load(undefined), cursorDropped: true };
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/api-client/cursor.test.ts`
Expected: PASS, `Tests  14 passed (14)`.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/lib/api-client/cursor.ts apps/web/src/lib/api-client/cursor.test.ts
git commit -m "feat(web): cursor pagination in the url with invalid cursor fallback"
```

---

### Úkol 7: Statická mapa chybových kódů na překladové klíče

**Soubory:**
- Create: `apps/web/src/lib/errors/error-keys.ts`
- Create: `apps/web/src/lib/errors/error-keys.test.ts`

Kritérium 71 části 6 zakazuje skládat překladový klíč za běhu, kritérium 76 žádá, aby neznámý kód zobrazil `detail` ze serveru a `request_id`, nikdy prázdnou obrazovku. Obojí řeší jedna explicitní mapa.

- [ ] **Krok 1: Napiš padající test**

`apps/web/src/lib/errors/error-keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@mlain/core/errors';
import { AUTH_ERROR_KEYS, SETTINGS_ERROR_KEYS, errorTextKeys } from './error-keys';

describe('mapa kódů na klíče', () => {
  it('neobsahuje kód, který registr P01 nezná', () => {
    const registered = new Set(Object.keys(ERROR_CODES));
    for (const code of [...Object.keys(AUTH_ERROR_KEYS), ...Object.keys(SETTINGS_ERROR_KEYS)]) {
      expect(registered.has(code), `kód ${code} není v registru`).toBe(true);
    }
  });

  it('každý záznam má klíč nadpisu i těla a oba jsou literály', () => {
    for (const entry of [...Object.values(AUTH_ERROR_KEYS), ...Object.values(SETTINGS_ERROR_KEYS)]) {
      expect(entry.title).toMatch(/^errors\.[a-zA-Z]+\.title$/);
      expect(entry.body).toMatch(/^errors\.[a-zA-Z]+\.body$/);
    }
  });

  it('pokrývá tři kódy části 1 z mapování 10.2 části 6', () => {
    expect(SETTINGS_ERROR_KEYS).toHaveProperty('forbidden');
    expect(SETTINGS_ERROR_KEYS).toHaveProperty('session_expired');
    expect(SETTINGS_ERROR_KEYS).toHaveProperty('webhook_endpoint_disabled');
  });

  it('u známého kódu vrátí klíče', () => {
    expect(errorTextKeys(AUTH_ERROR_KEYS, 'invalid_credentials')).toEqual({
      title: 'errors.invalidCredentials.title',
      body: 'errors.invalidCredentials.body',
    });
  });

  it('u neznámého kódu vrátí undefined, aby se použil detail ze serveru', () => {
    expect(errorTextKeys(AUTH_ERROR_KEYS, 'segment_too_complex')).toBeUndefined();
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/errors/error-keys.test.ts`
Expected: FAIL, `Failed to resolve import "./error-keys"`.

- [ ] **Krok 3: Napiš implementaci**

`apps/web/src/lib/errors/error-keys.ts`:

```ts
/**
 * Klíč překladu se nesmí skládat za běhu (kritérium 71 části 6 a konvence 3.9
 * části 1). Tahle mapa je jediné povolené spojení mezi kódem chyby a textem.
 * Kód, který v mapě není, spadne na `detail` ze serveru, viz kritérium 76.
 *
 * Klíče jsou relativní k namespace, protože obrazovky používají
 * `useTranslations('auth')` nebo `useTranslations('settings')`.
 */
export type ErrorTextKeys = { readonly title: string; readonly body: string };

export const AUTH_ERROR_KEYS = {
  invalid_credentials: { title: 'errors.invalidCredentials.title', body: 'errors.invalidCredentials.body' },
  account_locked: { title: 'errors.accountLocked.title', body: 'errors.accountLocked.body' },
  rate_limited: { title: 'errors.rateLimited.title', body: 'errors.rateLimited.body' },
  unauthenticated: { title: 'errors.unauthenticated.title', body: 'errors.unauthenticated.body' },
  session_expired: { title: 'errors.sessionExpired.title', body: 'errors.sessionExpired.body' },
  setup_already_completed: { title: 'errors.setupAlreadyCompleted.title', body: 'errors.setupAlreadyCompleted.body' },
  validation_failed: { title: 'errors.validationFailed.title', body: 'errors.validationFailed.body' },
  not_found: { title: 'errors.notFound.title', body: 'errors.notFound.body' },
  gone: { title: 'errors.gone.title', body: 'errors.gone.body' },
  service_unavailable: { title: 'errors.serviceUnavailable.title', body: 'errors.serviceUnavailable.body' },
  dependency_timeout: { title: 'errors.dependencyTimeout.title', body: 'errors.dependencyTimeout.body' },
  internal_error: { title: 'errors.internalError.title', body: 'errors.internalError.body' },
} as const satisfies Record<string, ErrorTextKeys>;

export const SETTINGS_ERROR_KEYS = {
  forbidden: { title: 'errors.forbidden.title', body: 'errors.forbidden.body' },
  insufficient_scope: { title: 'errors.insufficientScope.title', body: 'errors.insufficientScope.body' },
  origin_not_allowed: { title: 'errors.originNotAllowed.title', body: 'errors.originNotAllowed.body' },
  csrf_token_invalid: { title: 'errors.csrfTokenInvalid.title', body: 'errors.csrfTokenInvalid.body' },
  session_expired: { title: 'errors.sessionExpired.title', body: 'errors.sessionExpired.body' },
  not_found: { title: 'errors.notFound.title', body: 'errors.notFound.body' },
  conflict: { title: 'errors.conflict.title', body: 'errors.conflict.body' },
  already_exists: { title: 'errors.alreadyExists.title', body: 'errors.alreadyExists.body' },
  already_member: { title: 'errors.alreadyMember.title', body: 'errors.alreadyMember.body' },
  last_owner_cannot_be_removed: { title: 'errors.lastOwner.title', body: 'errors.lastOwner.body' },
  idempotency_key_reuse: { title: 'errors.idempotencyKeyReuse.title', body: 'errors.idempotencyKeyReuse.body' },
  idempotency_request_in_progress: {
    title: 'errors.idempotencyInProgress.title',
    body: 'errors.idempotencyInProgress.body',
  },
  validation_failed: { title: 'errors.validationFailed.title', body: 'errors.validationFailed.body' },
  too_many_items: { title: 'errors.tooManyItems.title', body: 'errors.tooManyItems.body' },
  rate_limited: { title: 'errors.rateLimited.title', body: 'errors.rateLimited.body' },
  webhook_endpoint_disabled: { title: 'errors.webhookDisabled.title', body: 'errors.webhookDisabled.body' },
  service_unavailable: { title: 'errors.serviceUnavailable.title', body: 'errors.serviceUnavailable.body' },
  dependency_timeout: { title: 'errors.dependencyTimeout.title', body: 'errors.dependencyTimeout.body' },
  internal_error: { title: 'errors.internalError.title', body: 'errors.internalError.body' },
} as const satisfies Record<string, ErrorTextKeys>;

export type ErrorKeyMap = Record<string, ErrorTextKeys>;

export function errorTextKeys(map: ErrorKeyMap, code: string): ErrorTextKeys | undefined {
  return Object.hasOwn(map, code) ? map[code] : undefined;
}
```

**Poznámka k `already_member` a `webhook_endpoint_disabled`.** Oba kódy zavádí část 1 (3.3, respektive 3.8 a mapování 10.2 části 6) a registruje je P01. Kdyby preflight z úkolu 1 ukázal, že v registru nejsou, doplní se do P01, ne sem.

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/errors/error-keys.test.ts`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/lib/errors/error-keys.ts apps/web/src/lib/errors/error-keys.test.ts
git commit -m "feat(web): static error code to translation key map"
```

---

### Úkol 8: Chybový blok S9 s `request_id` a technickými detaily

**Soubory:**
- Create: `apps/web/src/lib/errors/problem-block.tsx`
- Create: `apps/web/src/lib/errors/problem-block.test.tsx`

Tenhle blok je jediné místo v celém P06, kde se chyba načtení vykresluje. Splňuje naráz 5.3 části 1 (lokalizovaný text, `request_id` s kopírováním, sbalený blok „Technické detaily", `data-error-code` v DOM), 7.4 části 6 (anatomie bloku) a kritérium 22 kapitoly 15.3.

- [ ] **Krok 1: Napiš padající test**

`apps/web/src/lib/errors/problem-block.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Problem } from '@/lib/api-client/problem';
import { ProblemBlock } from './problem-block';

const LABELS = {
  technicalDetails: 'Technické detaily',
  code: 'Kód',
  requestId: 'Číslo požadavku',
  time: 'Čas',
  copyBlock: 'Zkopírovat vše',
  copied: 'Zkopírováno',
  tryAgain: 'Zkusit znovu',
};

const PROBLEM: Problem = {
  type: 'https://docs.mlain.dev/errors/dependency_timeout',
  title: 'Dependency timeout',
  status: 504,
  detail: 'Databáze neodpověděla včas.',
  instance: '/api/v1/api-keys',
  code: 'dependency_timeout',
  request_id: 'req_01J8XK2M9P',
};

const OCCURRED_AT = '2026-07-31T12:32:07.000Z';

function renderBlock(problem: Problem = PROBLEM, onRetry?: () => void) {
  return render(
    <ProblemBlock
      problem={problem}
      title="Klíče k API se nepodařilo načíst"
      body="Většinou je to přechodné a druhý pokus projde."
      labels={LABELS}
      occurredAt={OCCURRED_AT}
      onRetry={onRetry}
    />,
  );
}

describe('ProblemBlock', () => {
  it('ukáže nadpis, vysvětlení a tlačítko Zkusit znovu', () => {
    renderBlock(PROBLEM, vi.fn());
    expect(screen.getByRole('heading', { name: 'Klíče k API se nepodařilo načíst' })).toBeInTheDocument();
    expect(screen.getByText('Většinou je to přechodné a druhý pokus projde.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
  });

  it('vykresluje ErrorBlock z design systému, ne vlastní kopii', () => {
    // Kdyby se blok začal kreslit znovu u sebe, tenhle test spadne
    // a upozorní dřív, než se obě verze rozejdou (uzávěr S3).
    expect(renderBlock().container.querySelector('[data-testid="error-block"]')).not.toBeNull();
  });

  it('drží kód chyby v atributu data-error-code kvůli testům', () => {
    const { container } = renderBlock();
    expect(container.querySelector('[data-error-code="dependency_timeout"]')).not.toBeNull();
  });

  it('technické detaily jsou sbalené a po rozbalení nesou kód, číslo požadavku a čas', async () => {
    renderBlock();
    // `Collapsible` z P05 stojí na Radixu, takže to není `<details>`.
    // Sbalený stav se pozná podle toho, že obsah v dokumentu není.
    expect(screen.queryByText('dependency_timeout')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Technické detaily'));
    expect(screen.getByText('dependency_timeout')).toBeInTheDocument();
    expect(screen.getByText('req_01J8XK2M9P')).toBeInTheDocument();
    expect(screen.getByText(OCCURRED_AT)).toBeInTheDocument();
  });

  it('zkopíruje celý blok jedním tlačítkem, včetně čísla požadavku', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderBlock();
    await userEvent.click(screen.getByText('Technické detaily'));
    await userEvent.click(screen.getByRole('button', { name: 'Zkopírovat vše' }));
    const copied = writeText.mock.calls.at(-1)![0] as string;
    expect(copied).toContain('dependency_timeout');
    expect(copied).toContain('req_01J8XK2M9P');
    expect(copied).toContain('/api/v1/api-keys');
  });

  it('bez onRetry tlačítko Zkusit znovu nenabídne', () => {
    renderBlock();
    expect(screen.queryByRole('button', { name: 'Zkusit znovu' })).not.toBeInTheDocument();
  });

  it('u prázdného request_id nevymýšlí číslo (rozhodnutí R5)', async () => {
    renderBlock({ ...PROBLEM, request_id: '', code: 'service_unavailable' });
    await userEvent.click(screen.getByText('Technické detaily'));
    expect(screen.queryByText('req_01J8XK2M9P')).not.toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/errors/problem-block.test.tsx`
Expected: FAIL, `Failed to resolve import "./problem-block"`.

- [ ] **Krok 3: Vezmi tlačítko kopírování z design systému, nepiš vlastní**

`CopyButton` je v `@mlain/ui/components/copy-button` a P06 si ho **nepíše znovu**.
Dřívější znění mělo vlastní kopii v `apps/web/src/lib/errors/copy-button.tsx`,
včetně záložní cesty přes skryté `textarea` pro instalace na prostém http,
kde `navigator.clipboard` neexistuje. Kopie je pryč ze dvou důvodů: P13 už
tutéž komponentu bere z design systému, takže by v repozitáři byla dvě jména
pro totéž, a `packages/ui` vlastní P05 (uzávěr S3).

Rozhraní, na které se P06 napojuje:

```ts
CopyButton({
  value: string;
  label: string;
  copiedLabel: string;
  variant?: 'secondary' | 'link';
  className?: string;
});
```

Kdyby záložní cesta pro http chyběla, **nedopisuje se sem**, ale doplní se
požadavek do P05. P06 na to nečeká: tlačítko funguje na https, což je jediné
prostředí, ve kterém se sekret klíče vůbec zobrazuje.

- [ ] **Krok 4: Napiš `ProblemBlock`**

`apps/web/src/lib/errors/problem-block.tsx`:

```tsx
'use client';

import { ErrorBlock, type ErrorBlockLabels, type ProblemSummary } from '@mlain/ui/patterns/states';
import type { Problem } from '@/lib/api-client/problem';

export type ProblemBlockLabels = ErrorBlockLabels;

export type ProblemBlockProps = {
  problem: Problem;
  /** Lokalizovaný nadpis: co se stalo. */
  title: string;
  /** Lokalizované vysvětlení: proč a co s tím. */
  body: string;
  labels: ProblemBlockLabels;
  /** ISO čas vzniku chyby, předává ho server, aby nevznikl rozpor při hydrataci. */
  occurredAt: string;
  onRetry?: () => void;
};

/**
 * Stav S9 podle 7.1 části 6 a konvence z 5.3 části 1.
 *
 * Tenhle soubor **nic nekreslí**. Dřívější znění mělo vlastní blok s nadpisem,
 * tlačítkem, číslem požadavku a sbalenými podrobnostmi, tedy přesně to, co
 * `ErrorBlock` z `@mlain/ui/patterns/states` už umí, včetně `data-error-code`
 * v DOM a tlačítka na zkopírování celého bloku. Dvě implementace téhož se
 * rozejdou a uzávěr S3 to zakazuje, takže tady zbyl jen převod tvaru:
 * `Problem` podle RFC 9457 na `ProblemSummary`, se kterým komponenta pracuje.
 *
 * Prázdné `request_id` se **nepřevádí na výmysl**: `instance` se předá jako
 * cesta a číslo požadavku zůstane prázdné, protože vymyšlené číslo v logu
 * neexistuje (rozhodnutí R5).
 */
export function ProblemBlock({ problem, title, body, labels, occurredAt, onRetry }: ProblemBlockProps) {
  const summary: ProblemSummary = {
    code: problem.code,
    requestId: problem.request_id,
    occurredAt: new Date(occurredAt),
    path: problem.instance,
  };

  return <ErrorBlock title={title} reason={body} problem={summary} onRetry={onRetry} labels={labels} />;
}
```

**Pozor na jednu věc:** `title` a `body` sem chodí zvenku už přeložené. Blok sám nesahá na katalog, protože ho používají obě namespace (`auth` i `settings`) a `useTranslations` potřebuje literální namespace. Tím zůstává komponenta čistá a testovatelná bez i18n providera.

**Tlačítko „Zkopírovat vše" má vlastní klíč.** Skládat jeho text z `labels.copy` a slova „vše" by porušilo zákaz skládání řetězců z fragmentů (kritérium 71 části 6 a pravidlo 12.2). Klíč `errorBlock.copyAll` zavádí úkol 10 a v typu `ProblemBlockLabels` je od začátku; do `LABELS` v testu patří položka `copyAll`.

- [ ] **Krok 5: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/errors/problem-block.test.tsx`
Expected: PASS, `Tests  7 passed (7)`.

- [ ] **Krok 6: Commit**

```bash
git add apps/web/src/lib/errors
git commit -m "feat(web): s9 problem block with request id and collapsed technical details"
```

---

### Úkol 9: Serverové pomůcky identity a oprávnění

**Soubory:**
- Create: `apps/web/src/lib/identity/permissions.ts`
- Create: `apps/web/src/lib/identity/permissions.test.ts`
- Create: `apps/web/src/lib/identity/current-user.ts`
- Create: `apps/web/src/lib/identity/require-user.ts`
- Create: `apps/web/src/lib/identity/require-user.test.ts`
- Create: `apps/web/src/lib/identity/workspace-access.ts`
- Create: `apps/web/src/lib/identity/workspace-access.test.ts`

- [ ] **Krok 1: Napiš padající kontraktní test matice oprávnění**

Matice žije v `packages/core/identity/permissions.ts` a vlastní ji P04. P06 ji **nekopíruje**, jen si testem pojistí předpoklady, na kterých staví navigaci. Kdyby se matice změnila, sekce nastavení by se tiše přestaly zobrazovat a nikdo by to nezachytil.

`apps/web/src/lib/identity/permissions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ROLES, can, permissionsOf, rolesGranting } from './permissions';

describe('kontrakt matice 3.4 části 1, na kterém stojí navigace P06', () => {
  it('zná právě čtyři role v pořadí od nejsilnější', () => {
    expect(ROLES).toEqual(['owner', 'admin', 'editor', 'viewer']);
  });

  it('viewer nevidí žádnou sekci nastavení projektu kromě obecné', () => {
    expect(can('viewer', 'workspace:read')).toBe(true);
    expect(can('viewer', 'members:read')).toBe(false);
    expect(can('viewer', 'api_keys:read')).toBe(false);
    expect(can('viewer', 'webhooks:read')).toBe(false);
    expect(can('viewer', 'audit:read')).toBe(false);
  });

  it('editor vidí členy, ale nezve, a nevidí klíče ani audit', () => {
    expect(can('editor', 'members:read')).toBe(true);
    expect(can('editor', 'members:invite')).toBe(false);
    expect(can('editor', 'api_keys:read')).toBe(false);
    expect(can('editor', 'audit:read')).toBe(false);
    expect(can('editor', 'webhooks:read')).toBe(true);
    expect(can('editor', 'webhooks:write')).toBe(false);
  });

  it('admin nemůže smazat ani předat projekt', () => {
    expect(can('admin', 'workspace:update')).toBe(true);
    expect(can('admin', 'workspace:delete')).toBe(false);
    expect(can('admin', 'workspace:transfer')).toBe(false);
  });

  it('owner má všechno, co má admin, a navíc zálohy', () => {
    for (const permission of permissionsOf('admin')) {
      expect(can('owner', permission), `owner postrádá ${permission}`).toBe(true);
    }
    expect(can('owner', 'backups:read')).toBe(true);
    expect(can('admin', 'backups:read')).toBe(false);
  });

  it('rolesGranting vrátí role, které oprávnění mají, od nejslabší', () => {
    expect(rolesGranting('api_keys:read')).toEqual(['admin', 'owner']);
    expect(rolesGranting('workspace:delete')).toEqual(['owner']);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/identity/permissions.test.ts`
Expected: FAIL, `Failed to resolve import "./permissions"`.

- [ ] **Krok 3: Napiš `permissions.ts`**

`apps/web/src/lib/identity/permissions.ts`:

```ts
import { ROLE_PERMISSIONS, type Permission, type Role } from '@mlain/core/identity/permissions';

/** Od nejsilnější k nejslabší, pořadí je závazné pro řazení v rozhraní. */
export const ROLES = ['owner', 'admin', 'editor', 'viewer'] as const satisfies readonly Role[];

export type { Permission, Role };

export function permissionsOf(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Role, které dané oprávnění mají, od nejslabší. Používá se v hlášce 22
 * z 10.3 části 6: „vyžaduje oprávnění X, které mají role Editor a výš".
 */
export function rolesGranting(permission: Permission): Role[] {
  return [...ROLES].reverse().filter((role) => can(role, permission));
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/identity/permissions.test.ts`
Expected: PASS, `Tests  6 passed (6)`.

Kdyby padl test „viewer nevidí žádnou sekci", znamená to, že se matice v P04 rozešla se specifikací. Oprava patří do P04, ne sem.

- [ ] **Krok 5: Napiš `current-user.ts`**

`apps/web/src/lib/identity/current-user.ts`:

```ts
import 'server-only';
import { cache } from 'react';
import { apiFetch } from '@/lib/api-client/fetch';
import type { Result } from '@/lib/api-client/result';
import type { Role } from './permissions';

export type Membership = {
  workspace_id: string;
  workspace_slug: string;
  workspace_name: string;
  role: Role;
};

export type CurrentUser = {
  user: {
    id: string;
    email: string;
    name: string;
    locale: string;
    timezone: string;
  };
  memberships: Membership[];
  csrf_token: string;
};

/**
 * Jeden dotaz na požadavek. `cache` z Reactu drží výsledek po dobu jednoho
 * vykreslení, takže layout i stránka volají tutéž odpověď.
 */
export const getCurrentUser = cache(async (): Promise<Result<CurrentUser>> => {
  return apiFetch<CurrentUser>('/api/v1/auth/me');
});

/** Double submit token pro Server Actions, viz 3.2 části 1 a předpoklad E1. */
export async function getCsrfToken(): Promise<string | undefined> {
  const result = await getCurrentUser();
  return result.ok ? result.data.csrf_token : undefined;
}
```

- [ ] **Krok 6: Napiš padající test na `requireUser`**

`apps/web/src/lib/identity/require-user.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

const getCurrentUser = vi.fn();
vi.mock('./current-user', () => ({ getCurrentUser }));

const { requireUser } = await import('./require-user');

const problem = (status: number, code: string) => ({
  type: `https://docs.mlain.dev/errors/${code}`,
  title: code,
  status,
  detail: '',
  instance: '/api/v1/auth/me',
  code,
  request_id: 'req_1',
});

describe('requireUser', () => {
  it('vrátí uživatele, když je přihlášený', async () => {
    getCurrentUser.mockResolvedValue({ ok: true, data: { user: { id: 'u1' }, memberships: [], csrf_token: 'c' } });
    const result = await requireUser('/settings/profile');
    expect(result.ok).toBe(true);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('u 401 přesměruje na přihlášení a zachová cílovou adresu', async () => {
    getCurrentUser.mockResolvedValue({ ok: false, problem: problem(401, 'unauthenticated') });
    await expect(requireUser('/w/eshop/settings/members?role=admin')).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fw%2Feshop%2Fsettings%2Fmembers%3Frole%3Dadmin',
    );
  });

  it('u vypršené relace přesměruje také', async () => {
    getCurrentUser.mockResolvedValue({ ok: false, problem: problem(401, 'session_expired') });
    await expect(requireUser('/x')).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fx');
  });

  it('u jiné chyby nepřesměruje a vrátí Problem, aby obrazovka ukázala stav S9', async () => {
    redirect.mockClear();
    getCurrentUser.mockResolvedValue({ ok: false, problem: problem(503, 'service_unavailable') });
    const result = await requireUser('/x');
    expect(result.ok).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Krok 7: Napiš `require-user.ts` a `workspace-access.ts`**

`apps/web/src/lib/identity/require-user.ts`:

```ts
import 'server-only';
import { redirect } from 'next/navigation';
import type { Result } from '@/lib/api-client/result';
import { getCurrentUser, type CurrentUser } from './current-user';

/**
 * Autentizační brána žije v obrazovce, ne v `proxy.ts`, protože ten soubor
 * vlastní P05 (rozhodnutí R9). Na 401 přesměruje s parametrem `next`, jak
 * žádá tabulka navigačních pravidel 4.4 části 6. Jiné chyby vrací volajícímu,
 * aby je uměl vykreslit jako stav S9 s request_id.
 */
export async function requireUser(nextPath: string): Promise<Result<CurrentUser>> {
  const result = await getCurrentUser();
  if (!result.ok && result.problem.status === 401) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  return result;
}
```

`apps/web/src/lib/identity/workspace-access.ts`:

```ts
import 'server-only';
import { cache } from 'react';
import { apiFetch } from '@/lib/api-client/fetch';
import { localProblem } from '@/lib/api-client/problem';
import { err, ok, type Result } from '@/lib/api-client/result';
import { getCurrentUser } from './current-user';
import { can, permissionsOf, type Permission, type Role } from './permissions';

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  locale: string;
  timezone: string;
  address_form: 'formal' | 'informal';
  created_at: string;
};

export type WorkspaceAccess = {
  workspace: Workspace;
  role: Role;
  permissions: readonly Permission[];
  /** Jméno a e-mail uživatele, ke kterému se odkáže stav S11. */
  userName: string;
};

function notFound(instance: string) {
  return {
    type: 'https://docs.mlain.dev/errors/not_found',
    title: 'Not found',
    status: 404,
    detail: '',
    instance,
    code: 'not_found',
    request_id: '',
  };
}

/**
 * Přeloží slug z URL na workspace a roli aktéra. Nečlen dostane 404, ne 403,
 * podle 3.4 části 1: kdyby dostal 403, dalo by se z toho zjistit, které
 * projekty existují.
 */
export const getWorkspaceAccess = cache(async (slug: string): Promise<Result<WorkspaceAccess>> => {
  const me = await getCurrentUser();
  if (!me.ok) return err(me.problem);

  const membership = me.data.memberships.find((entry) => entry.workspace_slug === slug);
  if (!membership) return err(notFound(`/w/${slug}`));

  const workspace = await apiFetch<Workspace>(`/api/v1/workspaces/${membership.workspace_id}`, {
    workspaceId: membership.workspace_id,
  });
  if (!workspace.ok) return err(workspace.problem);

  return ok({
    workspace: workspace.data,
    role: membership.role,
    permissions: permissionsOf(membership.role),
    userName: me.data.user.name === '' ? me.data.user.email : me.data.user.name,
  });
});

export function hasPermission(access: WorkspaceAccess, permission: Permission): boolean {
  return can(access.role, permission);
}

export { localProblem };
```

- [ ] **Krok 8: Napiš test na `workspace-access`**

`apps/web/src/lib/identity/workspace-access.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('@/lib/api-client/fetch', () => ({ apiFetch }));

const getCurrentUser = vi.fn();
vi.mock('./current-user', () => ({ getCurrentUser }));

const { getWorkspaceAccess, hasPermission } = await import('./workspace-access');

const WORKSPACE = {
  id: 'ws1',
  name: 'E-shop Kolo',
  slug: 'eshop-kolo',
  locale: 'cs',
  timezone: 'Europe/Prague',
  address_form: 'formal' as const,
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('getWorkspaceAccess', () => {
  it('vrátí projekt, roli a odvozená oprávnění', async () => {
    getCurrentUser.mockResolvedValue({
      ok: true,
      data: {
        user: { id: 'u1', name: 'Jana Nováková', email: 'jana@firma.cz', locale: 'cs', timezone: 'Europe/Prague' },
        memberships: [
          { workspace_id: 'ws1', workspace_slug: 'eshop-kolo', workspace_name: 'E-shop Kolo', role: 'admin' },
        ],
        csrf_token: 'c',
      },
    });
    apiFetch.mockResolvedValue({ ok: true, data: WORKSPACE });

    const result = await getWorkspaceAccess('eshop-kolo');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.role).toBe('admin');
      expect(hasPermission(result.data, 'api_keys:read')).toBe(true);
      expect(hasPermission(result.data, 'backups:read')).toBe(false);
      expect(result.data.userName).toBe('Jana Nováková');
    }
  });

  it('nečlenovi vrátí 404, ne 403', async () => {
    getCurrentUser.mockResolvedValue({
      ok: true,
      data: { user: { id: 'u1', name: '', email: 'x@y.cz', locale: 'cs', timezone: 'UTC' }, memberships: [], csrf_token: 'c' },
    });
    const result = await getWorkspaceAccess('cizi-projekt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.status).toBe(404);
      expect(result.problem.code).toBe('not_found');
    }
  });

  it('chybu z /auth/me propustí beze změny', async () => {
    getCurrentUser.mockResolvedValue({
      ok: false,
      problem: { status: 503, code: 'service_unavailable', request_id: '', type: '', title: '', detail: '', instance: '' },
    });
    const result = await getWorkspaceAccess('eshop-kolo');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.code).toBe('service_unavailable');
  });

  it('u uživatele bez jména použije e-mail', async () => {
    getCurrentUser.mockResolvedValue({
      ok: true,
      data: {
        user: { id: 'u1', name: '', email: 'petr@firma.cz', locale: 'cs', timezone: 'Europe/Prague' },
        memberships: [{ workspace_id: 'ws1', workspace_slug: 'eshop-kolo', workspace_name: 'E', role: 'owner' }],
        csrf_token: 'c',
      },
    });
    apiFetch.mockResolvedValue({ ok: true, data: WORKSPACE });
    const result = await getWorkspaceAccess('eshop-kolo');
    if (result.ok) expect(result.data.userName).toBe('petr@firma.cz');
  });
});
```

- [ ] **Krok 9: Spusť celý adresář a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/identity/`
Expected: PASS, `Tests  14 passed (14)`.

- [ ] **Krok 10: Commit**

```bash
git add apps/web/src/lib/identity
git commit -m "feat(web): server side identity helpers, permission contract test"
```

---

### Úkol 10: Katalogy `auth` a `settings` v češtině a angličtině

**Soubory:**
- Create: `packages/i18n/messages/cs/auth.json`
- Create: `packages/i18n/messages/en/auth.json`
- Create: `packages/i18n/messages/cs/settings.json`
- Create: `packages/i18n/messages/en/settings.json`
- Create: `apps/web/src/lib/i18n/catalog.test.ts`

Katalogy vznikají **před obrazovkami**, ne po nich. Důvod: obrazovka psaná bez katalogu skončí s literály v JSX a ty se pak dohledávají ručně.

**Co je závazné a co ne.** Podle 7.3 a 10.3 části 6 je závazná **struktura** (prázdný stav má vysvětlení a primární akci, hláška má nadpis, vysvětlení a akci) a **pravidla psaní** z kapitol 9 a 10. Konkrétní znění vět je referenční první verze a od chvíle, kdy je v katalogu, je zdrojem pravdy katalog. Výjimka: šest textů prázdných stavů a pět klíčových hlášek z 5.3 části 1 se přebírá **doslova**, protože je zadání označuje za hotové.

**Poznámka ke slovníku.** Závazný termín pro API klíč je podle 9.2 části 6 „Klíč k API", a tak se jmenuje sekce i navigace. Text prázdného stavu z 5.3 části 1 mluví o „API klíči" a přebírá se doslova; rozpor je jen zdánlivý, protože zakázané výrazy ve slovníku jsou „token" a „přístupový klíč", ne „API klíč".

- [ ] **Krok 1: Napiš `packages/i18n/messages/cs/auth.json`**

```json
{
  "shared": {
    "email": "E-mail",
    "selectPlaceholder": "Vyberte",
    "password": "Heslo",
    "newPassword": "Nové heslo",
    "fullName": "Jméno a příjmení",
    "backToLogin": "Zpět na přihlášení",
    "showPassword": "Zobrazit heslo",
    "hidePassword": "Skrýt heslo",
    "formErrorsSummary": "Formulář se nepodařilo odeslat. {count, plural, =0 {Zkuste to prosím znovu.} one {Opravte # pole níž.} few {Opravte # pole níž.} many {Opravte # pole níž.} other {Opravte # polí níž.}}"
  },
  "passwordRules": {
    "hint": "Aspoň 12 znaků. Dlouhé heslo je bezpečnější než složité.",
    "tooShort": "Heslo musí mít aspoň 12 znaků. {count, plural, =0 {Pole je zatím prázdné.} one {Zadali jste # znak.} few {Zadali jste # znaky.} many {Zadali jste # znaku.} other {Zadali jste # znaků.}}",
    "tooLong": "Heslo může mít nejvýš 256 znaků.",
    "tooCommon": "Tohle heslo patří mezi deset tisíc nejpoužívanějších. Zvolte jiné.",
    "containsEmail": "Heslo nesmí obsahovat část vaší e-mailové adresy."
  },
  "setup": {
    "title": "Založte si účet a první projekt",
    "lead": "Instalace zatím nemá žádného uživatele. Vytvořte účet správce a první projekt, zabere to minutu.",
    "workspaceName": "Název projektu",
    "workspaceHint": "Projekt je oddělený prostor s vlastními kontakty, kampaněmi a klíči. Později jich můžete mít víc.",
    "locale": "Jazyk rozhraní",
    "submit": "Založit účet a projekt",
    "submitting": "Zakládáme účet a projekt"
  },
  "login": {
    "title": "Přihlášení",
    "lead": "Zadejte e-mail a heslo, se kterými vás do nástroje pozvali.",
    "submit": "Přihlásit se",
    "submitting": "Přihlašujeme vás",
    "forgotLink": "Zapomněli jste heslo?",
    "unlockAt": "Zkuste to znovu {time}."
  },
  "forgot": {
    "title": "Zapomenuté heslo",
    "lead": "Zadejte e-mail a pošleme vám odkaz na nastavení nového hesla. Odkaz platí 60 minut.",
    "submit": "Poslat odkaz",
    "submitting": "Odesíláme odkaz",
    "sentTitle": "Odkaz je na cestě",
    "sentBody": "Pokud u nás účet s touhle adresou existuje, poslali jsme na ni odkaz na nastavení nového hesla. Odkaz platí 60 minut. Odpověď je stejná i pro adresu, kterou neznáme, aby z ní nešlo zjistit, kdo tu účet má."
  },
  "reset": {
    "title": "Nastavení nového hesla",
    "lead": "Zadejte nové heslo. Po jeho uložení vás odhlásíme ze všech ostatních zařízení.",
    "submit": "Nastavit nové heslo",
    "submitting": "Ukládáme heslo",
    "doneTitle": "Heslo je nastavené",
    "doneBody": "Ostatní relace jsme kvůli bezpečnosti ukončili. Přihlaste se novým heslem.",
    "invalidTitle": "Odkaz už neplatí",
    "invalidBody": "Odkaz na nastavení hesla platí 60 minut a dá se použít jednou. Ten váš je starší, nebo už byl použitý. Vyžádejte si nový.",
    "invalidAction": "Vyžádat nový odkaz"
  },
  "invitation": {
    "loading": "Ověřujeme pozvánku",
    "title": "Pozvánka do projektu {projectName}",
    "leadSignedIn": "Jste přihlášení jako {email}. Přijetím pozvánky získáte v projektu {projectName} roli {role}.",
    "leadSignedOut": "Přihlaste se nebo si založte účet a pozvánku pak přijmete.",
    "accept": "Přijmout pozvánku",
    "accepting": "Přijímáme pozvánku",
    "signIn": "Přihlásit se a přijmout",
    "invalidTitle": "Pozvánka už neplatí",
    "invalidBody": "Pozvánka platí 7 dní a dá se použít jednou. Ta vaše je starší, byla zrušená, nebo už ji někdo přijal. Požádejte o novou toho, kdo vás zval.",
    "invalidAction": "Přejít na přihlášení",
    "doneTitle": "Jste v projektu {projectName}",
    "doneAction": "Otevřít projekt",
    "otherEmailNote": "Pozvánka přišla na adresu {invitedEmail}, přihlášení jste jako {email}. Přijmout ji můžete i tak, do záznamu si poznamenáme obě adresy."
  },
  "noWorkspace": {
    "title": "Nemáte přístup k žádnému projektu",
    "body": "Nemáte přístup k žádnému projektu. Požádejte o pozvánku, nebo si založte vlastní.",
    "create": "Založit projekt",
    "creating": "Zakládáme projekt",
    "workspaceName": "Název projektu",
    "refresh": "Zkontrolovat znovu",
    "signOut": "Odhlásit se"
  },
  "errorBlock": {
    "retry": "Zkusit znovu",
    "requestId": "Číslo požadavku",
    "copy": "Zkopírovat",
    "copyAll": "Zkopírovat vše",
    "copied": "Zkopírováno",
    "detailsSummary": "Technické detaily",
    "code": "Kód",
    "time": "Čas",
    "path": "Cesta"
  },
  "errors": {
    "invalidCredentials": {
      "title": "E-mail nebo heslo nesedí",
      "body": "Zkontrolujte, jestli v adrese není překlep a jestli nemáte zapnutý Caps Lock. Když si heslo nepamatujete, nechte si poslat odkaz na nové."
    },
    "accountLocked": {
      "title": "Účet jsme dočasně zamkli",
      "body": "Po deseti neúspěšných pokusech účet na 15 minut zamykáme, aby heslo nešlo uhodnout zkoušením. Až čas uplyne, zkuste to znovu, nebo si mezitím nastavte nové heslo."
    },
    "rateLimited": {
      "title": "Zkoušíte to příliš často",
      "body": "Z vaší adresy přišlo za krátkou dobu moc pokusů. Počkejte {seconds, plural, =0 {chvíli} one {# sekundu} few {# sekundy} many {# sekundy} other {# sekund}} a zkuste to znovu."
    },
    "unauthenticated": {
      "title": "Nejste přihlášení",
      "body": "Tahle stránka je jen pro přihlášené. Přihlaste se a vrátíme vás tam, kam jste mířili."
    },
    "sessionExpired": {
      "title": "Byli jste odhlášeni",
      "body": "Kvůli neaktivitě jsme vás z bezpečnostních důvodů odhlásili. Přihlaste se prosím znovu, o rozdělanou práci nepřijdete."
    },
    "setupAlreadyCompleted": {
      "title": "Instalace už je nastavená",
      "body": "První účet tu někdo založil dřív. Přihlaste se, nebo požádejte o pozvánku."
    },
    "validationFailed": {
      "title": "Formulář se nepodařilo odeslat",
      "body": "U polí níž jsme popsali, co je potřeba opravit."
    },
    "notFound": {
      "title": "Tuhle stránku neznáme",
      "body": "Odkaz může být starý nebo v něm chybí znak. Zkuste se přihlásit a začít znovu."
    },
    "gone": {
      "title": "Odkaz už neplatí",
      "body": "Platnost odkazu vypršela. Vyžádejte si nový."
    },
    "serviceUnavailable": {
      "title": "Server neodpovídá",
      "body": "Nepodařilo se nám spojit se serverem nástroje. Většinou je to přechodné a druhý pokus projde."
    },
    "dependencyTimeout": {
      "title": "Server odpovídal moc dlouho",
      "body": "Požadavek jsme přerušili, protože trval déle než 10 sekund. Zkuste to znovu."
    },
    "internalError": {
      "title": "Něco se nepovedlo",
      "body": "Chyba je na naší straně. Zkuste to znovu a když se to bude opakovat, pošlete podpoře číslo požadavku níž."
    },
    "fallback": {
      "title": "Něco se nepovedlo",
      "body": "Popis chyby ze serveru je pod tímhle textem. Když si s ní nevíte rady, pošlete podpoře číslo požadavku."
    }
  }
}
```

- [ ] **Krok 2: Napiš `packages/i18n/messages/en/auth.json`**

```json
{
  "shared": {
    "email": "Email",
    "selectPlaceholder": "Select",
    "password": "Password",
    "newPassword": "New password",
    "fullName": "Full name",
    "backToLogin": "Back to sign in",
    "showPassword": "Show password",
    "hidePassword": "Hide password",
    "formErrorsSummary": "We couldn't submit the form. {count, plural, =0 {Please try again.} one {Fix # field below.} other {Fix # fields below.}}"
  },
  "passwordRules": {
    "hint": "At least 12 characters. A long password beats a complicated one.",
    "tooShort": "The password needs at least 12 characters. {count, plural, =0 {The field is still empty.} one {You entered # character.} other {You entered # characters.}}",
    "tooLong": "The password can have at most 256 characters.",
    "tooCommon": "This password is among the ten thousand most common ones. Pick another.",
    "containsEmail": "The password can't contain part of your email address."
  },
  "setup": {
    "title": "Create your account and first project",
    "lead": "This installation has no users yet. Create the admin account and the first project, it takes a minute.",
    "workspaceName": "Project name",
    "workspaceHint": "A project is a separate space with its own contacts, campaigns, and keys. You can have several later.",
    "locale": "Interface language",
    "submit": "Create account and project",
    "submitting": "Creating your account and project"
  },
  "login": {
    "title": "Sign in",
    "lead": "Enter the email and password you were invited with.",
    "submit": "Sign in",
    "submitting": "Signing you in",
    "forgotLink": "Forgot your password?",
    "unlockAt": "Try again at {time}."
  },
  "forgot": {
    "title": "Forgotten password",
    "lead": "Enter your email and we'll send a link that sets a new password. The link works for 60 minutes.",
    "submit": "Send the link",
    "submitting": "Sending the link",
    "sentTitle": "The link is on its way",
    "sentBody": "If an account with this address exists, we've sent it a link to set a new password. The link works for 60 minutes. We answer the same way for addresses we don't know, so nobody can find out who has an account here."
  },
  "reset": {
    "title": "Set a new password",
    "lead": "Enter a new password. Once you save it, we'll sign you out of every other device.",
    "submit": "Set the new password",
    "submitting": "Saving the password",
    "doneTitle": "Your password is set",
    "doneBody": "We ended the other sessions for safety. Sign in with the new password.",
    "invalidTitle": "This link no longer works",
    "invalidBody": "A password link works for 60 minutes and can be used once. Yours is older, or it has already been used. Ask for a new one.",
    "invalidAction": "Request a new link"
  },
  "invitation": {
    "loading": "Checking the invitation",
    "title": "Invitation to the {projectName} project",
    "leadSignedIn": "You're signed in as {email}. Accepting gives you the {role} role in the {projectName} project.",
    "leadSignedOut": "Sign in or create an account, then accept the invitation.",
    "accept": "Accept the invitation",
    "accepting": "Accepting the invitation",
    "signIn": "Sign in and accept",
    "invalidTitle": "This invitation no longer works",
    "invalidBody": "An invitation works for 7 days and can be used once. Yours is older, was revoked, or someone has already accepted it. Ask the person who invited you for a new one.",
    "invalidAction": "Go to sign in",
    "doneTitle": "You're in the {projectName} project",
    "doneAction": "Open the project",
    "otherEmailNote": "The invitation went to {invitedEmail} and you're signed in as {email}. You can still accept it, we'll record both addresses."
  },
  "noWorkspace": {
    "title": "You have no access to any project",
    "body": "You have no access to any project. Ask for an invitation or create your own.",
    "create": "Create a project",
    "creating": "Creating the project",
    "workspaceName": "Project name",
    "refresh": "Check again",
    "signOut": "Sign out"
  },
  "errorBlock": {
    "retry": "Try again",
    "requestId": "Request number",
    "copy": "Copy",
    "copyAll": "Copy everything",
    "copied": "Copied",
    "detailsSummary": "Technical details",
    "code": "Code",
    "time": "Time",
    "path": "Path"
  },
  "errors": {
    "invalidCredentials": {
      "title": "That email and password don't match",
      "body": "Check the address for typos and make sure Caps Lock is off. If you can't recall the password, have us send a link for a new one."
    },
    "accountLocked": {
      "title": "We locked the account for a while",
      "body": "After ten failed attempts we lock an account for 15 minutes so nobody can guess the password. Try again once the time is up, or set a new password meanwhile."
    },
    "rateLimited": {
      "title": "You're trying too often",
      "body": "Too many attempts came from your address in a short time. Wait {seconds, plural, =0 {a moment} one {# second} other {# seconds}} and try again."
    },
    "unauthenticated": {
      "title": "You're not signed in",
      "body": "This page is for signed-in people only. Sign in and we'll take you where you were heading."
    },
    "sessionExpired": {
      "title": "You've been signed out",
      "body": "We signed you out after a period of inactivity for security reasons. Sign in again, your work in progress is safe."
    },
    "setupAlreadyCompleted": {
      "title": "This installation is already set up",
      "body": "Someone created the first account earlier. Sign in, or ask for an invitation."
    },
    "validationFailed": {
      "title": "We couldn't submit the form",
      "body": "We've described what needs fixing next to the fields below."
    },
    "notFound": {
      "title": "We don't know this page",
      "body": "The link may be old or missing a character. Try signing in and starting again."
    },
    "gone": {
      "title": "This link no longer works",
      "body": "The link has expired. Request a new one."
    },
    "serviceUnavailable": {
      "title": "The server isn't responding",
      "body": "We couldn't reach the tool's server. This is usually temporary and a second attempt goes through."
    },
    "dependencyTimeout": {
      "title": "The server took too long",
      "body": "We stopped the request because it ran longer than 10 seconds. Try again."
    },
    "internalError": {
      "title": "Something went wrong",
      "body": "The fault is on our side. Try again, and if it keeps happening, send support the request number below."
    },
    "fallback": {
      "title": "Something went wrong",
      "body": "The server's description of the error is below. If it doesn't help, send support the request number."
    }
  }
}
```

- [ ] **Krok 3: Napiš `packages/i18n/messages/cs/settings.json`**

```json
{
  "nav": {
    "sectionLabel": "Nastavení",
    "general": "Projekt",
    "members": "Tým",
    "apiKeys": "Klíče k API",
    "webhooks": "Webhooky",
    "audit": "Audit log",
    "account": "Můj účet"
  },
  "shared": {
    "save": "Uložit",
    "backToOverview": "Zpět na přehled projektu",
    "selectPlaceholder": "Vyberte",
    "showPassword": "Zobrazit heslo",
    "hidePassword": "Skrýt heslo",
    "saving": "Ukládáme",
    "saved": "Uloženo",
    "saveFailed": "Nepodařilo se uložit, zkoušíme to znovu",
    "cancel": "Zrušit",
    "close": "Zavřít",
    "tryAgain": "Zkusit znovu",
    "refresh": "Obnovit",
    "createdAt": "Vytvořeno",
    "lastUsedAt": "Naposledy použito",
    "never": "Nikdy",
    "copy": "Zkopírovat",
    "copied": "Zkopírováno",
    "loadingMore": "Načítáme další",
    "previousPage": "Předchozí",
    "nextPage": "Další",
    "countExact": "{count, plural, =0 {Žádná položka} one {# položka} few {# položky} many {# položky} other {# položek}}",
    "countEstimated": "asi {count, number} položek",
    "cursorDropped": "Odkaz na stránku výsledků už neplatí, protože se data mezitím změnila. Ukazujeme první stránku stejného filtru.",
    "filtersApplied": "Filtr: {summary}",
    "clearFilters": "Zrušit filtry",
    "role": {
      "owner": "Vlastník",
      "admin": "Správce",
      "editor": "Editor",
      "viewer": "Prohlížející"
    }
  },
  "jobs": {
    "title": "Úloha",
    "progress": "Hotovo {done} z {total}",
    "startedBy": "Spustil {person}",
    "startedAt": "Začátek",
    "finishedAt": "Konec",
    "notFoundTitle": "Tuhle úlohu neznáme",
    "notFoundBody": "Úloha buď nikdy neexistovala, nebo je starší, než co si pamatujeme. Přehled projektu ukazuje ty, které běží.",
    "status": {
      "running": "Běží",
      "paused": "Pozastaveno",
      "completed": "Hotovo",
      "completedWithErrors": "Hotovo, ale s chybami",
      "failed": "Selhalo",
      "cancelled": "Zrušeno"
    }
  },
  "confirm": {
    "irreversible": "Tuhle akci nejde vzít zpět.",
    "whatHappens": "Co se stane",
    "notYetConfirmed": "Ještě jste nezaškrtli potvrzení nad tlačítkem.",
    "notYetTyped": "Opsaný text se zatím neshoduje. Zkontrolujte ho, prosím, znak po znaku.",
    "typeToConfirmMismatch": "Opsaný text se neshoduje.",
    "filterInWords": "Týká se to výběru: {filter}"
  },
  "states": {
    "forbiddenTitle": "Na tuhle část nemáte oprávnění",
    "forbiddenBody": "Sekce vyžaduje oprávnění {permission}, které mají role {roles}. Vy máte roli {currentRole}.",
    "forbiddenWhoCanHelp": "Roli vám může změnit vlastník nebo správce projektu.",
    "forbiddenWhoCanHelpNamed": "Roli vám může změnit {name}.",
    "forbiddenBack": "Zpět na přehled projektu",
    "notFoundTitle": "Tuhle položku jsme nenašli",
    "notFoundBody": "Mohla být smazaná, nebo máte starý odkaz.",
    "notFoundBack": "Zpět na seznam",
    "offlineTitle": "Ztratili jsme spojení",
    "loadingLabel": "Načítáme",
    "offlineBody": "Ztratili jsme spojení. Zkoušíme se připojit. Vaše změny se uloží, jakmile se to podaří.",
    "staleTitle": "Naposledy aktualizováno {time}",
    "staleBody": "Obnovení se nepodařilo, ukazujeme starší čísla.",
    "readOnlyTitle": "Tuhle sekci můžete jen prohlížet",
    "readOnlyBody": "Vaše role {currentRole} nemá oprávnění {permission}, takže hodnoty vidíte jako text a nejdou upravit.",
    "partialTitle": "Část stránky se nenačetla",
    "loading": "Načítáme"
  },
  "profile": {
    "title": "Můj účet",
    "lead": "Údaje, které platí napříč všemi projekty.",
    "identity": {
      "title": "Osobní údaje",
      "name": "Jméno a příjmení",
      "nameHint": "Jméno vidí ostatní členové projektu u vašich akcí v audit logu.",
      "email": "E-mail",
      "emailHint": "E-mail slouží k přihlášení a měnit se zatím nedá.",
      "locale": "Jazyk rozhraní",
      "timezone": "Časová zóna",
      "timezoneHint": "Podle zóny zobrazujeme časy v celém nástroji.",
      "saved": "Uloženo"
    },
    "password": {
      "title": "Změna hesla",
      "lead": "Po změně hesla vás odhlásíme ze všech ostatních zařízení. Tahle karta zůstane přihlášená.",
      "current": "Současné heslo",
      "next": "Nové heslo",
      "submit": "Změnit heslo",
      "submitting": "Měníme heslo",
      "doneTitle": "Heslo je změněné",
      "doneBody": "Ostatní relace jsme ukončili. Na dalších zařízeních se budete muset přihlásit znovu."
    },
    "sessions": {
      "title": "Aktivní relace",
      "lead": "Zařízení a prohlížeče, ze kterých jste přihlášení.",
      "thisSession": "Tato relace",
      "device": "Zařízení",
      "ip": "IP adresa",
      "lastUsed": "Naposledy použito",
      "signedInAt": "Přihlášeno",
      "revoke": "Odhlásit toto zařízení",
      "revoked": "Zařízení jsme odhlásili",
      "revokeFailed": "Zařízení se nepodařilo odhlásit. Zkuste to prosím znovu.",
      "logoutAll": "Odhlásit ze všech zařízení",
      "logoutAllDialogTitle": "Odhlásit ze všech zařízení včetně tohoto?",
      "logoutAllConsequence": "{count, plural, =0 {Neukončíme žádnou relaci, protože žádná další neběží.} one {Ukončíme # relaci, tuhle kartu nevyjímaje.} few {Ukončíme # relace, tuhle kartu nevyjímaje.} many {Ukončíme # relace, tuhle kartu nevyjímaje.} other {Ukončíme # relací, tuhle kartu nevyjímaje.}}",
      "logoutAllConsequenceWork": "Rozepsané formuláře na jiných zařízeních se ztratí.",
      "logoutAllConfirm": "Odhlásit ze všech zařízení",
      "logoutAllCancel": "Nechat přihlášené",
      "empty": "Jste přihlášení jen tady. Jakmile se přihlásíte z dalšího zařízení, uvidíte ho v tomhle seznamu.",
      "emptyAction": "Načíst seznam znovu",
      "unknownDevice": "Neznámé zařízení"
    }
  },
  "general": {
    "title": "Projekt",
    "lead": "Název, adresa a výchozí hodnoty projektu {projectName}.",
    "name": "Název projektu",
    "slug": "Adresa projektu",
    "slugHint": "Používá se v odkazech: /w/{slug}. Malá písmena, číslice a pomlčky.",
    "slugChangeWarning": "Změna adresy rozbije odkazy, které jste už poslali kolegům.",
    "locale": "Jazyk projektu",
    "localeHint": "Jazyk systémových e-mailů a veřejných stránek pro příjemce.",
    "timezone": "Časová zóna projektu",
    "timezoneHint": "V téhle zóně se plánují kampaně a počítají reporty.",
    "addressForm": {
      "label": "Oslovení v e-mailech",
      "hint": "Týká se e-mailů, které posíláte kontaktům. Rozhraní nástroje vám vyká vždy.",
      "formal": "Vykání",
      "formalExample": "Dobrý den, Jano,",
      "informal": "Tykání",
      "informalExample": "Ahoj Jano,",
      "dialogTitle": "Přepnout oslovení na {target}?",
      "dialogConsequence1": "{count, plural, =0 {Nepřepočítáme 5. pád u žádného kontaktu, databáze je zatím prázdná.} one {Přepočítáme 5. pád u # kontaktu.} few {Přepočítáme 5. pád u # kontaktů.} many {Přepočítáme 5. pád u # kontaktu.} other {Přepočítáme 5. pád u # kontaktů.}}",
      "dialogConsequence2": "Přepočet běží na pozadí, u velké databáze trvá jednotky minut.",
      "dialogConsequence3": "Kampaně rozeslané v minulosti se nemění.",
      "dialogConfirm": "Přepnout na {target}",
      "dialogCancel": "Nechat {current}",
      "started": "Oslovení jsme přepnuli a přepočítáváme kontakty."
    },
    "danger": {
      "title": "Smazání projektu",
      "body": "Smazání odstraní všechny kontakty, kampaně i statistiky. Obnovit to jde 30 dní. Pro potvrzení opište název projektu.",
      "button": "Smazat projekt",
      "dialogTitle": "Smazat projekt {name}?",
      "consequence1": "Zmizí všechny kontakty, seznamy, segmenty a štítky.",
      "consequence2": "Zmizí všechny kampaně, šablony a jejich statistiky.",
      "consequence3": "Klíče k API a webhooky projektu okamžitě přestanou fungovat.",
      "consequence4": "Rozeslané e-maily se nevrátí, ale rozesílka, která běží, se zastaví.",
      "restoreNote": "Projekt jde obnovit 30 dní. Potom se smaže natrvalo a obnovit už nepůjde.",
      "confirmLabel": "Pro potvrzení opište název projektu",
      "confirm": "Smazat projekt {name}",
      "cancel": "Nechat projekt",
      "onlyOwner": "Smazat projekt může jen vlastník."
    }
  },
  "members": {
    "title": "Tým",
    "lead": "Kdo má do projektu přístup a co smí.",
    "empty": "V projektu jste zatím sami. Pozvěte kolegy a určete, co smí.",
    "emptyAction": "Pozvat kolegu",
    "emptyNoPermission": "Zvát kolegy může Správce a Vlastník. Vaše role na to oprávnění nemá.",
    "table": {
      "person": "Člen projektu",
      "role": "Role",
      "joinedAt": "V projektu od",
      "actions": "Akce"
    },
    "roleDescription": {
      "owner": "Vidí a mění všechno včetně záloh, smazání a předání projektu.",
      "admin": "Vidí a mění všechno kromě záloh, smazání a předání projektu.",
      "editor": "Tvoří kontakty, šablony a kampaně a odesílá je. Nevidí klíče, audit ani export kontaktů.",
      "viewer": "Vidí kontakty, kampaně a reporty. Nic nemění."
    },
    "changeRole": {
      "label": "Role člena {name}",
      "done": "Role člena {name} je teď {role}.",
      "undo": "Vrátit zpět",
      "failed": "Roli se nepodařilo změnit. Vrátili jsme původní hodnotu.",
      "lastOwner": "Poslední vlastník musí zůstat. Nejdřív předejte vlastnictví někomu jinému."
    },
    "remove": {
      "button": "Odebrat z projektu",
      "dialogTitle": "Odebrat {name} z projektu?",
      "consequence1": "Ztratí přístup ke všem kontaktům, kampaním a reportům projektu.",
      "consequence2": "To, co v projektu vytvořil, zůstává.",
      "consequence3": "Zpět se dostane jen novou pozvánkou, kterou musí přijmout.",
      "confirm": "Odebrat {name}",
      "cancel": "Nechat v projektu",
      "done": "{name} už v projektu není."
    },
    "invitations": {
      "title": "Čekající pozvánky",
      "empty": "Žádná pozvánka nečeká na přijetí.",
      "emptyAction": "Napsat e-mail kolegy",
      "email": "E-mail",
      "role": "Role",
      "invitedBy": "Pozval",
      "expiresAt": "Platí do",
      "revoke": "Zrušit pozvánku",
      "revoked": "Pozvánka pro {email} je zrušená.",
      "reinvite": "Pozvat znovu",
      "limitTitle": "Víc pozvánek naráz poslat nejde",
      "limitBody": "V projektu čeká 100 pozvánek, což je maximum. Zrušte některou z nich, nebo počkejte, až je lidé přijmou."
    },
    "invite": {
      "button": "Pozvat kolegu",
      "title": "Pozvat kolegu do projektu",
      "lead": "Pošleme mu odkaz, který platí 7 dní.",
      "email": "E-mail kolegy",
      "role": "Role",
      "submit": "Poslat pozvánku",
      "submitting": "Odesíláme pozvánku",
      "done": "Pozvánku jsme poslali na {email}.",
      "alreadyMember": "{email} už v projektu je. Roli mu můžete změnit v seznamu členů.",
      "alreadyInvited": "Pozvánku na {email} jsme poslali znovu, ta předchozí přestala platit."
    }
  },
  "apiKeys": {
    "title": "Klíče k API",
    "lead": "Klíčem se k projektu připojí e-shop nebo vlastní aplikace.",
    "empty": "Zatím nemáte žádný API klíč. Klíč slouží k propojení e-shopu nebo vlastní aplikace.",
    "emptyAction": "Vytvořit klíč",
    "emptyNoPermission": "Klíče k API zakládá Správce a Vlastník. Vaše role na to oprávnění nemá.",
    "table": {
      "name": "Název",
      "prefix": "Klíč",
      "scopes": "Oprávnění",
      "createdBy": "Vytvořil",
      "lastUsedAt": "Naposledy použit",
      "status": "Stav",
      "actions": "Akce"
    },
    "status": {
      "active": "Aktivní",
      "revoked": "Zrušený",
      "expired": "Prošlý",
      "rotating": "Rotuje se, starý sekret platí do {time}"
    },
    "create": {
      "button": "Vytvořit klíč",
      "title": "Nový klíč k API",
      "lead": "Vyberte, co smí. Klíč nemá roli, platí přesně to, co mu tady zaškrtnete.",
      "name": "Název klíče",
      "nameHint": "Podle názvu poznáte, která aplikace klíč používá. Třeba „E-shop, objednávky\".",
      "scopes": "Oprávnění klíče",
      "scopesHint": "Zaškrtněte co nejmíň. Klíč, který smí všechno, je klíč, o kterém nikdo neví, co smí.",
      "submit": "Vytvořit klíč",
      "submitting": "Vytváříme klíč",
      "noScopeSelected": "Vyberte aspoň jedno oprávnění."
    },
    "secret": {
      "title": "Klíč je vytvořený",
      "warning": "Zkopírujte si sekret teď. Už ho nikdy neuvidíme ani my.",
      "label": "Celý klíč",
      "acknowledge": "Sekret mám uložený",
      "close": "Hotovo"
    },
    "rotate": {
      "button": "Rotovat sekret",
      "panelCancel": "Zpět na seznam klíčů",
      "dialogTitle": "Rotovat sekret klíče {name}?",
      "consequence1": "Vygenerujeme nový sekret a ukážeme ho jednou.",
      "consequence2": "Aplikace, které používají starý sekret, přestanou fungovat, jakmile doběhne přechodné období: {grace}.",
      "consequence3": "Oprávnění klíče se nemění.",
      "graceLabel": "Přechodné období pro starý sekret",
      "graceHint": "Po tuhle dobu platí starý i nový sekret naráz. Nula znamená, že starý přestane platit okamžitě.",
      "graceOptions": {
        "none": "Bez přechodného období",
        "hour": "1 hodina",
        "day": "24 hodin"
      },
      "acknowledge": "Rozumím, že starý sekret přestane platit",
      "confirm": "Rotovat sekret",
      "cancel": "Nechat současný sekret",
      "done": "Sekret je vyměněný."
    },
    "revoke": {
      "button": "Zrušit klíč",
      "dialogTitle": "Zrušit klíč {name}?",
      "consequence1": "Aplikace, které klíč používají, přestanou fungovat okamžitě.",
      "consequence2": "Zrušený klíč zůstane v seznamu, aby audit dával smysl. Obnovit ho nejde.",
      "consequence3": "Naposledy byl použit {lastUsed}.",
      "acknowledge": "Rozumím, že zrušený klíč už nepůjde obnovit",
      "confirm": "Zrušit klíč {name}",
      "cancel": "Nechat klíč",
      "done": "Klíč {name} je zrušený."
    }
  },
  "webhooks": {
    "title": "Webhooky",
    "lead": "Webhook pošle událost na vaši adresu, jakmile se v projektu něco stane.",
    "empty": "Žádný webhook. Webhook pošle událost na vaši adresu, jakmile se něco stane.",
    "emptyAfterDelete": "Všechny webhooky jste smazali. Nový vytvoříte tlačítkem níž.",
    "emptyAction": "Přidat webhook",
    "emptyNoPermission": "Webhooky přidává Správce a Vlastník. Vaše role na to oprávnění nemá.",
    "limitTitle": "Víc webhooků přidat nejde",
    "limitBody": "V projektu je 20 webhooků, což je maximum. Smažte některý, než přidáte další.",
    "table": {
      "url": "Adresa",
      "events": "Události",
      "status": "Stav",
      "lastDelivery": "Poslední doručení",
      "actions": "Akce"
    },
    "status": {
      "active": "Aktivní",
      "disabled": "Vypnutý",
      "failing": "{count, plural, =0 {Selhává} one {Selhává, # neúspěch po sobě} few {Selhává, # neúspěchy po sobě} many {Selhává, # neúspěchu po sobě} other {Selhává, # neúspěchů po sobě}}"
    },
    "disabled": {
      "title": "Váš webhook jsme vypnuli",
      "body": "Váš webhook jsme vypnuli po 20 neúspěšných pokusech. Opravte cíl a zapněte ho znovu.",
      "detail": "Adresa {url} odpovídá chybou {lastStatus} od {since}. Po dvaceti neúspěšných pokusech jsme posílání zastavili, aby se fronta nezaplnila.",
      "replayNote": "Při zapnutí nabídneme přehrání událostí za posledních 24 hodin. Co je starší, se doposlat nedá.",
      "showErrors": "Zobrazit poslední chyby",
      "enable": "Zapnout znovu",
      "enabling": "Zapínáme webhook",
      "enabled": "Webhook je znovu zapnutý."
    },
    "form": {
      "createTitle": "Nový webhook",
      "editTitle": "Úprava webhooku",
      "url": "Adresa, kam události posílat",
      "urlHint": "Jen https. Na privátní adresy a na adresy v místní síti neposíláme.",
      "description": "Popis",
      "descriptionHint": "K čemu webhook slouží. Uvidí ho kolegové v seznamu.",
      "events": "Které události posílat",
      "eventsHint": "Vyberte aspoň jednu, nejvýš 50.",
      "submit": "Vytvořit webhook",
      "submitting": "Vytváříme webhook",
      "saveSubmit": "Uložit změny",
      "duplicateNote": "Doručení je nejméně jednou. Když restartujeme worker uprostřed odesílání, událost může dorazit dvakrát. Rozlišujte ji podle hlavičky ML-Event-Id."
    },
    "secret": {
      "title": "Webhook je vytvořený",
      "warning": "Zkopírujte si podpisový sekret teď. Už ho nikdy neuvidíme ani my.",
      "hint": "Sekretem ověříte, že požadavek přišel opravdu od nás. Postup je v dokumentaci k hlavičce ML-Signature.",
      "acknowledge": "Sekret mám uložený",
      "close": "Hotovo"
    },
    "test": {
      "button": "Poslat testovací událost",
      "running": "Posíláme testovací událost",
      "slow": "Trvá to déle, než jsme čekali",
      "successTitle": "Testovací událost dorazila",
      "successBody": "Vaše adresa odpověděla {status} za {duration}.",
      "failureTitle": "Testovací událost neprošla",
      "failureBody": "Vaše adresa odpověděla {status}. Podrobnosti jsou v logu doručení níž."
    },
    "delete": {
      "button": "Smazat webhook",
      "dialogTitle": "Smazat webhook {url}?",
      "consequence1": "Události se na tuhle adresu přestanou posílat okamžitě.",
      "consequence2": "Log doručení zůstane 30 dní.",
      "confirm": "Smazat webhook",
      "cancel": "Nechat webhook",
      "done": "Webhook je smazaný."
    },
    "deliveries": {
      "title": "Log doručení",
      "lead": "Posledních 30 dní pokusů o doručení.",
      "empty": "Zatím jsme na tuhle adresu nic neposlali.",
      "emptyAction": "Načíst log znovu",
      "emptyFiltered": "Žádné doručení neodpovídá filtru.",
      "emptyFilteredBody": "Zkuste filtr rozvolnit, nebo ho zrušte a projděte celý log.",
      "table": {
        "eventType": "Událost",
        "status": "Výsledek",
        "attempt": "Pokus",
        "responseStatus": "Odpověď",
        "duration": "Trvání",
        "createdAt": "Kdy",
        "nextAttemptAt": "Další pokus"
      },
      "status": {
        "pending": "Čeká",
        "delivering": "Odesíláme",
        "succeeded": "Doručeno",
        "failed": "Nedoručeno",
        "abandoned": "Vzdali jsme to"
      },
      "errorCode": "Kód chyby",
      "responseSnippet": "Odpověď vaší adresy",
      "retry": "Zkusit doručit znovu",
      "retrying": "Doručujeme znovu",
      "retried": "Doručení jsme zařadili do fronty.",
      "blockedTarget": "Adresa vede do privátní sítě, takže jsme se na ni nepřipojili. Zkontrolujte, jestli se nezměnil DNS záznam."
    }
  },
  "audit": {
    "title": "Audit log",
    "lead": "Kdo v projektu co udělal. Záznamy se nedají mazat ani měnit.",
    "empty": "Zatím se nic nestalo.",
    "emptyAction": "Načíst záznamy znovu",
    "emptyFiltered": "Žádný záznam neodpovídá filtru.",
    "emptyFilteredBody": "Zkuste filtr rozvolnit, nebo ho zrušte a projděte celý audit log.",
    "retention": "Záznamy držíme 24 měsíců.",
    "table": {
      "when": "Kdy",
      "actor": "Kdo",
      "action": "Co",
      "target": "Čeho se to týkalo",
      "requestId": "Číslo požadavku"
    },
    "filters": {
      "action": "Akce",
      "actor": "Kdo",
      "from": "Od",
      "to": "Do",
      "allActions": "Všechny akce",
      "allActors": "Kdokoli",
      "apply": "Použít filtr"
    },
    "actorType": {
      "user": "Člen projektu",
      "apiKey": "Klíč k API",
      "system": "Nástroj"
    },
    "unknownAction": "Neznámá akce",
    "actions": {
      "user.login": "Přihlásil se",
      "user.login_failed": "Neúspěšné přihlášení",
      "user.logout": "Odhlásil se",
      "user.password_changed": "Změnil heslo",
      "user.password_reset_requested": "Vyžádal obnovu hesla",
      "user.password_reset_completed": "Dokončil obnovu hesla",
      "workspace.created": "Založil projekt",
      "workspace.updated": "Změnil nastavení projektu",
      "workspace.deleted": "Smazal projekt",
      "workspace.restored": "Obnovil projekt",
      "workspace.ownership_transferred": "Předal vlastnictví projektu",
      "member.invited": "Pozval člena",
      "member.invitation_revoked": "Zrušil pozvánku",
      "member.joined": "Přijal pozvánku",
      "member.role_changed": "Změnil roli člena",
      "member.removed": "Odebral člena",
      "api_key.created": "Vytvořil klíč k API",
      "api_key.rotated": "Rotoval sekret klíče",
      "api_key.revoked": "Zrušil klíč k API",
      "webhook_endpoint.created": "Vytvořil webhook",
      "webhook_endpoint.updated": "Upravil webhook",
      "webhook_endpoint.deleted": "Smazal webhook",
      "webhook_endpoint.disabled": "Webhook byl vypnutý",
      "backup.created": "Vytvořil zálohu",
      "backup.restored": "Obnovil ze zálohy",
      "settings.updated": "Změnil nastavení"
    }
  },
  "errorBlock": {
    "retry": "Zkusit znovu",
    "requestId": "Číslo požadavku",
    "copy": "Zkopírovat",
    "copyAll": "Zkopírovat vše",
    "copied": "Zkopírováno",
    "detailsSummary": "Technické detaily",
    "code": "Kód",
    "time": "Čas",
    "path": "Cesta"
  },
  "errors": {
    "forbidden": {
      "title": "Na tuhle akci nemáte oprávnění",
      "body": "Akce vyžaduje oprávnění {permission}, které mají role {roles}. Vy máte roli {currentRole}."
    },
    "insufficientScope": {
      "title": "Klíč na tuhle akci nestačí",
      "body": "Klíč, kterým se aplikace přihlásila, nemá oprávnění {permission}. Přidat ho nejde, vytvořte klíč nový."
    },
    "originNotAllowed": {
      "title": "Požadavek přišel odjinud",
      "body": "Adresa, ze které požadavek přišel, neodpovídá adrese nástroje. Znovu načtěte stránku a zkuste to znovu."
    },
    "csrfTokenInvalid": {
      "title": "Ochranný token neplatí",
      "body": "Stránka byla otevřená příliš dlouho. Znovu ji načtěte a akci zopakujte."
    },
    "sessionExpired": {
      "title": "Byli jste odhlášeni",
      "body": "Kvůli neaktivitě jsme vás z bezpečnostních důvodů odhlásili. Přihlaste se prosím znovu, o rozdělanou práci nepřijdete."
    },
    "notFound": {
      "title": "Tuhle položku jsme nenašli",
      "body": "Mohla být smazaná, nebo máte odkaz na položku z jiného projektu."
    },
    "conflict": {
      "title": "Mezitím se něco změnilo",
      "body": "Někdo jiný upravil tutéž věc dřív než vy. Načtěte stránku znovu a podívejte se na aktuální stav."
    },
    "alreadyExists": {
      "title": "Tohle už existuje",
      "body": "Položka se stejnou hodnotou už v projektu je. Zvolte jinou hodnotu."
    },
    "alreadyMember": {
      "title": "Tenhle člověk už v projektu je",
      "body": "Pozvánku posílat nemusíte. Roli mu můžete změnit přímo v seznamu členů."
    },
    "lastOwner": {
      "title": "Poslední vlastník musí zůstat",
      "body": "Projekt musí mít vždy právě jednoho vlastníka. Nejdřív předejte vlastnictví někomu jinému a potom akci zopakujte."
    },
    "idempotencyKeyReuse": {
      "title": "Formulář se odeslal se změněnými údaji",
      "body": "Rozpracovaný formulář se odeslal dvakrát a podruhé s jiným obsahem. Načtěte stránku znovu a vyplňte ji jednou."
    },
    "idempotencyInProgress": {
      "title": "Stejný požadavek už zpracováváme",
      "body": "Odeslali jste formulář dvakrát rychle za sebou. Počkejte pár sekund a podívejte se na výsledek."
    },
    "validationFailed": {
      "title": "Formulář se nepodařilo uložit",
      "body": "U polí níž jsme popsali, co je potřeba opravit."
    },
    "tooManyItems": {
      "title": "Položek je moc",
      "body": "Vybrali jste víc položek, než kolik jich zvládneme zpracovat naráz. Rozdělte to na menší části."
    },
    "rateLimited": {
      "title": "Zkoušíte to příliš často",
      "body": "Počkejte {seconds, plural, =0 {chvíli} one {# sekundu} few {# sekundy} many {# sekundy} other {# sekund}} a zkuste to znovu."
    },
    "webhookDisabled": {
      "title": "Webhook jsme vypnuli, protože 20krát po sobě selhal",
      "body": "Až problém na vaší straně vyřešíte, webhook znovu zapněte. Nabídneme vám přitom přehrání událostí za posledních 24 hodin."
    },
    "serviceUnavailable": {
      "title": "Server neodpovídá",
      "body": "Nepodařilo se nám spojit se serverem nástroje. Většinou je to přechodné a druhý pokus projde."
    },
    "dependencyTimeout": {
      "title": "Server odpovídal moc dlouho",
      "body": "Požadavek jsme přerušili, protože trval déle než 10 sekund. Zkuste to znovu."
    },
    "internalError": {
      "title": "Něco se nepovedlo",
      "body": "Chyba je na naší straně. Zkuste to znovu a když se to bude opakovat, pošlete podpoře číslo požadavku níž."
    },
    "fallback": {
      "title": "Něco se nepovedlo",
      "body": "Popis chyby ze serveru je pod tímhle textem. Když si s ní nevíte rady, pošlete podpoře číslo požadavku."
    }
  }
}
```

- [ ] **Krok 4: Napiš `packages/i18n/messages/en/settings.json`**

Anglická verze má **stejnou množinu klíčů** a řídí se pravidly 11 až 14 z 9.1 části 6: sentence case, Oxford comma, žádné zkratky, kontrakce ano.

```json
{
  "nav": {
    "sectionLabel": "Settings",
    "general": "Project",
    "members": "Team",
    "apiKeys": "API keys",
    "webhooks": "Webhooks",
    "audit": "Audit log",
    "account": "My account"
  },
  "shared": {
    "save": "Save",
    "backToOverview": "Back to the project overview",
    "selectPlaceholder": "Select",
    "showPassword": "Show password",
    "hidePassword": "Hide password",
    "saving": "Saving",
    "saved": "Saved",
    "saveFailed": "We couldn't save it, we're trying again",
    "cancel": "Cancel",
    "close": "Close",
    "tryAgain": "Try again",
    "refresh": "Refresh",
    "createdAt": "Created",
    "lastUsedAt": "Last used",
    "never": "Never",
    "copy": "Copy",
    "copied": "Copied",
    "loadingMore": "Loading more",
    "previousPage": "Previous",
    "nextPage": "Next",
    "countExact": "{count, plural, =0 {No items} one {# item} other {# items}}",
    "countEstimated": "about {count, number} items",
    "cursorDropped": "That link to a page of results no longer works because the data changed. We're showing the first page of the same filter.",
    "filtersApplied": "Filter: {summary}",
    "clearFilters": "Clear filters",
    "role": {
      "owner": "Owner",
      "admin": "Admin",
      "editor": "Editor",
      "viewer": "Viewer"
    }
  },
  "jobs": {
    "title": "Job",
    "progress": "{done} of {total} done",
    "startedBy": "Started by {person}",
    "startedAt": "Started",
    "finishedAt": "Finished",
    "notFoundTitle": "We don't know this job",
    "notFoundBody": "The job either never existed or is older than what we keep. The project overview shows the ones that are running.",
    "status": {
      "running": "Running",
      "paused": "Paused",
      "completed": "Done",
      "completedWithErrors": "Done, but with errors",
      "failed": "Failed",
      "cancelled": "Cancelled"
    }
  },
  "confirm": {
    "irreversible": "This action can't be undone.",
    "whatHappens": "What happens",
    "notYetConfirmed": "You haven't ticked the confirmation above the button yet.",
    "notYetTyped": "The text you typed doesn't match yet. Please check it character by character.",
    "typeToConfirmMismatch": "The text you typed doesn't match.",
    "filterInWords": "This applies to the selection: {filter}"
  },
  "states": {
    "forbiddenTitle": "You don't have permission for this section",
    "forbiddenBody": "This section requires the {permission} permission, which the {roles} roles have. Your role is {currentRole}.",
    "forbiddenWhoCanHelp": "The project owner or an admin can change your role.",
    "forbiddenWhoCanHelpNamed": "{name} can change your role.",
    "forbiddenBack": "Back to the project overview",
    "notFoundTitle": "We couldn't find this item",
    "notFoundBody": "It may have been deleted, or your link is out of date.",
    "notFoundBack": "Back to the list",
    "offlineTitle": "We lost the connection",
    "loadingLabel": "Loading",
    "offlineBody": "We lost the connection. We're trying to reconnect. Your changes will be saved as soon as it works.",
    "staleTitle": "Last updated {time}",
    "staleBody": "The refresh failed, so these numbers are older.",
    "readOnlyTitle": "You can only view this section",
    "readOnlyBody": "Your {currentRole} role doesn't have the {permission} permission, so you see the values as text and can't edit them.",
    "partialTitle": "Part of the page didn't load",
    "loading": "Loading"
  },
  "profile": {
    "title": "My account",
    "lead": "Details that apply across every project.",
    "identity": {
      "title": "Personal details",
      "name": "Full name",
      "nameHint": "Other members see your name next to your actions in the audit log.",
      "email": "Email",
      "emailHint": "The email is used for signing in and can't be changed yet.",
      "locale": "Interface language",
      "timezone": "Time zone",
      "timezoneHint": "We show times across the tool in this zone.",
      "saved": "Saved"
    },
    "password": {
      "title": "Change password",
      "lead": "Changing the password signs you out of every other device. This tab stays signed in.",
      "current": "Current password",
      "next": "New password",
      "submit": "Change password",
      "submitting": "Changing the password",
      "doneTitle": "Your password is changed",
      "doneBody": "We ended the other sessions. You'll need to sign in again on your other devices."
    },
    "sessions": {
      "title": "Active sessions",
      "lead": "Devices and browsers you're signed in from.",
      "thisSession": "This session",
      "device": "Device",
      "ip": "IP address",
      "lastUsed": "Last used",
      "signedInAt": "Signed in",
      "revoke": "Sign this device out",
      "revoked": "We signed that device out",
      "revokeFailed": "We couldn't sign that device out. Please try again.",
      "logoutAll": "Sign out of every device",
      "logoutAllDialogTitle": "Sign out of every device, including this one?",
      "logoutAllConsequence": "{count, plural, =0 {We won't end any session, because no other one is running.} one {We'll end # session, this tab included.} other {We'll end # sessions, this tab included.}}",
      "logoutAllConsequenceWork": "Forms in progress on other devices will be lost.",
      "logoutAllConfirm": "Sign out everywhere",
      "logoutAllCancel": "Keep them signed in",
      "empty": "You're signed in here only. Once you sign in from another device, you'll see it in this list.",
      "emptyAction": "Reload the list",
      "unknownDevice": "Unknown device"
    }
  },
  "general": {
    "title": "Project",
    "lead": "Name, address, and defaults for the {projectName} project.",
    "name": "Project name",
    "slug": "Project address",
    "slugHint": "Used in links: /w/{slug}. Lowercase letters, digits, and hyphens.",
    "slugChangeWarning": "Changing the address breaks links you've already sent to colleagues.",
    "locale": "Project language",
    "localeHint": "The language of system emails and of the public pages your recipients see.",
    "timezone": "Project time zone",
    "timezoneHint": "Campaigns are scheduled and reports are counted in this zone.",
    "addressForm": {
      "label": "Greeting in emails",
      "hint": "Applies to the emails you send to contacts. The tool's own interface always addresses you formally.",
      "formal": "Formal",
      "formalExample": "Dear Jana,",
      "informal": "Informal",
      "informalExample": "Hi Jana,",
      "dialogTitle": "Switch the greeting to {target}?",
      "dialogConsequence1": "{count, plural, =0 {We won't recalculate the vocative for any contact, the database is still empty.} one {We'll recalculate the vocative for # contact.} other {We'll recalculate the vocative for # contacts.}}",
      "dialogConsequence2": "The recalculation runs in the background and takes a few minutes on a large database.",
      "dialogConsequence3": "Campaigns you've already sent don't change.",
      "dialogConfirm": "Switch to {target}",
      "dialogCancel": "Keep {current}",
      "started": "We switched the greeting and we're recalculating contacts."
    },
    "danger": {
      "title": "Delete the project",
      "body": "Deleting removes all contacts, campaigns and statistics. You can restore it for 30 days. Type the project name to confirm.",
      "button": "Delete project",
      "dialogTitle": "Delete the {name} project?",
      "consequence1": "Every contact, list, segment, and tag disappears.",
      "consequence2": "Every campaign, template, and their statistics disappear.",
      "consequence3": "The project's API keys and webhooks stop working immediately.",
      "consequence4": "Emails already sent won't come back, but a send in progress stops.",
      "restoreNote": "You can restore the project for 30 days. After that it's deleted for good and can't be recovered.",
      "confirmLabel": "Type the project name to confirm",
      "confirm": "Delete the {name} project",
      "cancel": "Keep the project",
      "onlyOwner": "Only the owner can delete a project."
    }
  },
  "members": {
    "title": "Team",
    "lead": "Who can get into the project and what they can do.",
    "empty": "You are alone in this project. Invite colleagues and choose what they can do.",
    "emptyAction": "Invite a colleague",
    "emptyNoPermission": "Only an Admin or an Owner can invite colleagues. Your role doesn't have that permission.",
    "table": {
      "person": "Member",
      "role": "Role",
      "joinedAt": "In the project since",
      "actions": "Actions"
    },
    "roleDescription": {
      "owner": "Sees and changes everything, including backups, deletion, and handing the project over.",
      "admin": "Sees and changes everything except backups, deletion, and handing the project over.",
      "editor": "Creates contacts, templates, and campaigns, and sends them. Can't see keys, the audit log, or export contacts.",
      "viewer": "Sees contacts, campaigns, and reports. Changes nothing."
    },
    "changeRole": {
      "label": "Role of {name}",
      "done": "{name} is now {role}.",
      "undo": "Undo",
      "failed": "We couldn't change the role. We put the original value back.",
      "lastOwner": "The last owner has to stay. Hand ownership over to someone else first."
    },
    "remove": {
      "button": "Remove from the project",
      "dialogTitle": "Remove {name} from the project?",
      "consequence1": "They lose access to every contact, campaign, and report in the project.",
      "consequence2": "What they created in the project stays.",
      "consequence3": "They can only get back through a new invitation, which they have to accept.",
      "confirm": "Remove {name}",
      "cancel": "Keep them in the project",
      "done": "{name} is no longer in the project."
    },
    "invitations": {
      "title": "Pending invitations",
      "empty": "No invitation is waiting to be accepted.",
      "emptyAction": "Type a colleague's email",
      "email": "Email",
      "role": "Role",
      "invitedBy": "Invited by",
      "expiresAt": "Valid until",
      "revoke": "Revoke the invitation",
      "revoked": "The invitation for {email} is revoked.",
      "reinvite": "Invite again",
      "limitTitle": "You can't send more invitations at once",
      "limitBody": "The project has 100 pending invitations, which is the maximum. Revoke one of them, or wait until people accept."
    },
    "invite": {
      "button": "Invite a colleague",
      "title": "Invite a colleague to the project",
      "lead": "We'll send them a link that works for 7 days.",
      "email": "Colleague's email",
      "role": "Role",
      "submit": "Send the invitation",
      "submitting": "Sending the invitation",
      "done": "We've sent the invitation to {email}.",
      "alreadyMember": "{email} is already in the project. You can change their role in the member list.",
      "alreadyInvited": "We've sent the invitation to {email} again, the previous one stopped working."
    }
  },
  "apiKeys": {
    "title": "API keys",
    "lead": "A key connects your shop or your own application to this project.",
    "empty": "You do not have any API keys yet. A key connects your shop or your own application.",
    "emptyAction": "Create a key",
    "emptyNoPermission": "Only an Admin or an Owner can create API keys. Your role doesn't have that permission.",
    "table": {
      "name": "Name",
      "prefix": "Key",
      "scopes": "Permissions",
      "createdBy": "Created by",
      "lastUsedAt": "Last used",
      "status": "Status",
      "actions": "Actions"
    },
    "status": {
      "active": "Active",
      "revoked": "Revoked",
      "expired": "Expired",
      "rotating": "Rotating, the old secret works until {time}"
    },
    "create": {
      "button": "Create a key",
      "title": "New API key",
      "lead": "Choose what it can do. A key has no role, it gets exactly what you tick here.",
      "name": "Key name",
      "nameHint": "The name tells you which application uses the key. For example \"Shop, orders\".",
      "scopes": "Key permissions",
      "scopesHint": "Tick as few as possible. A key that can do everything is a key nobody understands.",
      "submit": "Create the key",
      "submitting": "Creating the key",
      "noScopeSelected": "Pick at least one permission."
    },
    "secret": {
      "title": "The key is ready",
      "warning": "Copy the secret now. Neither you nor we can see it again.",
      "label": "The whole key",
      "acknowledge": "I've stored the secret",
      "close": "Done"
    },
    "rotate": {
      "button": "Rotate the secret",
      "panelCancel": "Back to the key list",
      "dialogTitle": "Rotate the secret of the {name} key?",
      "consequence1": "We'll generate a new secret and show it once.",
      "consequence2": "Applications using the old secret stop working once the grace period ends: {grace}.",
      "consequence3": "The key's permissions don't change.",
      "graceLabel": "Grace period for the old secret",
      "graceHint": "During this time both the old and the new secret work. Zero means the old one stops working immediately.",
      "graceOptions": {
        "none": "No grace period",
        "hour": "1 hour",
        "day": "24 hours"
      },
      "acknowledge": "I understand the old secret will stop working",
      "confirm": "Rotate the secret",
      "cancel": "Keep the current secret",
      "done": "The secret is replaced."
    },
    "revoke": {
      "button": "Revoke the key",
      "dialogTitle": "Revoke the {name} key?",
      "consequence1": "Applications using the key stop working immediately.",
      "consequence2": "A revoked key stays in the list so the audit trail makes sense. It can't be restored.",
      "consequence3": "It was last used {lastUsed}.",
      "acknowledge": "I understand a revoked key can't be restored",
      "confirm": "Revoke the {name} key",
      "cancel": "Keep the key",
      "done": "The {name} key is revoked."
    }
  },
  "webhooks": {
    "title": "Webhooks",
    "lead": "A webhook posts an event to your URL as soon as something happens in the project.",
    "empty": "No webhooks yet. A webhook posts an event to your URL as soon as something happens.",
    "emptyAfterDelete": "You deleted every webhook. Create a new one with the button below.",
    "emptyAction": "Add a webhook",
    "emptyNoPermission": "Only an Admin or an Owner can add webhooks. Your role doesn't have that permission.",
    "limitTitle": "You can't add more webhooks",
    "limitBody": "The project has 20 webhooks, which is the maximum. Delete one before adding another.",
    "table": {
      "url": "URL",
      "events": "Events",
      "status": "Status",
      "lastDelivery": "Last delivery",
      "actions": "Actions"
    },
    "status": {
      "active": "Active",
      "disabled": "Disabled",
      "failing": "{count, plural, =0 {Failing} one {Failing, # failure in a row} other {Failing, # failures in a row}}"
    },
    "disabled": {
      "title": "We disabled your webhook",
      "body": "We disabled your webhook after 20 failed attempts. Fix the target and enable it again.",
      "detail": "The endpoint {url} has been returning HTTP {lastStatus} since {since}. After twenty failed attempts we stopped delivering to avoid filling the queue.",
      "replayNote": "When you enable it, we'll offer to replay the last 24 hours of events. Anything older than that cannot be redelivered.",
      "showErrors": "Show recent errors",
      "enable": "Re-enable",
      "enabling": "Enabling the webhook",
      "enabled": "The webhook is enabled again."
    },
    "form": {
      "createTitle": "New webhook",
      "editTitle": "Edit webhook",
      "url": "URL to post events to",
      "urlHint": "HTTPS only. We don't post to private addresses or to your local network.",
      "description": "Description",
      "descriptionHint": "What the webhook is for. Your colleagues see it in the list.",
      "events": "Events to send",
      "eventsHint": "Pick at least one, at most 50.",
      "submit": "Create the webhook",
      "submitting": "Creating the webhook",
      "saveSubmit": "Save changes",
      "duplicateNote": "Delivery is at least once. If we restart a worker mid-send, an event can arrive twice. Tell them apart by the ML-Event-Id header."
    },
    "secret": {
      "title": "The webhook is ready",
      "warning": "Copy the signing secret now. Neither you nor we can see it again.",
      "hint": "The secret proves a request really came from us. The steps are in the documentation for the ML-Signature header.",
      "acknowledge": "I've stored the secret",
      "close": "Done"
    },
    "test": {
      "button": "Send a test event",
      "running": "Sending a test event",
      "slow": "This is taking longer than we expected",
      "successTitle": "The test event arrived",
      "successBody": "Your URL answered {status} in {duration}.",
      "failureTitle": "The test event didn't get through",
      "failureBody": "Your URL answered {status}. The details are in the delivery log below."
    },
    "delete": {
      "button": "Delete the webhook",
      "dialogTitle": "Delete the webhook {url}?",
      "consequence1": "Events stop going to this URL immediately.",
      "consequence2": "The delivery log stays for 30 days.",
      "confirm": "Delete the webhook",
      "cancel": "Keep the webhook",
      "done": "The webhook is deleted."
    },
    "deliveries": {
      "title": "Delivery log",
      "lead": "Delivery attempts from the last 30 days.",
      "empty": "We haven't sent anything to this URL yet.",
      "emptyAction": "Reload the log",
      "emptyFiltered": "No delivery matches the filter.",
      "emptyFilteredBody": "Try loosening the filter, or clear it and go through the whole log.",
      "table": {
        "eventType": "Event",
        "status": "Result",
        "attempt": "Attempt",
        "responseStatus": "Response",
        "duration": "Duration",
        "createdAt": "When",
        "nextAttemptAt": "Next attempt"
      },
      "status": {
        "pending": "Waiting",
        "delivering": "Sending",
        "succeeded": "Delivered",
        "failed": "Not delivered",
        "abandoned": "Given up"
      },
      "errorCode": "Error code",
      "responseSnippet": "Your endpoint's response",
      "retry": "Try delivering again",
      "retrying": "Delivering again",
      "retried": "We queued the delivery.",
      "blockedTarget": "The address resolves into a private network, so we didn't connect. Check whether the DNS record changed."
    }
  },
  "audit": {
    "title": "Audit log",
    "lead": "Who did what in the project. Records can't be deleted or edited.",
    "empty": "Nothing has happened yet.",
    "emptyAction": "Reload the records",
    "emptyFiltered": "No record matches the filter.",
    "emptyFilteredBody": "Try loosening the filter, or clear it and go through the whole audit log.",
    "retention": "We keep records for 24 months.",
    "table": {
      "when": "When",
      "actor": "Who",
      "action": "What",
      "target": "What it concerned",
      "requestId": "Request number"
    },
    "filters": {
      "action": "Action",
      "actor": "Who",
      "from": "From",
      "to": "To",
      "allActions": "All actions",
      "allActors": "Anyone",
      "apply": "Apply the filter"
    },
    "actorType": {
      "user": "Member",
      "apiKey": "API key",
      "system": "The tool"
    },
    "unknownAction": "Unknown action",
    "actions": {
      "user.login": "Signed in",
      "user.login_failed": "Failed sign-in",
      "user.logout": "Signed out",
      "user.password_changed": "Changed the password",
      "user.password_reset_requested": "Requested a password reset",
      "user.password_reset_completed": "Completed a password reset",
      "workspace.created": "Created the project",
      "workspace.updated": "Changed project settings",
      "workspace.deleted": "Deleted the project",
      "workspace.restored": "Restored the project",
      "workspace.ownership_transferred": "Handed the project over",
      "member.invited": "Invited a member",
      "member.invitation_revoked": "Revoked an invitation",
      "member.joined": "Accepted an invitation",
      "member.role_changed": "Changed a member's role",
      "member.removed": "Removed a member",
      "api_key.created": "Created an API key",
      "api_key.rotated": "Rotated a key secret",
      "api_key.revoked": "Revoked an API key",
      "webhook_endpoint.created": "Created a webhook",
      "webhook_endpoint.updated": "Edited a webhook",
      "webhook_endpoint.deleted": "Deleted a webhook",
      "webhook_endpoint.disabled": "The webhook was disabled",
      "backup.created": "Created a backup",
      "backup.restored": "Restored from a backup",
      "settings.updated": "Changed settings"
    }
  },
  "errorBlock": {
    "retry": "Try again",
    "requestId": "Request number",
    "copy": "Copy",
    "copyAll": "Copy everything",
    "copied": "Copied",
    "detailsSummary": "Technical details",
    "code": "Code",
    "time": "Time",
    "path": "Path"
  },
  "errors": {
    "forbidden": {
      "title": "You don't have permission for this",
      "body": "This requires the {permission} permission, which the {roles} roles have. Your role is {currentRole}."
    },
    "insufficientScope": {
      "title": "The key isn't enough for this",
      "body": "The key the application signed in with doesn't have the {permission} permission. It can't be added, create a new key."
    },
    "originNotAllowed": {
      "title": "The request came from somewhere else",
      "body": "The address the request came from doesn't match the tool's address. Reload the page and try again."
    },
    "csrfTokenInvalid": {
      "title": "The protection token is no longer valid",
      "body": "The page was open for too long. Reload it and repeat the action."
    },
    "sessionExpired": {
      "title": "You've been signed out",
      "body": "We signed you out after a period of inactivity for security reasons. Sign in again, your work in progress is safe."
    },
    "notFound": {
      "title": "We couldn't find this item",
      "body": "It may have been deleted, or your link points to an item in another project."
    },
    "conflict": {
      "title": "Something changed meanwhile",
      "body": "Someone else edited the same thing before you did. Reload the page and look at the current state."
    },
    "alreadyExists": {
      "title": "This already exists",
      "body": "An item with the same value is already in the project. Pick a different value."
    },
    "alreadyMember": {
      "title": "This person is already in the project",
      "body": "There's no need to invite them. You can change their role right in the member list."
    },
    "lastOwner": {
      "title": "The last owner has to stay",
      "body": "A project always has exactly one owner. Hand ownership over to someone else first, then repeat the action."
    },
    "idempotencyKeyReuse": {
      "title": "The form was submitted with changed values",
      "body": "The form went out twice, the second time with different content. Reload the page and fill it in once."
    },
    "idempotencyInProgress": {
      "title": "We're already processing the same request",
      "body": "You submitted the form twice in quick succession. Wait a few seconds and look at the result."
    },
    "validationFailed": {
      "title": "We couldn't save the form",
      "body": "We've described what needs fixing next to the fields below."
    },
    "tooManyItems": {
      "title": "That's too many items",
      "body": "You picked more items than we can handle at once. Split it into smaller parts."
    },
    "rateLimited": {
      "title": "You're trying too often",
      "body": "Wait {seconds, plural, =0 {a moment} one {# second} other {# seconds}} and try again."
    },
    "webhookDisabled": {
      "title": "We disabled this webhook after 20 consecutive failures",
      "body": "Once you've fixed the problem on your side, re-enable it. We'll offer to replay the last 24 hours of events."
    },
    "serviceUnavailable": {
      "title": "The server isn't responding",
      "body": "We couldn't reach the tool's server. This is usually temporary and a second attempt goes through."
    },
    "dependencyTimeout": {
      "title": "The server took too long",
      "body": "We stopped the request because it ran longer than 10 seconds. Try again."
    },
    "internalError": {
      "title": "Something went wrong",
      "body": "The fault is on our side. Try again, and if it keeps happening, send support the request number below."
    },
    "fallback": {
      "title": "Something went wrong",
      "body": "The server's description of the error is below. If it doesn't help, send support the request number."
    }
  }
}
```

- [ ] **Krok 5: Napiš test katalogů**

`apps/web/src/lib/i18n/catalog.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { AUTH_ERROR_KEYS, SETTINGS_ERROR_KEYS } from '@/lib/errors/error-keys';

const MESSAGES_DIR = path.resolve(import.meta.dirname, '../../../../../packages/i18n/messages');

function load(locale: 'cs' | 'en', namespace: 'auth' | 'settings'): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(MESSAGES_DIR, locale, `${namespace}.json`), 'utf8'));
}

function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value };
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    Object.assign(out, flatten(child, prefix === '' ? key : `${prefix}.${key}`));
  }
  return out;
}

/**
 * Jména slotů se čtou z ICU stromu, ne regulárním výrazem.
 *
 * Výraz `/\{(\w+)[,}]/` totiž považuje za slot i obsah větve, která je jedno
 * slovo: ve zprávě `{count, plural, =0 {Failing} …}` by našel slot `Failing`
 * a porovnání s češtinou by spadlo na správně napsané zprávě. Ověřeno
 * spuštěním na skutečných katalozích, kde to byl jediný nález.
 */
function slotNames(message: string, locale: 'cs' | 'en'): string[] {
  const names = new Set<string>();
  type Node = {
    type: number;
    value?: string;
    options?: Record<string, { value: Node[] }>;
    children?: Node[];
  };
  const walk = (nodes: Node[]): void => {
    for (const node of nodes) {
      // 0 literál, 1 argument, 2 číslo, 3 datum, 4 čas, 5 select, 6 plural, 7 #, 8 značka
      if (node.type >= 1 && node.type <= 6 && node.value !== undefined) names.add(node.value);
      if (node.options !== undefined) {
        for (const option of Object.values(node.options)) walk(option.value);
      }
      if (node.children !== undefined) walk(node.children);
    }
  };
  walk(new IntlMessageFormat(message, locale).ast as unknown as Node[]);
  return [...names].sort();
}

function matchBrace(message: string, open: number): number {
  let depth = 0;
  for (let index = open; index < message.length; index += 1) {
    if (message[index] === '{') depth += 1;
    else if (message[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** První blok `plural` ve zprávě a informace, jestli stojí nad celou zprávou. */
function pluralBlock(message: string): { block: string; spansWholeMessage: boolean } | null {
  const opener = /\{\s*\w+\s*,\s*plural\s*,/.exec(message);
  if (opener === null) return null;
  const end = matchBrace(message, opener.index);
  if (end === -1) return null;
  const block = message.slice(opener.index, end + 1);
  return { block, spansWholeMessage: message.trim() === block.trim() };
}

/** Obsah větve `=0` uvnitř bloku, bez vnějších závorek. */
function zeroBranch(block: string): string | null {
  const marker = /=0\s*\{/.exec(block);
  if (marker === null) return null;
  const open = marker.index + marker[0].length - 1;
  const end = matchBrace(block, open);
  if (end === -1) return null;
  return block.slice(open + 1, end);
}

const NAMESPACES = ['auth', 'settings'] as const;

describe.each(NAMESPACES)('katalog %s', (namespace) => {
  const cs = flatten(load('cs', namespace));
  const en = flatten(load('en', namespace));

  it('má v obou jazycích stejnou množinu klíčů', () => {
    expect(Object.keys(cs).sort()).toEqual(Object.keys(en).sort());
  });

  it('neobsahuje dlouhou pomlčku', () => {
    // Znak U+2014 se zapisuje escape sekvencí, aby se do repozitáře nedostal ani v testu.
    const EM_DASH = String.fromCharCode(0x2014);
    for (const [key, value] of Object.entries({ ...cs, ...en })) {
      expect(value.includes(EM_DASH), `klíč ${key}`).toBe(false);
    }
  });

  it('neobsahuje zakázané výrazy ze slovníku 9.2 části 6', () => {
    const forbidden = [
      'pracovní prostor',
      'workspace',
      'odběratel',
      'blacklist',
      'černá listina',
      'kvóta',
      'trackování',
      'proklik',
      'joba',
      'administrátor',
      'přístupový klíč',
    ];
    for (const [key, value] of Object.entries(cs)) {
      const lower = value.toLowerCase();
      for (const term of forbidden) {
        expect(lower.includes(term), `klíč ${key} obsahuje zakázaný výraz ${term}`).toBe(false);
      }
    }
  });

  it('nepoužívá hodnotu subscribed jako stav', () => {
    for (const value of Object.values({ ...cs, ...en })) {
      expect(value).not.toMatch(/\bsubscribed\b/);
    }
  });

  it('každý řetězec je platný ICU výraz v obou jazycích', () => {
    for (const [key, value] of Object.entries(cs)) {
      expect(() => new IntlMessageFormat(value, 'cs'), `cs.${namespace}.${key}`).not.toThrow();
    }
    for (const [key, value] of Object.entries(en)) {
      expect(() => new IntlMessageFormat(value, 'en'), `en.${namespace}.${key}`).not.toThrow();
    }
  });

  it('český plural má všechny čtyři kategorie a =0', () => {
    for (const [key, value] of Object.entries(cs)) {
      if (!value.includes(', plural,')) continue;
      for (const category of ['=0', 'one', 'few', 'many', 'other']) {
        expect(value.includes(`${category} {`), `cs.${namespace}.${key} postrádá ${category}`).toBe(true);
      }
    }
  });

  it('anglický plural má =0, one a other', () => {
    for (const [key, value] of Object.entries(en)) {
      if (!value.includes(', plural,')) continue;
      for (const category of ['=0', 'one', 'other']) {
        expect(value.includes(`${category} {`), `en.${namespace}.${key} postrádá ${category}`).toBe(true);
      }
    }
  });

  it('sloty ve zprávě jsou v obou jazycích stejné', () => {
    for (const key of Object.keys(cs)) {
      expect(slotNames(cs[key]!, 'cs'), `klíč ${key}`).toEqual(slotNames(en[key]!, 'en'));
    }
  });

  it('český plural se vykreslí pro 0, 1, 2, 5 a 1,5', () => {
    for (const [key, value] of Object.entries(cs)) {
      if (!value.includes(', plural,')) continue;
      const slot = value.match(/\{(\w+), plural,/)![1]!;
      const formatter = new IntlMessageFormat(value, 'cs');
      const args = Object.fromEntries(slotNames(value, 'cs').map((name) => [name, 'x']));
      for (const count of [0, 1, 2, 5, 21, 100, 1.5]) {
        expect(String(formatter.format({ ...args, [slot]: count })), `cs.${namespace}.${key} u ${count}`).not.toBe('');
      }
    }
  });

  it('česká větev =0 se nespoléhá na sloveso mimo blok', () => {
    // 12.3 části 6: v češtině se s číslem mění nejen podstatné jméno, ale
    // i sloveso, takže `plural` musí stát nad CELOU větou. Nejspolehlivější
    // známka porušení je záporové zájmeno („žádný", „nic") ve větvi =0,
    // protože ta si vynucuje zápor u slovesa a to zůstalo před blokem:
    // z „Ukončíme {=0 {žádnou relaci}}" vznikne „Ukončíme žádnou relaci".
    //
    // Pravidlo je čistě strukturální a nezná mluvnici: kdo ve větvi =0
    // potřebuje záporové zájmeno, musí mít celou větu uvnitř bloku.
    // Ověřeno na skutečných katalozích: chytí všech pět dřívějších případů
    // a propustí `shared.countExact`, kde blok stojí nad celou zprávou.
    const NEGATIVE = /(žádn|\bnic\b|nikdo|nikde|nijak)/i;
    for (const [key, value] of Object.entries(cs)) {
      const block = pluralBlock(value);
      if (block === null || block.spansWholeMessage) continue;
      const zero = zeroBranch(block.block);
      if (zero === null) continue;
      expect(
        NEGATIVE.test(zero),
        `cs.${namespace}.${key}: větev =0 zní "${zero}", ale sloveso zůstalo mimo blok. ` +
          'Přesuň celou větu dovnitř větví, nebo záporové zájmeno nepoužívej.',
      ).toBe(false);
    }
  });
});

describe('pokrytí chybových kódů', () => {
  const csAuth = flatten(load('cs', 'auth'));
  const enAuth = flatten(load('en', 'auth'));
  const csSettings = flatten(load('cs', 'settings'));
  const enSettings = flatten(load('en', 'settings'));

  it('každý kód z mapy auth má text v obou jazycích', () => {
    for (const keys of Object.values(AUTH_ERROR_KEYS)) {
      expect(csAuth, keys.title).toHaveProperty(keys.title);
      expect(enAuth, keys.title).toHaveProperty(keys.title);
      expect(csAuth, keys.body).toHaveProperty(keys.body);
      expect(enAuth, keys.body).toHaveProperty(keys.body);
    }
  });

  it('každý kód z mapy settings má text v obou jazycích', () => {
    for (const keys of Object.values(SETTINGS_ERROR_KEYS)) {
      expect(csSettings, keys.title).toHaveProperty(keys.title);
      expect(enSettings, keys.title).toHaveProperty(keys.title);
      expect(csSettings, keys.body).toHaveProperty(keys.body);
      expect(enSettings, keys.body).toHaveProperty(keys.body);
    }
  });

  it('obě namespace mají fallback pro neznámý kód', () => {
    for (const catalog of [csAuth, enAuth, csSettings, enSettings]) {
      expect(catalog).toHaveProperty('errors.fallback.title');
      expect(catalog).toHaveProperty('errors.fallback.body');
    }
  });
});
```

**Poznámka k `intl-messageformat`.** Balíček je tranzitivní závislost `next-intl` (BSD-3-Clause, ověřeno `npm view intl-messageformat license` dne 31. 7. 2026) a používá se jen v testu. Kdyby v `node_modules` chyběl, doplní se do `devDependencies` `apps/web` stejnou úzkou výjimkou jako `msw`.

**Poznámka ke kritériu 76c.** Žádný z testů nekontroluje doslovné znění věty. Kontroluje se parita klíčů, platnost ICU, pokrytí kódů, zákazy ze slovníku, kategorie pluralu a struktura větve `=0`. Přeformulování textu žádný test neshodí, dokud se do větve `=0` nedostane záporové zájmeno bez zbytku věty.

**Proč přibyla kontrola větve `=0`.** Kontrola kategorií hlídá, že větve **existují**, ne že věta dává smysl. Pět zpráv mělo `plural` jen nad podstatným jménem a sloveso zůstalo před blokem, takže při nule vznikaly věty „Ukončíme žádnou relaci" a „Opravte nic níž". Všechny kategorie přitom byly přítomné a test procházel; chyba by se poznala až u uživatele, který ve formuláři nic nepokazil. Nová kontrola je čistě strukturální, ověřená spuštěním na skutečných katalozích: zachytí všech pět původních zpráv a propustí `shared.countExact`, kde blok stojí nad celou zprávou.

- [ ] **Krok 6: Spusť testy katalogů**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/i18n/catalog.test.ts`
Expected: PASS, `Tests  23 passed (23)`.

- [ ] **Krok 7: Spusť kontrolu katalogů v CI**

Run: `pnpm ci:i18n-check`
Expected: exit code 0.

- [ ] **Krok 8: Commit**

```bash
git add packages/i18n/messages/cs/auth.json packages/i18n/messages/en/auth.json \
        packages/i18n/messages/cs/settings.json packages/i18n/messages/en/settings.json \
        apps/web/src/lib/i18n/catalog.test.ts
git commit -m "feat(i18n): auth and settings catalogs in czech and english"
```

---

### Úkol 11: Skořápka obrazovek mimo projekt a sdílené prvky formulářů

**Soubory:**
- Create: `apps/web/src/app/[locale]/(auth)/layout.tsx`
- Create: `apps/web/src/app/[locale]/(account)/layout.tsx`
- Create: `apps/web/src/features/auth/auth-card.tsx`
- Create: `apps/web/src/lib/forms/submit-button.tsx`
- Create: `apps/web/src/lib/forms/submit-button.test.tsx`
- Create: `apps/web/src/lib/forms/field-error.tsx`
- Create: `apps/web/src/lib/forms/form-error-summary.tsx`
- Create: `apps/web/src/lib/forms/use-form-error-focus.ts`
- Create: `apps/web/src/lib/forms/password-field.tsx`
- Create: `apps/web/src/lib/forms/password-field.test.tsx`
- Create: `apps/web/src/lib/forms/deferred-skeleton.tsx`
- Create: `apps/web/src/lib/ui/status-icons.tsx`
- Create: `apps/web/src/lib/i18n/locale-label.ts`
- Create: `apps/web/src/lib/forms/select-field.tsx`
- Create: `apps/web/src/lib/forms/select-field.test.tsx`
- Create: `apps/web/src/lib/feedback/confirm-labels.ts`

- [ ] **Krok 1: Napiš padající test na tlačítko odeslání**

Kritérium 18 kapitoly 15.2 části 6: **žádné tlačítko primární akce nemá atribut `disabled`.** Místo zašednutí se mění text a nastavuje `aria-busy`. Dvojité odeslání řeší idempotence z úkolu 5, ne zablokované tlačítko.

`apps/web/src/lib/forms/submit-button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const useFormStatus = vi.fn(() => ({ pending: false }));
vi.mock('react-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  useFormStatus: () => useFormStatus(),
}));

const { SubmitButton } = await import('./submit-button');

describe('SubmitButton', () => {
  it('ukáže popisek a nemá atribut disabled', () => {
    render(<SubmitButton label="Přihlásit se" pendingLabel="Přihlašujeme vás" />);
    const button = screen.getByRole('button', { name: 'Přihlásit se' });
    expect(button).not.toHaveAttribute('disabled');
    expect(button).toHaveAttribute('aria-busy', 'false');
  });

  it('při odesílání změní text a nastaví aria-busy, ale zůstane klikatelné', () => {
    useFormStatus.mockReturnValue({ pending: true });
    render(<SubmitButton label="Přihlásit se" pendingLabel="Přihlašujeme vás" />);
    const button = screen.getByRole('button', { name: 'Přihlašujeme vás' });
    expect(button).not.toHaveAttribute('disabled');
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/forms/submit-button.test.tsx`
Expected: FAIL, `Failed to resolve import "./submit-button"`.

- [ ] **Krok 3: Napiš prvky formuláře**

`apps/web/src/lib/forms/submit-button.tsx`:

```tsx
'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@mlain/ui/components/button';

export type SubmitButtonProps = {
  label: string;
  pendingLabel: string;
};

/**
 * Primární akce nikdy nemá `disabled` (kritérium 18 kapitoly 15.2 části 6).
 * Mrtvé tlačítko neřekne, proč je mrtvé. Dvojklik zachytí idempotence.
 */
export function SubmitButton({ label, pendingLabel }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" aria-busy={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
```

`apps/web/src/lib/forms/field-error.tsx`:

```tsx
import type { FieldErrors } from '@/lib/errors/field-errors';

export function fieldErrorId(name: string): string {
  return `field-error-${name}`;
}

export type FieldErrorProps = {
  name: string;
  errors: FieldErrors;
};

/**
 * Chyba je svázaná s polem přes `aria-describedby` a pole má `aria-invalid`,
 * viz 11.3 části 6. Vlastní propojení dělá volající, tahle komponenta jen
 * vykreslí text se stabilním `id`.
 */
export function FieldError({ name, errors }: FieldErrorProps) {
  const messages = errors[name];
  if (!messages || messages.length === 0) return null;
  return (
    <p id={fieldErrorId(name)} className="mt-1 text-sm text-[--color-danger]">
      {messages.join(' ')}
    </p>
  );
}

export function fieldAria(name: string, errors: FieldErrors): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  return errors[name] ? { 'aria-invalid': true, 'aria-describedby': fieldErrorId(name) } : {};
}
```

`apps/web/src/lib/forms/form-error-summary.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import type { FieldErrors } from '@/lib/errors/field-errors';
import { FORM_LEVEL_KEY } from '@/lib/errors/field-errors';

export type FormErrorSummaryProps = {
  errors: FieldErrors;
  /** Souhrn se podle 5.5 části 6 ukazuje u formulářů delších než šest polí. */
  fieldCount: number;
  heading: string;
};

export function FormErrorSummary({ errors, fieldCount, heading }: FormErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const entries = Object.entries(errors);

  useEffect(() => {
    if (entries.length > 0) ref.current?.focus();
  }, [entries.length]);

  if (entries.length === 0) return null;
  if (fieldCount <= 6 && !Object.hasOwn(errors, FORM_LEVEL_KEY)) return null;

  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="mb-4 rounded-md border border-[--color-danger] bg-[--color-surface-muted] p-3"
    >
      <p className="font-medium">{heading}</p>
      <ul className="mt-1 list-disc pl-5 text-sm">
        {entries.flatMap(([field, messages]) => messages.map((message) => <li key={`${field}-${message}`}>{message}</li>))}
      </ul>
    </div>
  );
}
```

`apps/web/src/lib/forms/use-form-error-focus.ts`:

```ts
'use client';

import { useEffect, type RefObject } from 'react';
import { firstErrorField, type FieldErrors } from '@/lib/errors/field-errors';

/**
 * Po odeslání formuláře s chybou skočí fokus na první chybné pole,
 * viz požadavek na klávesnici v 11.3 části 6.
 */
export function useFormErrorFocus(errors: FieldErrors, formRef: RefObject<HTMLFormElement | null>): void {
  useEffect(() => {
    const name = firstErrorField(errors);
    if (!name) return;
    const field = formRef.current?.elements.namedItem(name);
    if (field instanceof HTMLElement) field.focus();
  }, [errors, formRef]);
}
```

`apps/web/src/lib/forms/password-field.tsx`:

```tsx
'use client';

import { useId, useState } from 'react';
import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import type { FieldErrors } from '@/lib/errors/field-errors';
import { FieldError, fieldAria } from './field-error';

export type PasswordFieldProps = {
  name: string;
  label: string;
  hint?: string;
  autoComplete: 'current-password' | 'new-password';
  errors: FieldErrors;
  showLabel: string;
  hideLabel: string;
};

/**
 * Popisek je vždy viditelný, placeholder ho nenahrazuje (11.3 části 6).
 * Vkládání ze schránky se nijak neomezuje, zákaz vkládání je zakázaný.
 */
export function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const hintId = useId();

  return (
    <div className="mb-4">
      <Label htmlFor={props.name}>{props.label}</Label>
      <div className="mt-1 flex gap-2">
        <Input
          id={props.name}
          name={props.name}
          type={visible ? 'text' : 'password'}
          autoComplete={props.autoComplete}
          aria-describedby={props.hint ? hintId : undefined}
          {...fieldAria(props.name, props.errors)}
        />
        <Button type="button" variant="ghost" onClick={() => setVisible((value) => !value)}>
          {visible ? props.hideLabel : props.showLabel}
        </Button>
      </div>
      {props.hint ? (
        <p id={hintId} className="mt-1 text-sm text-[--color-text-muted]">
          {props.hint}
        </p>
      ) : null}
      <FieldError name={props.name} errors={props.errors} />
    </div>
  );
}
```

`apps/web/src/lib/forms/deferred-skeleton.tsx`:

```tsx
'use client';

import type { ReactNode } from 'react';
import { useDelayedFlag } from '@mlain/ui/lib/use-delayed-flag';

/**
 * Kritérium 80 kapitoly 15.6 části 6: indikátor se nezobrazí u operace kratší
 * než 300 ms a jakmile se zobrazí, zůstane aspoň 400 ms. Logiku vlastní P05,
 * tohle je jen obal pro `loading.tsx` segmentů.
 */
export function DeferredSkeleton({ children }: { children: ReactNode }) {
  // Prodleva 300 ms a minimum 400 ms jsou modulové konstanty v P05,
  // ne parametry. Hook bere jediný argument.
  const visible = useDelayedFlag(true);
  return visible ? <>{children}</> : null;
}
```

- [ ] **Krok 4: Napiš test pole s heslem**

`apps/web/src/lib/forms/password-field.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PasswordField } from './password-field';

const base = {
  name: 'password',
  label: 'Heslo',
  autoComplete: 'new-password' as const,
  showLabel: 'Zobrazit heslo',
  hideLabel: 'Skrýt heslo',
};

describe('PasswordField', () => {
  it('má viditelný popisek svázaný s polem', () => {
    render(<PasswordField {...base} errors={{}} />);
    expect(screen.getByLabelText('Heslo')).toBeInTheDocument();
  });

  it('umožní zobrazit a skrýt heslo', async () => {
    render(<PasswordField {...base} errors={{}} />);
    const input = screen.getByLabelText('Heslo');
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Zobrazit heslo' }));
    expect(input).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Skrýt heslo' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('nebrání vložení ze schránky', () => {
    render(<PasswordField {...base} errors={{}} />);
    const input = screen.getByLabelText('Heslo');
    expect(input).not.toHaveAttribute('onpaste');
    expect(input).not.toHaveAttribute('onPaste');
  });

  it('chybu sváže s polem přes aria-describedby a aria-invalid', () => {
    render(<PasswordField {...base} errors={{ password: ['Heslo musí mít aspoň 12 znaků.'] }} />);
    const input = screen.getByLabelText('Heslo');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'field-error-password');
    expect(screen.getByText('Heslo musí mít aspoň 12 znaků.')).toHaveAttribute('id', 'field-error-password');
  });

  it('nápovědu sváže s polem, když chyba není', () => {
    render(<PasswordField {...base} hint="Aspoň 12 znaků." errors={{}} />);
    expect(screen.getByLabelText('Heslo')).toHaveAttribute('aria-describedby');
  });
});
```

- [ ] **Krok 5: Napiš layouty a kartu**

`apps/web/src/app/[locale]/(auth)/layout.tsx`:

```tsx
import type { ReactNode } from 'react';

/**
 * Obrazovky mimo skořápku aplikace. Vědomě tu není topbar, sidebar ani
 * přepínač projektů: uživatel v tuhle chvíli žádný projekt nemá.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[--color-surface-muted] px-4 py-10">
      <main className="w-full max-w-md">{children}</main>
    </div>
  );
}
```

`apps/web/src/app/[locale]/(account)/layout.tsx`:

```tsx
import type { ReactNode } from 'react';

/**
 * Přihlášený uživatel mimo projekt: profil a stav „nemám projekt". Skořápku
 * s přepínačem projektů tu nevykreslujeme, protože profil je nadprojektový
 * a `/no-workspace` z definice žádný projekt nemá.
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <main>{children}</main>
    </div>
  );
}
```

`apps/web/src/features/auth/auth-card.tsx`:

```tsx
import type { ReactNode } from 'react';

export type AuthCardProps = {
  title: string;
  lead?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthCard({ title, lead, children, footer }: AuthCardProps) {
  return (
    <section className="rounded-xl border border-[--color-border] bg-[--color-surface] p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-[--color-text]">{title}</h1>
      {lead ? <p className="mt-2 text-[--color-text-muted]">{lead}</p> : null}
      <div className="mt-6">{children}</div>
      {footer ? <div className="mt-6 border-t border-[--color-border] pt-4 text-sm">{footer}</div> : null}
    </section>
  );
}
```

- [ ] **Krok 6: Napiš ikony stavů**

`Badge` z P05 má prop `icon` **povinný** a je to tak schválně: stav se nikdy
nesděluje jen barvou (pravidlo 11.3 části 6). Ikony v `packages/ui` kreslí
`lucide-react`, jenže ta je závislostí `packages/ui`, ne `apps/web`, a P06
si smí do `apps/web/package.json` přidat jedinou věc, `msw` do vývojových
závislostí (kapitola 0.3). Import `lucide-react` by se v pnpm workspace
nerozložil. Šest ikon proto P06 kreslí sám, bez nové závislosti.

`apps/web/src/lib/ui/status-icons.tsx`:

```tsx
/**
 * Ikony stavů pro `Badge`. Všechny jsou `aria-hidden`: význam nese slovo
 * vedle nich, ikona je druhý rozlišovací znak vedle barvy, ne náhrada textu.
 */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      {children}
    </svg>
  );
}

export const CheckIcon = (
  <Frame>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </Frame>
);

export const SlashIcon = (
  <Frame>
    <circle cx="12" cy="12" r="9" />
    <path d="m6 6 12 12" />
  </Frame>
);

export const ClockIcon = (
  <Frame>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Frame>
);

export const WarningIcon = (
  <Frame>
    <path d="M12 4 2.5 20h19L12 4Z" />
    <path d="M12 10v4" />
    <path d="M12 17.5h.01" />
  </Frame>
);

export const RunningIcon = (
  <Frame>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Frame>
);

export const DeviceIcon = (
  <Frame>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8" />
  </Frame>
);
```

- [ ] **Krok 7: Napiš pojmenování jazyků přes `Intl`**

`apps/web/src/lib/i18n/locale-label.ts`:

```ts
/**
 * Jméno jazyka se nikdy neskládá ručně ani nedrží v mapě `{ cs: 'Čeština' }`
 * (pravidlo 12.4: formátování vždy přes `Intl`). Mapa by navíc znamenala, že
 * přidání jazyka vyžaduje zásah do kódu na třech místech.
 */
export function localeLabel(code: string, uiLocale: string): string {
  return new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code) ?? code;
}
```

- [ ] **Krok 8: Napiš pole s výběrem, které skutečně odešle hodnotu**

`Select` z P05 **není nativní `<select>`**, ale obálka nad Radixem. Má to tři důsledky, které se nedají obejít předáním jiných props:

1. Nevykreslí `<select>` ani `<option>`, takže `<option>` jako potomek se nezobrazí. Položka se jmenuje `SelectItem`.
2. Prop `name` neexistuje a Radix `name` nedostane, takže **hodnota se nedostane do `FormData`**. Server Action by dostal `null` a formulář by tiše ukládal prázdno. Je to horší než typová chyba, protože typová kontrola projde.
3. Řízení je `value` plus povinné `onValueChange`, ne `defaultValue` a `onChange` s nativní událostí. Povinné jsou i `placeholder` a `aria-label`.

Devět míst v P06 by na tom spadlo, proto je obsluha na jednom místě.

`apps/web/src/lib/forms/select-field.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { FieldError } from '@/lib/forms/field-error';
import type { FieldErrors } from '@/lib/errors/field-errors';

export type SelectFieldOption = { value: string; label: string };

export type SelectFieldProps = {
  /** Jméno pole ve `FormData`. Nese ho skryté pole, ne komponenta z P05. */
  name: string;
  label: string;
  options: readonly SelectFieldOption[];
  defaultValue?: string;
  /** Text v prázdném stavu. `Select` ho má povinný. */
  placeholder: string;
  hint?: string;
  errors?: FieldErrors;
  /** Zavolá se po volbě, například když se má formulář odeslat hned. */
  onSelected?: (value: string) => void;
};

/**
 * Pole s výběrem pro formuláře odesílané Server Action.
 *
 * Skryté pole není berlička: `Select` z P05 stojí na Radixu a ten do formuláře
 * nic nevkládá, protože mu obálka `name` nepředává. Bez skrytého pole by se
 * hodnota nikam nedostala a **nic by nespadlo**, jen by se uložilo prázdno.
 *
 * Přístupné jméno nese `aria-label` na spouštěči, takže `getByLabelText`
 * i `getByRole('combobox', { name })` míří na tentýž prvek. Viditelný popisek
 * proto **není `<label>`**: `htmlFor` by ukazoval na skryté pole, které nejde
 * zaostřit, a `<label>` bez `htmlFor` obalující spouštěč by čtečce ohlásil
 * jméno dvakrát.
 */
export function SelectField({
  name,
  label,
  options,
  defaultValue,
  placeholder,
  hint,
  errors,
  onSelected,
}: SelectFieldProps) {
  const [value, setValue] = useState(defaultValue ?? '');

  return (
    <div data-select-field={name}>
      <span aria-hidden className="mb-1 block text-sm font-medium text-[--color-text]">
        {label}
      </span>
      <input type="hidden" name={name} value={value} readOnly />
      <Select
        value={value === '' ? undefined : value}
        onValueChange={(next) => {
          setValue(next);
          onSelected?.(next);
        }}
        placeholder={placeholder}
        aria-label={label}
      >
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </Select>
      {hint ? <p className="mt-1 text-sm text-[--color-text-muted]">{hint}</p> : null}
      {errors ? <FieldError name={name} errors={errors} /> : null}
    </div>
  );
}
```

- [ ] **Krok 9: Napiš test pole s výběrem**

`apps/web/src/lib/forms/select-field.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SelectField } from './select-field';

const OPTIONS = [
  { value: 'cs', label: 'Čeština' },
  { value: 'en', label: 'English' },
];

describe('SelectField', () => {
  it('nese hodnotu ve skrytém poli, aby se dostala do FormData', () => {
    const { container } = render(
      <SelectField name="locale" label="Jazyk rozhraní" options={OPTIONS} defaultValue="cs" placeholder="Vyberte" />,
    );
    // Tohle je jediná cesta, kterou se hodnota dostane na server.
    // Radix do formuláře sám nic nevkládá.
    expect(container.querySelector('input[name="locale"]')).toHaveValue('cs');
  });

  it('spouštěč má přístupné jméno, takže na něj míří i getByLabelText', () => {
    render(
      <SelectField name="locale" label="Jazyk rozhraní" options={OPTIONS} defaultValue="cs" placeholder="Vyberte" />,
    );
    expect(screen.getByRole('combobox', { name: 'Jazyk rozhraní' })).toBeInTheDocument();
    expect(screen.getByLabelText('Jazyk rozhraní')).toBeInTheDocument();
  });

  it('spouštěč nemá disabled ani v prázdném stavu', () => {
    render(<SelectField name="role" label="Role" options={OPTIONS} placeholder="Vyberte roli" />);
    expect(screen.getByRole('combobox', { name: 'Role' })).not.toHaveAttribute('disabled');
  });
});
```

**Proč se tady netestuje samotná volba.** Radix otevírá nabídku přes ukazovací události, které jsdom neimplementuje, takže `userEvent.selectOptions` ani klik na položku v jednotkovém testu neprojdou. Volba se proto ověřuje v prohlížeči, v úkolu 36. Předstírat ji mockem by znamenalo testovat mock.

- [ ] **Krok 10: Napiš popisky potvrzovacího dialogu**

`ConfirmDialog` z P05 má prop `labels` **povinný**. Je to schválně: texty do
`packages/ui` natvrdo nepatří, protože balíček nezná jazyk ani doménu. Šest
obrazovek P06 dialog volá, takže se popisky skládají na jednom místě a ne
šestkrát.

`apps/web/src/lib/feedback/confirm-labels.ts`:

```ts
'use client';

import { useTranslations } from 'next-intl';
import type { ConfirmDialogLabels } from '@mlain/ui/patterns/feedback';

/**
 * Popisky, které `ConfirmDialog` potřebuje nezávisle na tom, co potvrzuje.
 *
 * `notYetConfirmed` a `notYetTyped` jsou vysvětlení místo zašednutí:
 * potvrzovací tlačítko **nikdy nemá `disabled`** (kritérium 18 kapitoly
 * 15.2 části 6), takže když se opsaná fráze neshoduje, dialog neztmavne,
 * ale řekne, co ještě chybí.
 */
export function useConfirmDialogLabels(): ConfirmDialogLabels {
  const t = useTranslations('settings');

  return {
    irreversible: t('confirm.irreversible'),
    whatHappens: t('confirm.whatHappens'),
    notYetConfirmed: t('confirm.notYetConfirmed'),
    notYetTyped: t('confirm.notYetTyped'),
    typeToConfirmMismatch: t('confirm.typeToConfirmMismatch'),
    filterInWords: (filter: string) => t('confirm.filterInWords', { filter }),
  };
}
```

- [ ] **Krok 11: Spusť testy a ověř, že procházejí**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/forms/`
Expected: PASS, `Tests  10 passed (10)`.

- [ ] **Krok 12: Commit**

```bash
git add apps/web/src/lib/forms apps/web/src/lib/i18n/locale-label.ts apps/web/src/lib/feedback/confirm-labels.ts \
        apps/web/src/features/auth/auth-card.tsx \
        "apps/web/src/app/[locale]/(auth)/layout.tsx" "apps/web/src/app/[locale]/(account)/layout.tsx"
git commit -m "feat(web): auth shell and shared accessible form primitives"
```

---

### Úkol 12: Obrazovka `/setup`, první spuštění

**Soubory:**
- Create: `apps/web/src/features/auth/actions.ts`
- Create: `apps/web/src/features/auth/setup-form.tsx`
- Create: `apps/web/src/features/auth/setup-form.test.tsx`
- Create: `apps/web/src/app/[locale]/(auth)/setup/page.tsx`

Rozsah je daný rozhodnutím R1: formulář proti `POST /api/v1/setup` a přesměrování na projekt. Průvodce onboardingem dodává P16.

- [ ] **Krok 1: Napiš padající test formuláře**

`apps/web/src/features/auth/setup-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csAuth from '../../../../../packages/i18n/messages/cs/auth.json';
import { SetupForm } from './setup-form';

const messages = { auth: csAuth };

function renderForm(action = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <SetupForm action={action} locales={['cs', 'en']} />
    </NextIntlClientProvider>,
  );
}

describe('SetupForm', () => {
  it('má všechna povinná pole s viditelnými popisky', () => {
    renderForm();
    expect(screen.getByLabelText('Jméno a příjmení')).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.getByLabelText('Heslo')).toBeInTheDocument();
    expect(screen.getByLabelText('Název projektu')).toBeInTheDocument();
    expect(screen.getByLabelText('Jazyk rozhraní')).toBeInTheDocument();
  });

  it('primární tlačítko nemá disabled', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Založit účet a projekt' })).not.toHaveAttribute('disabled');
  });

  it('vysvětlí, co je projekt', () => {
    renderForm();
    expect(screen.getByText(/oddělený prostor s vlastními kontakty/)).toBeInTheDocument();
  });

  it('ukáže chyby polí z odpovědi serveru a označí pole jako neplatná', () => {
    render(
      <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
        <SetupForm
          action={vi.fn()}
          locales={['cs', 'en']}
          initialState={{
            status: 'error',
            channel: 'inlineBlock',
            problem: {
              type: '',
              title: 'Validation failed',
              status: 422,
              detail: '',
              instance: '/api/v1/setup',
              code: 'validation_failed',
              request_id: 'req_1',
              errors: [{ path: 'password', code: 'too_short', message: 'Heslo musí mít aspoň 12 znaků.' }],
            },
            fieldErrors: { password: ['Heslo musí mít aspoň 12 znaků.'] },
          }}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByLabelText('Heslo')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Heslo musí mít aspoň 12 znaků.')).toBeInTheDocument();
  });

  it('u hotové instalace ukáže hlášku setup_already_completed s odkazem na přihlášení', () => {
    render(
      <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
        <SetupForm
          action={vi.fn()}
          locales={['cs', 'en']}
          initialState={{
            status: 'error',
            channel: 'inlineBlock',
            problem: {
              type: '',
              title: 'Setup already completed',
              status: 409,
              detail: '',
              instance: '/api/v1/setup',
              code: 'setup_already_completed',
              request_id: 'req_2',
            },
            fieldErrors: {},
          }}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Instalace už je nastavená')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zpět na přihlášení' })).toHaveAttribute('href', '/login');
  });

  it('nese skryté pole s klíčem idempotence', () => {
    const { container } = renderForm();
    expect(container.querySelector('input[name="_idempotency_key"]')).not.toBeNull();
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/auth/setup-form.test.tsx`
Expected: FAIL, `Failed to resolve import "./setup-form"`.

- [ ] **Krok 3: Napiš blok chyby akce**

`apps/web/src/features/auth/action-problem.tsx`:

```tsx
'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { AUTH_ERROR_KEYS, errorTextKeys } from '@/lib/errors/error-keys';
import { ProblemBlock } from '@/lib/errors/problem-block';
import type { Problem } from '@/lib/api-client/problem';

export type AuthProblemProps = {
  problem: Problem;
  onRetry?: () => void;
  /** Hodnoty do zprávy, například počet sekund u rate limitu. */
  values?: Record<string, string | number>;
};

/**
 * Jediné místo, kde se v obrazovkách přihlášení vykresluje chyba. Neznámý kód
 * spadne na `detail` ze serveru (kritérium 76 části 6), nikdy na prázdno.
 */
export function AuthProblem({ problem, onRetry, values }: AuthProblemProps) {
  const t = useTranslations('auth');
  const format = useFormatter();
  const keys = errorTextKeys(AUTH_ERROR_KEYS, problem.code);
  const occurredAt = new Date().toISOString();

  const title = keys ? t(keys.title) : t('errors.fallback.title');
  const body = keys ? t(keys.body, values ?? {}) : problem.detail || t('errors.fallback.body');

  return (
    <ProblemBlock
      problem={problem}
      title={title}
      body={body}
      occurredAt={occurredAt}
      onRetry={onRetry}
      labels={{
        technicalDetails: t('errorBlock.detailsSummary'),
        code: t('errorBlock.code'),
        requestId: t('errorBlock.requestId'),
        time: t('errorBlock.time'),
        copyBlock: t('errorBlock.copyAll'),
        copied: t('errorBlock.copied'),
        tryAgain: t('errorBlock.retry'),
      }}
    />
  );
}
```

- [ ] **Krok 4: Napiš Server Actions přihlašovací části**

`apps/web/src/features/auth/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiMutate } from '@/lib/api-client/mutate';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';
import { IDEMPOTENCY_FIELD_NAME } from '@/lib/feedback/idempotency-field';

const SetupSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(12).max(256),
  workspace_name: z.string().trim().min(1),
  locale: z.enum(['cs', 'en']),
});

type SetupResponse = { user: { id: string }; workspace: { slug: string } };

export async function setupAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = SetupSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    workspace_name: formData.get('workspace_name'),
    locale: formData.get('locale'),
  });

  if (!parsed.success) {
    return failed('inlineBlock', {
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: '',
      instance: '/api/v1/setup',
      code: 'validation_failed',
      request_id: '',
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    });
  }

  const result = await apiMutate<SetupResponse>('/api/v1/setup', {
    method: 'POST',
    body: parsed.data,
    idempotencyKey: String(formData.get(IDEMPOTENCY_FIELD_NAME) ?? ''),
  });

  if (!result.ok) return failed('inlineBlock', result.problem);
  redirect(`/w/${result.data.workspace.slug}`);
}

const LoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export async function loginAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });

  if (!parsed.success) {
    return failed('inlineBlock', {
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: '',
      instance: '/api/v1/auth/login',
      code: 'validation_failed',
      request_id: '',
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    });
  }

  const result = await apiMutate<{ workspaces: Array<{ slug: string }> }>('/api/v1/auth/login', {
    method: 'POST',
    body: { email: parsed.data.email, password: parsed.data.password },
  });

  if (!result.ok) return failed('inlineBlock', result.problem);

  const target = parsed.data.next;
  if (target && target.startsWith('/') && !target.startsWith('//')) redirect(target);

  const first = result.data.workspaces[0];
  redirect(first ? `/w/${first.slug}` : '/no-workspace');
}

const EmailSchema = z.object({ email: z.string().trim().email() });

export async function requestPasswordResetAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = EmailSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return failed('inlineBlock', {
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: '',
      instance: '/api/v1/auth/password-reset',
      code: 'validation_failed',
      request_id: '',
      errors: [{ path: 'email', code: 'invalid_email', message: 'Zadejte platnou e-mailovou adresu.' }],
    });
  }

  const result = await apiMutate<void>('/api/v1/auth/password-reset', { method: 'POST', body: parsed.data });
  if (!result.ok) return failed('inlineBlock', result.problem);
  return succeeded({ channel: 'inlineBlock', messageKey: 'forgot.sentTitle' });
}

const ResetSchema = z.object({
  token: z.string().min(1),
  new_password: z.string().min(12).max(256),
});

export async function confirmPasswordResetAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = ResetSchema.safeParse({
    token: formData.get('token'),
    new_password: formData.get('new_password'),
  });
  if (!parsed.success) {
    return failed('inlineBlock', {
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: '',
      instance: '/api/v1/auth/password-reset/confirm',
      code: 'validation_failed',
      request_id: '',
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    });
  }

  const result = await apiMutate<void>('/api/v1/auth/password-reset/confirm', { method: 'POST', body: parsed.data });
  if (!result.ok) return failed('inlineBlock', result.problem);
  return succeeded({ channel: 'inlineBlock', messageKey: 'reset.doneTitle' });
}

export async function acceptInvitationAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const token = String(formData.get('token') ?? '');
  const result = await apiMutate<{ workspace: { slug: string; name: string }; role: string }>(
    '/api/v1/invitations/accept',
    { method: 'POST', body: { token } },
  );
  if (!result.ok) return failed('inlineBlock', result.problem);
  redirect(`/w/${result.data.workspace.slug}`);
}

const CreateWorkspaceSchema = z.object({ name: z.string().trim().min(1) });

export async function createWorkspaceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = CreateWorkspaceSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) {
    return failed('page', {
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: '',
      instance: '/api/v1/workspaces',
      code: 'validation_failed',
      request_id: '',
      errors: [{ path: 'name', code: 'required', message: 'Zadejte název projektu.' }],
    });
  }

  const result = await apiMutate<{ slug: string }>('/api/v1/workspaces', {
    method: 'POST',
    body: parsed.data,
    idempotencyKey: String(formData.get(IDEMPOTENCY_FIELD_NAME) ?? ''),
  });
  if (!result.ok) return failed('page', result.problem);
  redirect(`/w/${result.data.slug}`);
}
```

- [ ] **Krok 5: Napiš formulář a stránku**

`apps/web/src/features/auth/setup-form.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useActionState, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { SelectField } from '@/lib/forms/select-field';
import { localeLabel } from '@/lib/i18n/locale-label';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { FormErrorSummary } from '@/lib/forms/form-error-summary';
import { PasswordField } from '@/lib/forms/password-field';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IdempotencyField } from '@/lib/feedback/idempotency-field';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { AuthCard } from './auth-card';
import { AuthProblem } from './action-problem';

export type SetupFormProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locales: readonly string[];
  initialState?: ActionState;
};

export function SetupForm({ action, locales, initialState }: SetupFormProps) {
  const t = useTranslations('auth');
  const uiLocale = useLocale();
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  const alreadyCompleted = state.status === 'error' && state.problem.code === 'setup_already_completed';

  return (
    <AuthCard
      title={t('setup.title')}
      lead={t('setup.lead')}
      footer={
        alreadyCompleted ? (
          <Link href="/login" className="underline">
            {t('shared.backToLogin')}
          </Link>
        ) : null
      }
    >
      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mb-4">
          <AuthProblem problem={state.problem} />
        </div>
      ) : null}

      <form ref={formRef} action={formAction} noValidate>
        <IdempotencyField />
        <FormErrorSummary errors={fieldErrors} fieldCount={5} heading={t('errors.validationFailed.title')} />

        <div className="mb-4">
          <Label htmlFor="name">{t('shared.fullName')}</Label>
          <Input id="name" name="name" autoComplete="name" {...fieldAria('name', fieldErrors)} />
          <FieldError name="name" errors={fieldErrors} />
        </div>

        <div className="mb-4">
          <Label htmlFor="email">{t('shared.email')}</Label>
          <Input id="email" name="email" type="email" autoComplete="username" {...fieldAria('email', fieldErrors)} />
          <FieldError name="email" errors={fieldErrors} />
        </div>

        <PasswordField
          name="password"
          label={t('shared.password')}
          hint={t('passwordRules.hint')}
          autoComplete="new-password"
          errors={fieldErrors}
          showLabel={t('shared.showPassword')}
          hideLabel={t('shared.hidePassword')}
        />

        <div className="mb-4">
          <Label htmlFor="workspace_name">{t('setup.workspaceName')}</Label>
          <Input id="workspace_name" name="workspace_name" {...fieldAria('workspace_name', fieldErrors)} />
          <p className="mt-1 text-sm text-[--color-text-muted]">{t('setup.workspaceHint')}</p>
          <FieldError name="workspace_name" errors={fieldErrors} />
        </div>

        <div className="mb-6">
          <SelectField
            name="locale"
            label={t('setup.locale')}
            placeholder={t('shared.selectPlaceholder')}
            defaultValue={locales[0]}
            options={locales.map((locale) => ({ value: locale, label: localeLabel(locale, uiLocale) }))}
            errors={fieldErrors}
          />
        </div>

        <SubmitButton label={t('setup.submit')} pendingLabel={t('setup.submitting')} />
      </form>
    </AuthCard>
  );
}
```

`apps/web/src/app/[locale]/(auth)/setup/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SUPPORTED_LOCALES } from '@mlain/i18n/locales';
import { setupAction } from '@/features/auth/actions';
import { SetupForm } from '@/features/auth/setup-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('setup.title') };
}

export default function SetupPage() {
  return <SetupForm action={setupAction} locales={SUPPORTED_LOCALES} />;
}
```

- [ ] **Krok 6: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/features/auth/setup-form.test.tsx`
Expected: PASS, `Tests  6 passed (6)`.

- [ ] **Krok 7: Commit**

```bash
git add apps/web/src/features/auth "apps/web/src/app/[locale]/(auth)/setup"
git commit -m "feat(web): setup screen for the first run"
```

---

### Úkol 13: Obrazovka `/login`

**Soubory:**
- Create: `apps/web/src/features/auth/login-form.tsx`
- Create: `apps/web/src/features/auth/login-form.test.tsx`
- Create: `apps/web/src/app/[locale]/(auth)/login/page.tsx`

Pět stavů podle 5.3 části 1: formulář, odesílání, chybné údaje, zamčený účet, rate limit. Zamčený účet a rate limit mají vlastní text, protože vedou uživatele k jinému kroku.

- [ ] **Krok 1: Napiš padající test**

`apps/web/src/features/auth/login-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csAuth from '../../../../../packages/i18n/messages/cs/auth.json';
import type { ActionState } from '@/lib/feedback/action-result';
import { LoginForm } from './login-form';

const messages = { auth: csAuth };

function problemState(code: string, status: number, extra: Record<string, unknown> = {}): ActionState {
  return {
    status: 'error',
    channel: 'inlineBlock',
    problem: {
      type: '',
      title: code,
      status,
      detail: '',
      instance: '/api/v1/auth/login',
      code,
      request_id: 'req_1',
      ...extra,
    },
    fieldErrors: {},
  };
}

function renderForm(initialState?: ActionState, next?: string) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <LoginForm action={vi.fn()} next={next} initialState={initialState} />
    </NextIntlClientProvider>,
  );
}

describe('LoginForm', () => {
  it('má pole e-mail a heslo a odkaz na zapomenuté heslo', () => {
    renderForm();
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Heslo')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('link', { name: 'Zapomněli jste heslo?' })).toHaveAttribute('href', '/forgot-password');
  });

  it('u chybných údajů ukáže hlášku, která nepotvrzuje existenci účtu', () => {
    renderForm(problemState('invalid_credentials', 401));
    expect(screen.getByText('E-mail nebo heslo nesedí')).toBeInTheDocument();
    expect(screen.queryByText(/účet neexistuje/i)).not.toBeInTheDocument();
  });

  it('u zamčeného účtu vysvětlí patnáctiminutové okno', () => {
    renderForm(problemState('account_locked', 423, { retry_after: 900 }));
    expect(screen.getByText('Účet jsme dočasně zamkli')).toBeInTheDocument();
    expect(screen.getByText(/15 minut/)).toBeInTheDocument();
  });

  it('u rate limitu doplní počet sekund do hlášky', () => {
    renderForm(problemState('rate_limited', 429, { retry_after: 37 }));
    expect(screen.getByText('Zkoušíte to příliš často')).toBeInTheDocument();
    expect(screen.getByText(/37 sekund/)).toBeInTheDocument();
  });

  it('nese cílovou adresu v skrytém poli', () => {
    const { container } = renderForm(undefined, '/w/eshop/settings/members');
    const hidden = container.querySelector('input[name="next"]');
    expect(hidden).toHaveValue('/w/eshop/settings/members');
  });

  it('chybový blok drží kód v data-error-code', () => {
    const { container } = renderForm(problemState('invalid_credentials', 401));
    expect(container.querySelector('[data-error-code="invalid_credentials"]')).not.toBeNull();
  });

  it('u neznámého kódu ukáže detail ze serveru, ne prázdno', () => {
    renderForm({
      status: 'error',
      channel: 'inlineBlock',
      problem: {
        type: '',
        title: 'Weird',
        status: 400,
        detail: 'Něco divného ze serveru.',
        instance: '/api/v1/auth/login',
        code: 'some_future_code',
        request_id: 'req_x',
      },
      fieldErrors: {},
    });
    expect(screen.getByText('Něco divného ze serveru.')).toBeInTheDocument();
    expect(screen.getByText('req_x')).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/auth/login-form.test.tsx`
Expected: FAIL, `Failed to resolve import "./login-form"`.

- [ ] **Krok 3: Napiš formulář**

`apps/web/src/features/auth/login-form.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useActionState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { PasswordField } from '@/lib/forms/password-field';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { AuthCard } from './auth-card';
import { AuthProblem } from './action-problem';

export type LoginFormProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  next?: string;
  initialState?: ActionState;
};

export function LoginForm({ action, next, initialState }: LoginFormProps) {
  const t = useTranslations('auth');
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  const retryAfter = state.status === 'error' ? (state.problem.retry_after ?? 0) : 0;

  return (
    <AuthCard
      title={t('login.title')}
      lead={t('login.lead')}
      footer={
        <Link href="/forgot-password" className="underline">
          {t('login.forgotLink')}
        </Link>
      }
    >
      {state.status === 'error' ? (
        <div className="mb-4">
          <AuthProblem problem={state.problem} values={{ seconds: retryAfter }} />
        </div>
      ) : null}

      <form ref={formRef} action={formAction} noValidate>
        {next ? <input type="hidden" name="next" value={next} readOnly /> : null}

        <div className="mb-4">
          <Label htmlFor="email">{t('shared.email')}</Label>
          <Input id="email" name="email" type="email" autoComplete="username" {...fieldAria('email', fieldErrors)} />
          <FieldError name="email" errors={fieldErrors} />
        </div>

        <PasswordField
          name="password"
          label={t('shared.password')}
          autoComplete="current-password"
          errors={fieldErrors}
          showLabel={t('shared.showPassword')}
          hideLabel={t('shared.hidePassword')}
        />

        <SubmitButton label={t('login.submit')} pendingLabel={t('login.submitting')} />
      </form>
    </AuthCard>
  );
}
```

`apps/web/src/app/[locale]/(auth)/login/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { loginAction } from '@/features/auth/actions';
import { LoginForm } from '@/features/auth/login-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('login.title') };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : undefined;
  return <LoginForm action={loginAction} next={safeNext} />;
}
```

**Pozor na `next`.** Hodnota se propouští jen tehdy, když začíná jedním lomítkem. `//zlo.cz` je platná relativní adresa protokolu a přesměrovala by uživatele na cizí web. Kontrola je na obou stranách, ve stránce i v akci, protože formulář jde odeslat i mimo stránku.

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/features/auth/login-form.test.tsx`
Expected: PASS, `Tests  7 passed (7)`.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/auth "apps/web/src/app/[locale]/(auth)/login"
git commit -m "feat(web): login screen with locked account and rate limit states"
```

---

### Úkol 14: Obrazovka `/forgot-password`

**Soubory:**
- Create: `apps/web/src/features/auth/forgot-password-form.tsx`
- Create: `apps/web/src/features/auth/forgot-password-form.test.tsx`
- Create: `apps/web/src/app/[locale]/(auth)/forgot-password/page.tsx`

Dva stavy podle 5.3 části 1: formulář a odesláno. Hláška po odeslání je **vždy stejná**, aby z ní nešlo zjistit, kdo tu má účet.

- [ ] **Krok 1: Napiš padající test**

`apps/web/src/features/auth/forgot-password-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csAuth from '../../../../../packages/i18n/messages/cs/auth.json';
import type { ActionState } from '@/lib/feedback/action-result';
import { ForgotPasswordForm } from './forgot-password-form';

const messages = { auth: csAuth };

function renderForm(initialState?: ActionState) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <ForgotPasswordForm action={vi.fn()} initialState={initialState} />
    </NextIntlClientProvider>,
  );
}

describe('ForgotPasswordForm', () => {
  it('má pole e-mail a vysvětlí platnost odkazu', () => {
    renderForm();
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.getByText(/60 minut/)).toBeInTheDocument();
  });

  it('po odeslání ukáže stejnou hlášku bez ohledu na existenci účtu', () => {
    renderForm({ status: 'success', channel: 'inlineBlock', messageKey: 'forgot.sentTitle' });
    expect(screen.getByText('Odkaz je na cestě')).toBeInTheDocument();
    expect(screen.getByText(/Odpověď je stejná i pro adresu, kterou neznáme/)).toBeInTheDocument();
  });

  it('po odeslání formulář zmizí, aby nešlo klikat dokola', () => {
    renderForm({ status: 'success', channel: 'inlineBlock', messageKey: 'forgot.sentTitle' });
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument();
  });

  it('má odkaz zpět na přihlášení', () => {
    renderForm();
    expect(screen.getByRole('link', { name: 'Zpět na přihlášení' })).toHaveAttribute('href', '/login');
  });

  it('u rate limitu ukáže hlášku s počtem sekund', () => {
    renderForm({
      status: 'error',
      channel: 'inlineBlock',
      problem: {
        type: '',
        title: 'Rate limit exceeded',
        status: 429,
        detail: '',
        instance: '/api/v1/auth/password-reset',
        code: 'rate_limited',
        request_id: 'req_1',
        retry_after: 120,
      },
      fieldErrors: {},
    });
    expect(screen.getByText(/120 sekund/)).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/auth/forgot-password-form.test.tsx`
Expected: FAIL, `Failed to resolve import "./forgot-password-form"`.

- [ ] **Krok 3: Napiš formulář a stránku**

`apps/web/src/features/auth/forgot-password-form.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useActionState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { AuthCard } from './auth-card';
import { AuthProblem } from './action-problem';

export type ForgotPasswordFormProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  initialState?: ActionState;
};

export function ForgotPasswordForm({ action, initialState }: ForgotPasswordFormProps) {
  const t = useTranslations('auth');
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  const footer = (
    <Link href="/login" className="underline">
      {t('shared.backToLogin')}
    </Link>
  );

  if (state.status === 'success') {
    return (
      <AuthCard title={t('forgot.sentTitle')} footer={footer}>
        <p role="status" className="text-[--color-text-muted]">
          {t('forgot.sentBody')}
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('forgot.title')} lead={t('forgot.lead')} footer={footer}>
      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mb-4">
          <AuthProblem problem={state.problem} values={{ seconds: state.problem.retry_after ?? 0 }} />
        </div>
      ) : null}

      <form ref={formRef} action={formAction} noValidate>
        <div className="mb-6">
          <Label htmlFor="email">{t('shared.email')}</Label>
          <Input id="email" name="email" type="email" autoComplete="username" {...fieldAria('email', fieldErrors)} />
          <FieldError name="email" errors={fieldErrors} />
        </div>
        <SubmitButton label={t('forgot.submit')} pendingLabel={t('forgot.submitting')} />
      </form>
    </AuthCard>
  );
}
```

`apps/web/src/app/[locale]/(auth)/forgot-password/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requestPasswordResetAction } from '@/features/auth/actions';
import { ForgotPasswordForm } from '@/features/auth/forgot-password-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('forgot.title') };
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm action={requestPasswordResetAction} />;
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/features/auth/forgot-password-form.test.tsx`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/auth "apps/web/src/app/[locale]/(auth)/forgot-password"
git commit -m "feat(web): forgot password screen with a uniform response"
```

---

### Úkol 15: Obrazovka `/reset-password`

**Soubory:**
- Create: `apps/web/src/features/auth/reset-password-form.tsx`
- Create: `apps/web/src/features/auth/reset-password-form.test.tsx`
- Create: `apps/web/src/app/[locale]/(auth)/reset-password/page.tsx`

Tři stavy podle 5.3 části 1: formulář, neplatný nebo prošlý token, hotovo.

- [ ] **Krok 1: Napiš padající test**

`apps/web/src/features/auth/reset-password-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csAuth from '../../../../../packages/i18n/messages/cs/auth.json';
import type { ActionState } from '@/lib/feedback/action-result';
import { ResetPasswordForm } from './reset-password-form';

const messages = { auth: csAuth };

function renderForm(token: string | undefined, initialState?: ActionState) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <ResetPasswordForm action={vi.fn()} token={token} initialState={initialState} />
    </NextIntlClientProvider>,
  );
}

describe('ResetPasswordForm', () => {
  it('bez tokenu v adrese rovnou ukáže stav neplatného odkazu', () => {
    renderForm(undefined);
    expect(screen.getByText('Odkaz už neplatí')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vyžádat nový odkaz' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.queryByLabelText('Nové heslo')).not.toBeInTheDocument();
  });

  it('s tokenem ukáže pole na nové heslo a upozorní na odhlášení ostatních relací', () => {
    renderForm('TOKEN');
    expect(screen.getByLabelText('Nové heslo')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByText(/odhlásíme ze všech ostatních zařízení/)).toBeInTheDocument();
  });

  it('token drží ve skrytém poli', () => {
    const { container } = renderForm('TOKEN');
    expect(container.querySelector('input[name="token"]')).toHaveValue('TOKEN');
  });

  it('u prošlého tokenu ukáže stav neplatného odkazu, ne obecnou chybu', () => {
    renderForm('TOKEN', {
      status: 'error',
      channel: 'inlineBlock',
      problem: {
        type: '',
        title: 'Unauthenticated',
        status: 401,
        detail: '',
        instance: '/api/v1/auth/password-reset/confirm',
        code: 'unauthenticated',
        request_id: 'req_1',
      },
      fieldErrors: {},
    });
    expect(screen.getByText('Odkaz už neplatí')).toBeInTheDocument();
  });

  it('po úspěchu ukáže hotovo a odkaz na přihlášení', () => {
    renderForm('TOKEN', { status: 'success', channel: 'inlineBlock', messageKey: 'reset.doneTitle' });
    expect(screen.getByText('Heslo je nastavené')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zpět na přihlášení' })).toBeInTheDocument();
  });

  it('krátké heslo ukáže u pole, ne jako celostránkovou chybu', () => {
    renderForm('TOKEN', {
      status: 'error',
      channel: 'inlineBlock',
      problem: {
        type: '',
        title: 'Validation failed',
        status: 422,
        detail: '',
        instance: '/api/v1/auth/password-reset/confirm',
        code: 'validation_failed',
        request_id: 'req_1',
        errors: [{ path: 'new_password', code: 'too_short', message: 'Heslo musí mít aspoň 12 znaků.' }],
      },
      fieldErrors: { new_password: ['Heslo musí mít aspoň 12 znaků.'] },
    });
    expect(screen.getByLabelText('Nové heslo')).toHaveAttribute('aria-invalid', 'true');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/auth/reset-password-form.test.tsx`
Expected: FAIL, `Failed to resolve import "./reset-password-form"`.

- [ ] **Krok 3: Napiš formulář a stránku**

`apps/web/src/features/auth/reset-password-form.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useActionState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { PasswordField } from '@/lib/forms/password-field';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { AuthCard } from './auth-card';
import { AuthProblem } from './action-problem';

export type ResetPasswordFormProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  token?: string;
  initialState?: ActionState;
};

/** Kódy, které znamenají „odkaz už neplatí", ne obecnou chybu. */
const INVALID_TOKEN_CODES = new Set(['unauthenticated', 'not_found', 'gone']);

export function ResetPasswordForm({ action, token, initialState }: ResetPasswordFormProps) {
  const t = useTranslations('auth');
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  const backToLogin = (
    <Link href="/login" className="underline">
      {t('shared.backToLogin')}
    </Link>
  );

  const tokenInvalid = token === undefined || (state.status === 'error' && INVALID_TOKEN_CODES.has(state.problem.code));

  if (tokenInvalid) {
    return (
      <AuthCard title={t('reset.invalidTitle')} footer={backToLogin}>
        <p className="text-[--color-text-muted]">{t('reset.invalidBody')}</p>
        <p className="mt-4">
          <Link href="/forgot-password" className="underline">
            {t('reset.invalidAction')}
          </Link>
        </p>
      </AuthCard>
    );
  }

  if (state.status === 'success') {
    return (
      <AuthCard title={t('reset.doneTitle')} footer={backToLogin}>
        <p role="status" className="text-[--color-text-muted]">
          {t('reset.doneBody')}
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('reset.title')} lead={t('reset.lead')} footer={backToLogin}>
      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mb-4">
          <AuthProblem problem={state.problem} />
        </div>
      ) : null}

      <form ref={formRef} action={formAction} noValidate>
        <input type="hidden" name="token" value={token} readOnly />
        <PasswordField
          name="new_password"
          label={t('shared.newPassword')}
          hint={t('passwordRules.hint')}
          autoComplete="new-password"
          errors={fieldErrors}
          showLabel={t('shared.showPassword')}
          hideLabel={t('shared.hidePassword')}
        />
        <SubmitButton label={t('reset.submit')} pendingLabel={t('reset.submitting')} />
      </form>
    </AuthCard>
  );
}
```

`apps/web/src/app/[locale]/(auth)/reset-password/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { confirmPasswordResetAction } from '@/features/auth/actions';
import { ResetPasswordForm } from '@/features/auth/reset-password-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('reset.title') };
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <ResetPasswordForm action={confirmPasswordResetAction} token={token} />;
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/features/auth/reset-password-form.test.tsx`
Expected: PASS, `Tests  6 passed (6)`.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/auth "apps/web/src/app/[locale]/(auth)/reset-password"
git commit -m "feat(web): reset password screen with invalid token state"
```

---

### Úkol 16: Obrazovka `/invitations/accept`

**Soubory:**
- Create: `apps/web/src/features/auth/accept-invitation-panel.tsx`
- Create: `apps/web/src/features/auth/accept-invitation-panel.test.tsx`
- Create: `apps/web/src/app/[locale]/(auth)/invitations/accept/page.tsx`

Čtyři stavy podle 5.3 části 1: načítání, formulář registrace nebo přihlášení, neplatná pozvánka, hotovo. Podle 3.3 části 1 smí pozvánku přijmout i přihlášený uživatel s jinou adresou; pozvánka váže roli, ne identitu, a do auditu se zapíše obojí. Uživatel to musí vědět předem, jinak si bude myslet, že se přihlásil špatně.

- [ ] **Krok 1: Napiš padající test**

`apps/web/src/features/auth/accept-invitation-panel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csAuth from '../../../../../packages/i18n/messages/cs/auth.json';
import { AcceptInvitationPanel, type InvitationView } from './accept-invitation-panel';

const messages = { auth: csAuth };

function renderPanel(view: InvitationView) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <AcceptInvitationPanel view={view} action={vi.fn()} token="TOKEN" />
    </NextIntlClientProvider>,
  );
}

describe('AcceptInvitationPanel', () => {
  it('u chybějícího tokenu ukáže neplatnou pozvánku', () => {
    renderPanel({ kind: 'invalid' });
    expect(screen.getByText('Pozvánka už neplatí')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Přejít na přihlášení' })).toHaveAttribute('href', '/login');
  });

  it('nepřihlášeného pošle na přihlášení s návratem zpět', () => {
    renderPanel({ kind: 'signedOut' });
    const link = screen.getByRole('link', { name: 'Přihlásit se a přijmout' });
    expect(link).toHaveAttribute('href', '/login?next=%2Finvitations%2Faccept%3Ftoken%3DTOKEN');
  });

  it('přihlášenému ukáže projekt, roli a tlačítko přijmout', () => {
    renderPanel({
      kind: 'signedIn',
      email: 'jana@firma.cz',
      workspaceName: 'E-shop Kolo',
      roleLabel: 'Editor',
    });
    expect(screen.getByRole('heading', { name: 'Pozvánka do projektu E-shop Kolo' })).toBeInTheDocument();
    expect(screen.getByText(/roli Editor/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Přijmout pozvánku' })).not.toHaveAttribute('disabled');
  });

  it('u odlišné adresy upozorní, že se do auditu zapíšou obě', () => {
    renderPanel({
      kind: 'signedIn',
      email: 'jana@firma.cz',
      invitedEmail: 'jana.novakova@firma.cz',
      workspaceName: 'E-shop Kolo',
      roleLabel: 'Editor',
    });
    expect(screen.getByText(/poznamenáme obě adresy/)).toBeInTheDocument();
  });

  it('u shodné adresy poznámku neukáže', () => {
    renderPanel({
      kind: 'signedIn',
      email: 'jana@firma.cz',
      invitedEmail: 'jana@firma.cz',
      workspaceName: 'E-shop Kolo',
      roleLabel: 'Editor',
    });
    expect(screen.queryByText(/poznamenáme obě adresy/)).not.toBeInTheDocument();
  });

  it('nese token ve skrytém poli', () => {
    const { container } = renderPanel({
      kind: 'signedIn',
      email: 'jana@firma.cz',
      workspaceName: 'E-shop Kolo',
      roleLabel: 'Editor',
    });
    expect(container.querySelector('input[name="token"]')).toHaveValue('TOKEN');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/auth/accept-invitation-panel.test.tsx`
Expected: FAIL, `Failed to resolve import "./accept-invitation-panel"`.

- [ ] **Krok 3: Napiš panel a stránku**

`apps/web/src/features/auth/accept-invitation-panel.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { SubmitButton } from '@/lib/forms/submit-button';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { AuthCard } from './auth-card';
import { AuthProblem } from './action-problem';

export type InvitationView =
  | { kind: 'invalid' }
  | { kind: 'signedOut' }
  | {
      kind: 'signedIn';
      email: string;
      invitedEmail?: string;
      workspaceName: string;
      roleLabel: string;
    };

export type AcceptInvitationPanelProps = {
  view: InvitationView;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  token: string;
  initialState?: ActionState;
};

const INVALID_CODES = new Set(['not_found', 'gone', 'conflict']);

export function AcceptInvitationPanel({ view, action, token, initialState }: AcceptInvitationPanelProps) {
  const t = useTranslations('auth');
  const [state, formAction] = useActionState(action, initialState ?? IDLE);

  const invalid = view.kind === 'invalid' || (state.status === 'error' && INVALID_CODES.has(state.problem.code));

  if (invalid) {
    return (
      <AuthCard title={t('invitation.invalidTitle')}>
        <p className="text-[--color-text-muted]">{t('invitation.invalidBody')}</p>
        <p className="mt-4">
          <Link href="/login" className="underline">
            {t('invitation.invalidAction')}
          </Link>
        </p>
      </AuthCard>
    );
  }

  if (view.kind === 'signedOut') {
    const next = encodeURIComponent(`/invitations/accept?token=${token}`);
    return (
      <AuthCard title={t('login.title')} lead={t('invitation.leadSignedOut')}>
        <Link href={`/login?next=${next}`} className="underline">
          {t('invitation.signIn')}
        </Link>
      </AuthCard>
    );
  }

  const differentEmail = view.invitedEmail !== undefined && view.invitedEmail !== view.email;

  return (
    <AuthCard
      title={t('invitation.title', { projectName: view.workspaceName })}
      lead={t('invitation.leadSignedIn', { email: view.email, projectName: view.workspaceName, role: view.roleLabel })}
    >
      {state.status === 'error' ? (
        <div className="mb-4">
          <AuthProblem problem={state.problem} />
        </div>
      ) : null}

      {differentEmail ? (
        <p className="mb-4 rounded-md bg-[--color-surface-muted] p-3 text-sm">
          {t('invitation.otherEmailNote', { invitedEmail: view.invitedEmail!, email: view.email })}
        </p>
      ) : null}

      <form action={formAction}>
        <input type="hidden" name="token" value={token} readOnly />
        <SubmitButton label={t('invitation.accept')} pendingLabel={t('invitation.accepting')} />
      </form>
    </AuthCard>
  );
}
```

`apps/web/src/app/[locale]/(auth)/invitations/accept/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { acceptInvitationAction } from '@/features/auth/actions';
import { AcceptInvitationPanel, type InvitationView } from '@/features/auth/accept-invitation-panel';
import { ROLE_LABEL_KEYS, isRole } from '@/features/members/role-label';
import { getCurrentUser } from '@/lib/identity/current-user';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('invitation.loading') };
}

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; workspace?: string; role?: string; email?: string }>;
}) {
  const params = await searchParams;
  const t = await getTranslations('settings');

  if (!params.token) {
    return <AcceptInvitationPanel view={{ kind: 'invalid' }} action={acceptInvitationAction} token="" />;
  }

  const me = await getCurrentUser();
  const view: InvitationView = me.ok
    ? {
        kind: 'signedIn',
        email: me.data.user.email,
        invitedEmail: params.email,
        workspaceName: params.workspace ?? '',
        // Klíč se NIKDY neskládá za běhu (kritérium 71 části 6). Navíc sem
        // `role` chodí z parametru URL, takže by skládání pustilo do překladače
        // libovolnou hodnotu od návštěvníka. `isRole` ji nejdřív ověří.
        roleLabel: isRole(params.role) ? t(ROLE_LABEL_KEYS[params.role]) : '',
      }
    : { kind: 'signedOut' };

  return <AcceptInvitationPanel view={view} action={acceptInvitationAction} token={params.token} />;
}
```

**Pozor na klíč role.** Je to jediné místo v P06, kde by se dal svést skládaný klíč, a kritérium 71 části 6 ho zakazuje. Mapa `ROLE_LABEL_KEYS` z dalšího kroku je proto ve výpisu stránky použitá **od začátku**, ne dopsaná potom.

- [ ] **Krok 4: Odstraň skládaný klíč**

Vytvoř `apps/web/src/features/members/role-label.ts`:

```ts
import type { Role } from '@/lib/identity/permissions';

/** Explicitní mapa, aby se překladový klíč nikdy neskládal za běhu. */
export const ROLE_LABEL_KEYS = {
  owner: 'shared.role.owner',
  admin: 'shared.role.admin',
  editor: 'shared.role.editor',
  viewer: 'shared.role.viewer',
} as const satisfies Record<Role, string>;

export function isRole(value: string | undefined): value is Role {
  return value === 'owner' || value === 'admin' || value === 'editor' || value === 'viewer';
}
```

Stránka `/invitations/accept` mapu používá od začátku, protože `role` do ní chodí
z parametru URL. Skládaný klíč by tedy nebyl jen porušením kritéria 71, ale pustil
by do překladače libovolnou hodnotu od návštěvníka. `isRole` ji ověří dřív.

Mapa je sdílená: čte ji i stav bez oprávnění (úkol 21), obecné nastavení (úkol 22)
a tabulka členů (úkol 25).

- [ ] **Krok 5: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/features/auth/accept-invitation-panel.test.tsx`
Expected: PASS, `Tests  6 passed (6)`.

- [ ] **Krok 6: Commit**

```bash
git add apps/web/src/features/auth apps/web/src/features/members/role-label.ts \
        "apps/web/src/app/[locale]/(auth)/invitations"
git commit -m "feat(web): invitation acceptance screen"
```

---

### Úkol 17: Obrazovka `/no-workspace`

**Soubory:**
- Create: `apps/web/src/features/auth/no-workspace-panel.tsx`
- Create: `apps/web/src/features/auth/no-workspace-panel.test.tsx`
- Create: `apps/web/src/app/[locale]/(account)/no-workspace/page.tsx`

Prázdný stav S1 s doslovným textem z 5.3 části 1 a s primární akcí. Podle 3.3 části 1 se sem dostane uživatel bez jediného členství.

- [ ] **Krok 1: Napiš padající test**

`apps/web/src/features/auth/no-workspace-panel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csAuth from '../../../../../packages/i18n/messages/cs/auth.json';
import { NoWorkspacePanel } from './no-workspace-panel';

const messages = { auth: csAuth };

function renderPanel(canCreate = true) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <NoWorkspacePanel action={vi.fn()} canCreate={canCreate} />
    </NextIntlClientProvider>,
  );
}

describe('NoWorkspacePanel', () => {
  it('použije doslovný text z 5.3 části 1', () => {
    renderPanel();
    expect(
      screen.getByText('Nemáte přístup k žádnému projektu. Požádejte o pozvánku, nebo si založte vlastní.'),
    ).toBeInTheDocument();
  });

  it('nabídne založení projektu jako primární akci', () => {
    renderPanel();
    expect(screen.getByLabelText('Název projektu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Založit projekt' })).not.toHaveAttribute('disabled');
  });

  it('když instalace zakládání nepovoluje, formulář nevykreslí a nabídne kontrolu znovu', () => {
    renderPanel(false);
    expect(screen.queryByLabelText('Název projektu')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zkontrolovat znovu' })).toHaveAttribute('href', '/no-workspace');
  });

  it('nabídne odhlášení', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Odhlásit se' })).toBeInTheDocument();
  });

  it('nese skryté pole s klíčem idempotence', () => {
    const { container } = renderPanel();
    expect(container.querySelector('input[name="_idempotency_key"]')).not.toBeNull();
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/auth/no-workspace-panel.test.tsx`
Expected: FAIL, `Failed to resolve import "./no-workspace-panel"`.

- [ ] **Krok 3: Napiš panel a stránku**

`apps/web/src/features/auth/no-workspace-panel.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { SubmitButton } from '@/lib/forms/submit-button';
import { IdempotencyField } from '@/lib/feedback/idempotency-field';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { AuthCard } from './auth-card';
import { AuthProblem } from './action-problem';

export type NoWorkspacePanelProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  /** `SIGNUP_MODE` a role rozhodují, jestli si uživatel smí projekt založit. */
  canCreate: boolean;
  initialState?: ActionState;
};

export function NoWorkspacePanel({ action, canCreate, initialState }: NoWorkspacePanelProps) {
  const t = useTranslations('auth');
  const [state, formAction] = useActionState(action, initialState ?? IDLE);

  return (
    <AuthCard
      title={t('noWorkspace.title')}
      footer={
        <form action="/api/v1/auth/logout" method="post">
          <Button type="submit" variant="ghost">
            {t('noWorkspace.signOut')}
          </Button>
        </form>
      }
    >
      <p className="text-[--color-text-muted]">{t('noWorkspace.body')}</p>

      {state.status === 'error' ? (
        <div className="mt-4">
          <AuthProblem problem={state.problem} />
        </div>
      ) : null}

      {canCreate ? (
        <form action={formAction} className="mt-6">
          <IdempotencyField />
          <div className="mb-4">
            <Label htmlFor="name">{t('noWorkspace.workspaceName')}</Label>
            <Input id="name" name="name" />
          </div>
          <SubmitButton label={t('noWorkspace.create')} pendingLabel={t('noWorkspace.creating')} />
        </form>
      ) : (
        <p className="mt-6">
          <Link href="/no-workspace" className="underline">
            {t('noWorkspace.refresh')}
          </Link>
        </p>
      )}
    </AuthCard>
  );
}
```

`apps/web/src/app/[locale]/(account)/no-workspace/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { config } from '@mlain/core/config';
import { createWorkspaceAction } from '@/features/auth/actions';
import { NoWorkspacePanel } from '@/features/auth/no-workspace-panel';
import { requireUser } from '@/lib/identity/require-user';
import { AuthProblem } from '@/features/auth/action-problem';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('noWorkspace.title') };
}

export default async function NoWorkspacePage() {
  const me = await requireUser('/no-workspace');
  if (!me.ok) return <AuthProblem problem={me.problem} />;

  const first = me.data.memberships[0];
  if (first) redirect(`/w/${first.workspace_slug}`);

  return <NoWorkspacePanel action={createWorkspaceAction} canCreate={config.SIGNUP_MODE !== 'closed'} />;
}
```

**Proč přesměrování.** Uživatel, který mezitím pozvánku přijal, nemá na téhle obrazovce co dělat. Přesměrování na první projekt je levnější než tlačítko „Zkontrolovat znovu", které by musel zmáčknout.

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/features/auth/no-workspace-panel.test.tsx`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Krok 5: Spusť všechny testy přihlašovací části**

Run: `pnpm --filter @mlain/web exec vitest run src/features/auth/`
Expected: PASS, `Tests  35 passed (35)`.

- [ ] **Krok 6: Commit**

```bash
git add apps/web/src/features/auth "apps/web/src/app/[locale]/(account)/no-workspace"
git commit -m "feat(web): no workspace screen with the empty state from the spec"
```

---

### Úkol 18: Profil, osobní údaje

**Soubory:**
- Create: `apps/web/src/features/settings/settings-problem.tsx`
- Create: `apps/web/src/features/settings/timezones.ts`
- Create: `apps/web/src/features/profile/actions.ts`
- Create: `apps/web/src/features/profile/profile-form.tsx`
- Create: `apps/web/src/features/profile/profile-form.test.tsx`
- Create: `apps/web/src/app/[locale]/(account)/settings/profile/page.tsx`

Podle 5.3 části 1 má profil čtyři části: jméno, jazyk, zóna, změna hesla a aktivní relace. Tenhle úkol dodává první tři, další dva úkoly zbytek.

Ukládání jména, jazyka a zóny je třída **A1** (okamžitá vratná), takže podle tabulky 5.2 části 6 je zpětná vazba **inline**: stav „Uloženo" v hlavičce formuláře, který zmizí po 3 sekundách. Toast by tu byl šum, protože výsledek je vidět v poli.

- [ ] **Krok 1: Napiš blok chyby pro nastavení**

`apps/web/src/features/settings/settings-problem.tsx`:

```tsx
'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { Problem } from '@/lib/api-client/problem';
import { SETTINGS_ERROR_KEYS, errorTextKeys } from '@/lib/errors/error-keys';
import { ProblemBlock } from '@/lib/errors/problem-block';

export type SettingsProblemProps = {
  problem: Problem;
  onRetry?: () => void;
  values?: Record<string, string | number>;
};

export function SettingsProblem({ problem, onRetry, values }: SettingsProblemProps) {
  const t = useTranslations('settings');
  const format = useFormatter();
  const keys = errorTextKeys(SETTINGS_ERROR_KEYS, problem.code);
  const occurredAt = new Date().toISOString();

  return (
    <ProblemBlock
      problem={problem}
      title={keys ? t(keys.title) : t('errors.fallback.title')}
      body={keys ? t(keys.body, values ?? {}) : problem.detail || t('errors.fallback.body')}
      occurredAt={occurredAt}
      onRetry={onRetry}
      labels={{
        technicalDetails: t('errorBlock.detailsSummary'),
        code: t('errorBlock.code'),
        requestId: t('errorBlock.requestId'),
        time: t('errorBlock.time'),
        copyBlock: t('errorBlock.copyAll'),
        copied: t('errorBlock.copied'),
        tryAgain: t('errorBlock.retry'),
      }}
    />
  );
}
```

- [ ] **Krok 2: Napiš seznam časových zón**

`apps/web/src/features/settings/timezones.ts`:

```ts
/**
 * Seznam zón se bere z běhového prostředí, ne z natvrdo psaného výčtu.
 * `Intl.supportedValuesOf` je v Node 24 i ve všech cílových prohlížečích.
 * Náhrada je jediná dvojice hodnot, aby formulář neztratil pole ani ve starém běhu.
 */
export function supportedTimezones(): string[] {
  if (typeof Intl.supportedValuesOf === 'function') {
    return Intl.supportedValuesOf('timeZone');
  }
  return ['Europe/Prague', 'UTC'];
}
```

- [ ] **Krok 3: Napiš padající test formuláře profilu**

`apps/web/src/features/profile/profile-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { ActionState } from '@/lib/feedback/action-result';
import { ProfileForm } from './profile-form';

const messages = { settings: csSettings };

const USER = {
  id: 'u1',
  email: 'jana@firma.cz',
  name: 'Jana Nováková',
  locale: 'cs',
  timezone: 'Europe/Prague',
};

function renderForm(initialState?: ActionState) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <ProfileForm
        action={vi.fn()}
        user={USER}
        locales={['cs', 'en']}
        timezones={['Europe/Prague', 'UTC']}
        initialState={initialState}
      />
    </NextIntlClientProvider>,
  );
}

describe('ProfileForm', () => {
  it('předvyplní jméno, jazyk a zónu', () => {
    renderForm();
    expect(screen.getByLabelText('Jméno a příjmení')).toHaveValue('Jana Nováková');
    expect(screen.getByLabelText('Jazyk rozhraní')).toHaveValue('cs');
    expect(screen.getByLabelText('Časová zóna')).toHaveValue('Europe/Prague');
  });

  it('e-mail ukáže jako text, ne jako upravitelné pole', () => {
    renderForm();
    expect(screen.getByText('jana@firma.cz')).toBeInTheDocument();
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument();
    expect(screen.getByText(/měnit se zatím nedá/)).toBeInTheDocument();
  });

  it('po uložení ukáže inline stav Uloženo, ne toast', () => {
    renderForm({ status: 'success', channel: 'inline', messageKey: 'profile.identity.saved' });
    const saved = screen.getByText('Uloženo');
    expect(saved.closest('[role="status"]')).not.toBeNull();
  });

  it('chybu pole ukáže u pole', () => {
    renderForm({
      status: 'error',
      channel: 'inline',
      problem: {
        type: '',
        title: 'Validation failed',
        status: 422,
        detail: '',
        instance: '/api/v1/auth/me',
        code: 'validation_failed',
        request_id: 'req_1',
        errors: [{ path: 'timezone', code: 'unknown', message: 'Tuhle zónu neznáme.' }],
      },
      fieldErrors: { timezone: ['Tuhle zónu neznáme.'] },
    });
    expect(screen.getByLabelText('Časová zóna')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Tuhle zónu neznáme.')).toBeInTheDocument();
  });

  it('vysvětlí, k čemu jméno a zóna slouží', () => {
    renderForm();
    expect(screen.getByText(/v audit logu/)).toBeInTheDocument();
    expect(screen.getByText(/zobrazujeme časy v celém nástroji/)).toBeInTheDocument();
  });
});
```

- [ ] **Krok 4: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/profile/profile-form.test.tsx`
Expected: FAIL, `Failed to resolve import "./profile-form"`.

- [ ] **Krok 5: Napiš Server Actions profilu**

`apps/web/src/features/profile/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiMutate } from '@/lib/api-client/mutate';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';

function validationProblem(instance: string, issues: Array<{ path: string; code: string; message: string }>) {
  return {
    type: 'https://docs.mlain.dev/errors/validation_failed',
    title: 'Validation failed',
    status: 422,
    detail: '',
    instance,
    code: 'validation_failed',
    request_id: '',
    errors: issues,
  };
}

const ProfileSchema = z.object({
  name: z.string().trim().max(200),
  locale: z.string().min(2),
  timezone: z.string().min(1),
});

export async function updateProfileAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = ProfileSchema.safeParse({
    name: formData.get('name'),
    locale: formData.get('locale'),
    timezone: formData.get('timezone'),
  });

  if (!parsed.success) {
    return failed(
      'inline',
      validationProblem(
        '/api/v1/auth/me',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      ),
    );
  }

  const result = await apiMutate<void>('/api/v1/auth/me', { method: 'PATCH', body: parsed.data });
  if (!result.ok) return failed('inline', result.problem);

  revalidatePath('/settings/profile');
  return succeeded({ channel: 'inline', messageKey: 'profile.identity.saved' });
}

const ChangePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(12).max(256),
});

export async function changePasswordAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = ChangePasswordSchema.safeParse({
    current_password: formData.get('current_password'),
    new_password: formData.get('new_password'),
  });

  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem(
        '/api/v1/auth/change-password',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      ),
    );
  }

  const result = await apiMutate<void>('/api/v1/auth/change-password', { method: 'POST', body: parsed.data });
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath('/settings/profile');
  return succeeded({ channel: 'inlineBlock', messageKey: 'profile.password.doneTitle' });
}

export async function revokeSessionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('session_id') ?? '');
  const result = await apiMutate<void>(`/api/v1/auth/sessions/${id}`, { method: 'DELETE' });
  if (!result.ok) return failed('toast', result.problem);

  revalidatePath('/settings/profile');
  return succeeded({ channel: 'toast', messageKey: 'profile.sessions.revoked' });
}

export async function logoutAllAction(): Promise<never> {
  await apiMutate<void>('/api/v1/auth/logout-all', { method: 'POST' });
  redirect('/login');
}

export async function logoutAction(): Promise<never> {
  await apiMutate<void>('/api/v1/auth/logout', { method: 'POST' });
  redirect('/login');
}
```

**Proč `logoutAllAction` nevrací `ActionState`.** Po odhlášení ze všech zařízení přestane platit i aktuální cookie, takže není komu výsledek ukázat. Jediná správná zpětná vazba je přesměrování na přihlášení, tedy kanál `page` z tabulky 5.2. Katalog akcí to má zapsané jako třídu A5.

- [ ] **Krok 6: Napiš formulář profilu**

`apps/web/src/features/profile/profile-form.tsx`:

```tsx
'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { SelectField } from '@/lib/forms/select-field';
import { localeLabel } from '@/lib/i18n/locale-label';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';

export type ProfileUser = {
  id: string;
  email: string;
  name: string;
  locale: string;
  timezone: string;
};

export type ProfileFormProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  user: ProfileUser;
  locales: readonly string[];
  timezones: readonly string[];
  initialState?: ActionState;
};

export function ProfileForm({ action, user, locales, timezones, initialState }: ProfileFormProps) {
  const t = useTranslations('settings');
  const uiLocale = useLocale();
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  const [savedVisible, setSavedVisible] = useState(state.status === 'success');
  useEffect(() => {
    if (state.status !== 'success') return;
    setSavedVisible(true);
    const timer = window.setTimeout(() => setSavedVisible(false), 3000);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <section aria-labelledby="profile-identity">
      <div className="flex items-baseline justify-between">
        <h2 id="profile-identity" className="text-xl font-semibold">
          {t('profile.identity.title')}
        </h2>
        <p role="status" className="text-sm text-[--color-text-muted]">
          {savedVisible ? t('profile.identity.saved') : ''}
        </p>
      </div>

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mt-4">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      <form ref={formRef} action={formAction} className="mt-4" noValidate>
        <div className="mb-4">
          <Label htmlFor="name">{t('profile.identity.name')}</Label>
          <Input id="name" name="name" defaultValue={user.name} autoComplete="name" {...fieldAria('name', fieldErrors)} />
          <p className="mt-1 text-sm text-[--color-text-muted]">{t('profile.identity.nameHint')}</p>
          <FieldError name="name" errors={fieldErrors} />
        </div>

        <div className="mb-4">
          <p className="font-medium">{t('profile.identity.email')}</p>
          <p className="mt-1">{user.email}</p>
          <p className="mt-1 text-sm text-[--color-text-muted]">{t('profile.identity.emailHint')}</p>
        </div>

        <div className="mb-4">
          <SelectField
            name="locale"
            label={t('profile.identity.locale')}
            placeholder={t('shared.selectPlaceholder')}
            defaultValue={user.locale}
            options={locales.map((locale) => ({ value: locale, label: localeLabel(locale, uiLocale) }))}
            errors={fieldErrors}
          />
        </div>

        <div className="mb-6">
          <SelectField
            name="timezone"
            label={t('profile.identity.timezone')}
            placeholder={t('shared.selectPlaceholder')}
            defaultValue={user.timezone}
            options={timezones.map((zone) => ({ value: zone, label: zone }))}
            hint={t('profile.identity.timezoneHint')}
            errors={fieldErrors}
          />
        </div>

        <SubmitButton label={t('shared.save')} pendingLabel={t('shared.saving')} />
      </form>
    </section>
  );
}
```

- [ ] **Krok 7: Napiš stránku profilu**

`apps/web/src/app/[locale]/(account)/settings/profile/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SUPPORTED_LOCALES } from '@mlain/i18n/locales';
import { updateProfileAction } from '@/features/profile/actions';
import { ProfileForm } from '@/features/profile/profile-form';
import { ChangePasswordForm } from '@/features/profile/change-password-form';
import { SessionsSection, type SessionRow } from '@/features/profile/sessions-section';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { supportedTimezones } from '@/features/settings/timezones';
import { apiFetch } from '@/lib/api-client/fetch';
import { requireUser } from '@/lib/identity/require-user';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('profile.title') };
}

export default async function ProfilePage() {
  const t = await getTranslations('settings');

  // Obě čtení běží naráz, aby vedle sebe nevznikl vodopád dvou požadavků.
  const [me, sessions] = await Promise.all([
    requireUser('/settings/profile'),
    apiFetch<{ data: SessionRow[] }>('/api/v1/auth/sessions'),
  ]);

  if (!me.ok) return <SettingsProblem problem={me.problem} />;

  return (
    <>
      <h1 className="text-2xl font-semibold">{t('profile.title')}</h1>
      <p className="mt-2 text-[--color-text-muted]">{t('profile.lead')}</p>

      <div className="mt-8 space-y-12">
        <ProfileForm
          action={updateProfileAction}
          user={me.data.user}
          locales={SUPPORTED_LOCALES}
          timezones={supportedTimezones()}
        />
        <ChangePasswordForm />
        <SessionsSection sessions={sessions} />
      </div>
    </>
  );
}
```

**Stav S8 (částečná data) je tady vidět.** Když selže načtení relací, formulář s osobními údaji funguje dál a chybu si vykreslí jen sekce relací. Přesně to žádá matice 7.2 části 6 u typu obrazovky Nastavení.

- [ ] **Krok 8: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/features/profile/profile-form.test.tsx`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Krok 9: Commit**

```bash
git add apps/web/src/features/profile apps/web/src/features/settings \
        "apps/web/src/app/[locale]/(account)/settings"
git commit -m "feat(web): profile screen with personal details"
```

---

### Úkol 19: Změna hesla v profilu

**Soubory:**
- Create: `apps/web/src/features/profile/change-password-form.tsx`
- Create: `apps/web/src/features/profile/change-password-form.test.tsx`
- Create: `apps/web/test/p06/change-password.test.ts`
- Modify: `packages/i18n/messages/cs/settings.json`, `packages/i18n/messages/en/settings.json` (dva klíče v `shared`)

Změna hesla je třída **A3** (Argon2id trvá stovky milisekund) a úroveň ochrany **N2**: má následek pro ostatní zařízení, takže se to musí říct **předem**, ne až po akci. Kritérium 17 části 1 se ověřuje integračním testem proti reálnému API, ne pohledem.

- [ ] **Krok 1: Doplň dva klíče do katalogů**

Do objektu `shared` v `packages/i18n/messages/cs/settings.json` přidej:

```json
"showPassword": "Zobrazit heslo",
"hidePassword": "Skrýt heslo"
```

Do objektu `shared` v `packages/i18n/messages/en/settings.json` přidej:

```json
"showPassword": "Show password",
"hidePassword": "Hide password"
```

- [ ] **Krok 2: Napiš padající test formuláře**

`apps/web/src/features/profile/change-password-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { ActionState } from '@/lib/feedback/action-result';
import { ChangePasswordFormView } from './change-password-form';

const messages = { settings: csSettings };

function renderForm(initialState?: ActionState) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <ChangePasswordFormView action={vi.fn()} initialState={initialState} />
    </NextIntlClientProvider>,
  );
}

describe('ChangePasswordFormView', () => {
  it('upozorní předem na odhlášení ostatních zařízení', () => {
    renderForm();
    expect(screen.getByText(/odhlásíme ze všech ostatních zařízení/)).toBeInTheDocument();
    expect(screen.getByText(/Tahle karta zůstane přihlášená/)).toBeInTheDocument();
  });

  it('má dvě pole hesel se správnými hodnotami autocomplete', () => {
    renderForm();
    expect(screen.getByLabelText('Současné heslo')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText('Nové heslo')).toHaveAttribute('autocomplete', 'new-password');
  });

  it('po úspěchu ukáže inline blok, ne toast', () => {
    renderForm({ status: 'success', channel: 'inlineBlock', messageKey: 'profile.password.doneTitle' });
    expect(screen.getByText('Heslo je změněné')).toBeInTheDocument();
    expect(screen.getByText(/Ostatní relace jsme ukončili/)).toBeInTheDocument();
  });

  it('u špatného současného hesla označí to pole, ne obě', () => {
    renderForm({
      status: 'error',
      channel: 'inlineBlock',
      problem: {
        type: '',
        title: 'Validation failed',
        status: 422,
        detail: '',
        instance: '/api/v1/auth/change-password',
        code: 'validation_failed',
        request_id: 'req_1',
        errors: [{ path: 'current_password', code: 'invalid', message: 'Současné heslo nesedí.' }],
      },
      fieldErrors: { current_password: ['Současné heslo nesedí.'] },
    });
    expect(screen.getByLabelText('Současné heslo')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Nové heslo')).not.toHaveAttribute('aria-invalid');
  });

  it('primární tlačítko nemá disabled', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Změnit heslo' })).not.toHaveAttribute('disabled');
  });
});
```

- [ ] **Krok 3: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/profile/change-password-form.test.tsx`
Expected: FAIL, `Failed to resolve import "./change-password-form"`.

- [ ] **Krok 4: Napiš formulář**

`apps/web/src/features/profile/change-password-form.tsx`:

```tsx
'use client';

import { useActionState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { PasswordField } from '@/lib/forms/password-field';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { changePasswordAction } from './actions';

export type ChangePasswordFormViewProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  initialState?: ActionState;
};

export function ChangePasswordFormView({ action, initialState }: ChangePasswordFormViewProps) {
  const t = useTranslations('settings');
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  return (
    <section aria-labelledby="profile-password">
      <h2 id="profile-password" className="text-xl font-semibold">
        {t('profile.password.title')}
      </h2>
      <p className="mt-2 text-[--color-text-muted]">{t('profile.password.lead')}</p>

      {state.status === 'success' ? (
        <div role="status" className="mt-4 rounded-md border border-[--color-success] bg-[--color-surface-muted] p-4">
          <p className="font-medium">{t('profile.password.doneTitle')}</p>
          <p className="mt-1 text-sm text-[--color-text-muted]">{t('profile.password.doneBody')}</p>
        </div>
      ) : null}

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mt-4">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      <form ref={formRef} action={formAction} className="mt-4" noValidate>
        <PasswordField
          name="current_password"
          label={t('profile.password.current')}
          autoComplete="current-password"
          errors={fieldErrors}
          showLabel={t('shared.showPassword')}
          hideLabel={t('shared.hidePassword')}
        />
        <PasswordField
          name="new_password"
          label={t('profile.password.next')}
          autoComplete="new-password"
          errors={fieldErrors}
          showLabel={t('shared.showPassword')}
          hideLabel={t('shared.hidePassword')}
        />
        <SubmitButton label={t('profile.password.submit')} pendingLabel={t('profile.password.submitting')} />
      </form>
    </section>
  );
}

/** Serverová obálka, aby stránka nemusela znát akci. */
export function ChangePasswordForm() {
  return <ChangePasswordFormView action={changePasswordAction} />;
}
```

- [ ] **Krok 5: Napiš integrační test kritéria 17**

`apps/web/test/p06/change-password.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '@/lib/api/app';

const ORIGIN = process.env.APP_URL ?? 'http://localhost:3000';
const EMAIL = 'p06-change-password@example.com';
const OLD_PASSWORD = 'puvodni heslo dost dlouhe';
const NEW_PASSWORD = 'nove heslo jeste delsi';

async function login(password: string): Promise<{ cookie: string; csrf: string }> {
  const response = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email: EMAIL, password }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  const me = await app.request('/api/v1/auth/me', { headers: { cookie } });
  const payload = (await me.json()) as { csrf_token: string };
  return { cookie, csrf: payload.csrf_token };
}

beforeAll(async () => {
  await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({
      email: EMAIL,
      password: OLD_PASSWORD,
      name: 'Změna hesla',
      workspace_name: 'Změna hesla',
      locale: 'cs',
    }),
  });
});

describe('kritérium 17 části 1', () => {
  it('změna hesla revokuje ostatní relace a tuhle nechá', async () => {
    const other = await login(OLD_PASSWORD);
    const current = await login(OLD_PASSWORD);

    const changed = await app.request('/api/v1/auth/change-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        cookie: current.cookie,
        'x-csrf-token': current.csrf,
      },
      body: JSON.stringify({ current_password: OLD_PASSWORD, new_password: NEW_PASSWORD }),
    });
    expect(changed.status).toBe(204);

    const withOldSession = await app.request('/api/v1/auth/me', { headers: { cookie: other.cookie } });
    expect(withOldSession.status).toBe(401);

    const withCurrentSession = await app.request('/api/v1/auth/me', { headers: { cookie: current.cookie } });
    expect(withCurrentSession.status).toBe(200);
  });
});
```

- [ ] **Krok 6: Spusť oba testy**

Run: `pnpm --filter @mlain/web exec vitest run src/features/profile/change-password-form.test.tsx`
Expected: PASS, `Tests  5 passed (5)`.

Run: `pnpm --filter @mlain/web test:db -- test/p06/change-password.test.ts`
Expected: PASS, `Tests  1 passed (1)`.

- [ ] **Krok 7: Commit**

```bash
git add apps/web/src/features/profile apps/web/test/p06 \
        packages/i18n/messages/cs/settings.json packages/i18n/messages/en/settings.json
git commit -m "feat(web): change password section with a warning about other sessions"
```

---

### Úkol 20: Aktivní relace a odhlášení ze všech zařízení

**Soubory:**
- Create: `apps/web/src/features/profile/describe-device.ts`
- Create: `apps/web/src/features/profile/describe-device.test.ts`
- Create: `apps/web/src/features/profile/sessions-section.tsx`
- Create: `apps/web/src/features/profile/sessions-section.test.tsx`

Seznam relací je **seznam**, takže platí povinné stavy z 5.3 části 1: skeleton, prázdný stav, chyba s `request_id` a s tlačítkem „Zkusit znovu", stav bez oprávnění. Poslední z nich tu nikdy nenastane, protože jde o vlastní relace uživatele.

Odhlášení ze všech zařízení je **A5 a N2**: nevratné pro ostatní karty a týká se i té, ve které uživatel právě je. Kritérium 18 části 1 to žádá výslovně.

- [ ] **Krok 1: Napiš padající test popisu zařízení**

`apps/web/src/features/profile/describe-device.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { describeDevice } from './describe-device';

const FALLBACK = 'Neznámé zařízení';

describe('describeDevice', () => {
  it('u prázdné hodnoty vrátí náhradní text', () => {
    expect(describeDevice('', FALLBACK)).toBe(FALLBACK);
    expect(describeDevice('   ', FALLBACK)).toBe(FALLBACK);
  });

  it('pozná Safari na macOS', () => {
    const agent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
    expect(describeDevice(agent, FALLBACK)).toBe('Safari, Macintosh');
  });

  it('pozná Chrome na Windows', () => {
    const agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36';
    expect(describeDevice(agent, FALLBACK)).toBe('Chrome, Windows NT 10.0');
  });

  it('u nerozpoznaného řetězce vrátí náhradní text, ne syrový user agent', () => {
    expect(describeDevice('curl/8.4.0', FALLBACK)).toBe(FALLBACK);
  });

  it('nikdy nevrátí celý user agent', () => {
    const agent = 'Mozilla/5.0 (X11; Linux x86_64) Firefox/141.0';
    expect(describeDevice(agent, FALLBACK)).not.toContain('Mozilla/5.0');
  });
});
```

- [ ] **Krok 2: Napiš implementaci popisu zařízení**

`apps/web/src/features/profile/describe-device.ts`:

```ts
const BROWSERS = ['Firefox', 'Edg', 'Chrome', 'Safari'] as const;
const PLATFORMS = ['Macintosh', 'Windows NT 10.0', 'Windows NT 11.0', 'X11', 'iPhone', 'iPad', 'Android'] as const;

/**
 * Řetězec user agenta se uživateli neukazuje syrový: podle 10.4 části 6 se
 * technické detaily do rozhraní nepouštějí. Jméno prohlížeče a systému stačí
 * k tomu, aby své zařízení poznal.
 */
export function describeDevice(userAgent: string, fallback: string): string {
  const value = userAgent.trim();
  if (value === '') return fallback;

  const browser = BROWSERS.find((name) => value.includes(`${name}/`));
  const platform = PLATFORMS.find((name) => value.includes(name));

  const parts = [browser, platform].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? fallback : parts.join(', ');
}
```

**Pořadí v `BROWSERS` je záměrné.** Chrome i Edge nesou v řetězci `Safari/`, takže se hledá od nejspecifičtějšího. `X11` se ukazuje jako `X11`, protože distribuci z user agenta stejně nepoznáme a hádat ji je horší než ji neuvádět.

- [ ] **Krok 3: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/features/profile/describe-device.test.ts`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Krok 4: Napiš padající test sekce relací**

`apps/web/src/features/profile/sessions-section.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { Result } from '@/lib/api-client/result';
import { SessionsSectionView, type SessionRow } from './sessions-section';

const messages = { settings: csSettings };

const ROWS: SessionRow[] = [
  {
    id: 's1',
    ip: '192.168.1.10',
    user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
    last_used_at: '2026-07-31T12:00:00.000Z',
    created_at: '2026-07-20T09:00:00.000Z',
    current: true,
  },
  {
    id: 's2',
    ip: '10.0.0.5',
    user_agent: '',
    last_used_at: '2026-07-30T18:00:00.000Z',
    created_at: '2026-07-01T09:00:00.000Z',
    current: false,
  },
];

function renderSection(sessions: Result<{ data: SessionRow[] }>) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <SessionsSectionView sessions={sessions} revokeAction={vi.fn()} onLogoutAll={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe('SessionsSectionView', () => {
  it('vypíše relace a označí tu aktuální', () => {
    renderSection({ ok: true, data: { data: ROWS } });
    expect(screen.getByText('Tato relace')).toBeInTheDocument();
    expect(screen.getByText(/192\.168\.1\.10/)).toBeInTheDocument();
  });

  it('u aktuální relace nenabídne odhlášení jednoho zařízení', () => {
    renderSection({ ok: true, data: { data: ROWS } });
    expect(screen.getAllByRole('button', { name: 'Odhlásit toto zařízení' })).toHaveLength(1);
  });

  it('u neznámého prohlížeče použije náhradní text', () => {
    renderSection({ ok: true, data: { data: ROWS } });
    expect(screen.getByText('Neznámé zařízení')).toBeInTheDocument();
  });

  it('u prázdného seznamu ukáže vysvětlení a akci, ne prázdnou tabulku', () => {
    renderSection({ ok: true, data: { data: [] } });
    const empty = screen.getByTestId('empty-state');
    expect(within(empty).getByTestId('empty-explanation')).toHaveTextContent(csSettings.profile.sessions.empty);
    expect(within(empty).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('u chyby ukáže blok s request_id a s tlačítkem Zkusit znovu', () => {
    renderSection({
      ok: false,
      problem: {
        type: '',
        title: 'Dependency timeout',
        status: 504,
        detail: '',
        instance: '/api/v1/auth/sessions',
        code: 'dependency_timeout',
        request_id: 'req_7',
      },
    });
    expect(screen.getByText('req_7')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
  });

  it('odhlášení ze všech zařízení má potvrzovací dialog s počtem a s větou o téhle kartě', async () => {
    renderSection({ ok: true, data: { data: ROWS } });
    await userEvent.click(screen.getByRole('button', { name: 'Odhlásit ze všech zařízení' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/2 relace, tuhle kartu nevyjímaje/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nechat přihlášené' })).toBeInTheDocument();
  });

  it('u chyby se tlačítko odhlášení ze všech zařízení nevykreslí', () => {
    renderSection({
      ok: false,
      problem: {
        type: '',
        title: 'Service unavailable',
        status: 503,
        detail: '',
        instance: '/api/v1/auth/sessions',
        code: 'service_unavailable',
        request_id: '',
      },
    });
    expect(screen.queryByRole('button', { name: 'Odhlásit ze všech zařízení' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Krok 5: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/profile/sessions-section.test.tsx`
Expected: FAIL, `Failed to resolve import "./sessions-section"`.

- [ ] **Krok 6: Napiš sekci relací**

`apps/web/src/features/profile/sessions-section.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { DeviceIcon } from '@/lib/ui/status-icons';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { EmptyState } from '@mlain/ui/patterns/states';
import type { Result } from '@/lib/api-client/result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { describeDevice } from './describe-device';
import { logoutAllAction, revokeSessionAction } from './actions';

export type SessionRow = {
  id: string;
  ip: string | null;
  user_agent: string;
  last_used_at: string;
  created_at: string;
  current: boolean;
};

export type SessionsSectionViewProps = {
  sessions: Result<{ data: SessionRow[] }>;
  revokeAction: (previous: unknown, formData: FormData) => Promise<unknown>;
  onLogoutAll: () => void | Promise<void>;
};

export function SessionsSectionView({ sessions, revokeAction, onLogoutAll }: SessionsSectionViewProps) {
  const t = useTranslations('settings');
  const confirmLabels = useConfirmDialogLabels();
  const format = useFormatter();
  const [dialogOpen, setDialogOpen] = useState(false);

  const rows = sessions.ok ? sessions.data.data : [];

  return (
    <section aria-labelledby="profile-sessions">
      <div className="flex items-baseline justify-between">
        <h2 id="profile-sessions" className="text-xl font-semibold">
          {t('profile.sessions.title')}
        </h2>
        {sessions.ok && rows.length > 0 ? (
          <Button type="button" variant="danger" onClick={() => setDialogOpen(true)}>
            {t('profile.sessions.logoutAll')}
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-[--color-text-muted]">{t('profile.sessions.lead')}</p>

      {!sessions.ok ? (
        <div className="mt-4">
          <SettingsProblem problem={sessions.problem} onRetry={() => window.location.reload()} />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            variant="first"
            title={t('profile.sessions.title')}
            explanation={t('profile.sessions.empty')}
            actions={[{ label: t('profile.sessions.emptyAction'), onClick: () => window.location.reload() }]}
          />
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-[--color-border]">
          {rows.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="font-medium">
                  {describeDevice(session.user_agent, t('profile.sessions.unknownDevice'))}
                  {session.current ? (
                    <Badge className="ml-2" tone="accent" icon={DeviceIcon}>
                      {t('profile.sessions.thisSession')}
                    </Badge>
                  ) : null}
                </p>
                <p className="text-sm text-[--color-text-muted]">
                  {session.ip ?? ''} {t('profile.sessions.lastUsed')}{' '}
                  <time dateTime={session.last_used_at} title={session.last_used_at}>
                    {format.relativeTime(new Date(session.last_used_at))}
                  </time>
                </p>
              </div>
              {session.current ? null : (
                <form action={revokeAction as never}>
                  <input type="hidden" name="session_id" value={session.id} readOnly />
                  <Button type="submit" variant="secondary">
                    {t('profile.sessions.revoke')}
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        level="N2"
        title={t('profile.sessions.logoutAllDialogTitle')}
        consequences={[
          t('profile.sessions.logoutAllConsequence', { count: rows.length }),
          t('profile.sessions.logoutAllConsequenceWork'),
        ]}
        confirmLabel={t('profile.sessions.logoutAllConfirm')}
        cancelLabel={t('profile.sessions.logoutAllCancel')}
        onConfirm={onLogoutAll}
        labels={confirmLabels}
      />
    </section>
  );
}

/** Serverová obálka, aby stránka nemusela znát akce. */
export function SessionsSection({ sessions }: { sessions: Result<{ data: SessionRow[] }> }) {
  return <SessionsSectionView sessions={sessions} revokeAction={revokeSessionAction} onLogoutAll={logoutAllAction} />;
}
```

- [ ] **Krok 7: Spusť všechny testy profilu**

Run: `pnpm --filter @mlain/web exec vitest run src/features/profile/`
Expected: PASS, `Tests  22 passed (22)`.

- [ ] **Krok 8: Commit**

```bash
git add apps/web/src/features/profile
git commit -m "feat(web): active sessions list and sign out everywhere"
```

---

### Úkol 21: Skořápka nastavení projektu, sub-navigace a stav bez oprávnění

**Soubory:**
- Create: `apps/web/src/features/settings/settings-nav.tsx`
- Create: `apps/web/src/features/settings/settings-nav.test.tsx`
- Create: `apps/web/src/features/settings/settings-page-shell.tsx`
- Create: `apps/web/src/features/settings/forbidden-section.tsx`
- Create: `apps/web/src/features/settings/forbidden-section.test.tsx`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/layout.tsx`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/page.tsx`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/account/page.tsx`

Dvě pravidla z 7.2b části 6 platí bez výjimky:

1. **Celá sekce navigace se smí skrýt.** Kdo nemá `audit:read`, položku Audit log v menu nevidí.
2. **Akce uvnitř obrazovky, kterou uživatel vidí, se skrývat nesmí.** Vidí tlačítko a vidí, proč ho nemůže použít.

Přímý přístup na skrytou sekci vrací stav S11 s vysvětlením a odkazem zpět, ne prázdnou stránku.

- [ ] **Krok 1: Napiš padající test sub-navigace**

`apps/web/src/features/settings/settings-nav.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csCommon from '../../../../../packages/i18n/messages/cs/common.json';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { SettingsNav } from './settings-nav';

vi.mock('next/navigation', () => ({ usePathname: () => '/w/eshop/settings/members' }));

// Popisky navigace leží v `common`, protože registr vlastní P05 a nezná,
// kdo ho vykreslí. Test proto potřebuje oba katalogy.
const messages = { common: csCommon, settings: csSettings };

function renderNav(permissions: string[]) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <SettingsNav workspaceSlug="eshop" permissions={permissions} />
    </NextIntlClientProvider>,
  );
}

/**
 * Oprávnění jsou ta, která u položek skutečně stojí v registru P05,
 * ne ta, která by se dala odhadnout z názvu obrazovky. Rozdíl je u dvou:
 * `settings-general` chce `workspace:update` (ne `workspace:read`)
 * a `settings-members` chce `members:invite` (ne `members:read`).
 */
const OWNER = [
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'members:read',
  'members:invite',
  'api_keys:read',
  'webhooks:read',
  'audit:read',
];

describe('SettingsNav', () => {
  it('vlastníkovi ukáže všech šest položek MVP 0', () => {
    renderNav(OWNER);
    for (const label of ['Projekt', 'Tým', 'Klíče k API', 'Webhooky', 'Audit log', 'Můj účet']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('prohlížejícímu nechá jen Můj účet, protože ostatní položky mají oprávnění', () => {
    renderNav(['workspace:read']);
    // Můj účet je v registru bez oprávnění: je to vlastní profil uživatele.
    expect(screen.getByRole('link', { name: 'Můj účet' })).toBeInTheDocument();
    for (const label of ['Projekt', 'Tým', 'Klíče k API', 'Webhooky', 'Audit log']) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
    }
  });

  it('editorovi ukáže webhooky, ale ne klíče a audit', () => {
    renderNav(['workspace:read', 'webhooks:read']);
    expect(screen.getByRole('link', { name: 'Webhooky' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Klíče k API' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });

  it('nezobrazuje položky mimo MVP 0', () => {
    renderNav(OWNER);
    expect(screen.queryByRole('link', { name: 'Odesílání' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Zálohy' })).not.toBeInTheDocument();
  });

  it('aktuální položku označí přes aria-current', () => {
    renderNav(OWNER);
    expect(screen.getByRole('link', { name: 'Tým' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Projekt' })).not.toHaveAttribute('aria-current');
  });

  it('odkazy nesou slug projektu a staví je visibleNavigation, ne tenhle soubor', () => {
    renderNav(OWNER);
    expect(screen.getByRole('link', { name: 'Klíče k API' })).toHaveAttribute('href', '/w/eshop/settings/api-keys');
  });

  it('navigace má přístupné jméno', () => {
    renderNav(OWNER);
    expect(screen.getByRole('navigation', { name: 'Nastavení' })).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/settings/settings-nav.test.tsx`
Expected: FAIL, `Failed to resolve import "./settings-nav"`.

- [ ] **Krok 3: Napiš sub-navigaci**

`apps/web/src/features/settings/settings-nav.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { visibleNavigation } from '@mlain/ui/patterns/navigation';

export type SettingsNavProps = {
  workspaceSlug: string;
  /** Oprávnění aktéra, spočítaná na serveru. Klient matici nezná. */
  permissions: readonly string[];
};

/**
 * Sekce, na kterou uživatel nemá oprávnění, se v navigaci nezobrazuje
 * (5.2 části 1 a pravidlo 1 v 7.2b části 6).
 *
 * Filtrování si tenhle soubor **nepíše sám**. `visibleNavigation` z P05
 * odfiltruje položky bez oprávnění, zahodí rezervované i ty s `mvp0: false`,
 * dopočítá `href` se slugem a zahodí sekci, které nezbyla ani jedna viditelná
 * podpoložka. Právě to poslední pravidlo se při druhém psaní zapomíná, a dvě
 * pravidla pro totéž se dřív nebo později rozejdou.
 *
 * Oprávnění u položek jsou ta, která v registru skutečně stojí. `settings-general`
 * chce `workspace:update`, takže prohlížející položku „Projekt" v menu neuvidí,
 * i když obrazovku samotnou vidět má (stav S12). Je to nález N57 na straně P05;
 * P06 se do té doby řídí registrem, jak je, a testy to popisují pravdivě.
 *
 * Popisky nesou klíč **plnou cestou** (`common.nav.settingsMembers`) a leží
 * v katalogu `common`, který vlastní P05. Klíč se nepřipojuje ani neořezává,
 * předává se tak, jak v registru je, takže zákaz skládání klíčů za běhu
 * (kritérium 71 části 6) platí dál.
 */
export function SettingsNav({ workspaceSlug, permissions }: SettingsNavProps) {
  const t = useTranslations('settings');
  const tRoot = useTranslations();
  const pathname = usePathname();

  const settings = visibleNavigation({
    permissions: [...permissions],
    workspaceSlug,
  }).find((section) => section.id === 'settings');
  const items = settings?.children ?? [];

  // Celá sekce zmizela, protože uživatel nemá ani jednu podpoložku.
  if (items.length === 0) return null;

  return (
    <nav aria-label={t('nav.sectionLabel')}>
      <ul className="space-y-1">
        {items.map((item) => {
          const href = item.href;
          const current = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={item.id}>
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={
                  current
                    ? 'block rounded-md bg-[--color-surface-muted] px-3 py-2 font-medium'
                    : 'block rounded-md px-3 py-2 text-[--color-text-muted] hover:bg-[--color-surface-muted]'
                }
              >
                {tRoot(item.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Krok 4: Napiš padající test stavu bez oprávnění**

`apps/web/src/features/settings/forbidden-section.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { ForbiddenSection } from './forbidden-section';

vi.mock('next-intl/server', () => ({
  getTranslations: async () => {
    const { createTranslator } = await import('next-intl');
    return createTranslator({ locale: 'cs', messages: { settings: csSettings }, namespace: 'settings' });
  },
}));

describe('ForbiddenSection', () => {
  it('pojmenuje chybějící oprávnění, role, které ho mají, a roli uživatele', async () => {
    render(await ForbiddenSection({ permission: 'audit:read', currentRole: 'viewer', workspaceSlug: 'eshop' }));
    expect(screen.getByText(/audit:read/)).toBeInTheDocument();
    expect(screen.getByText(/Správce, Vlastník/)).toBeInTheDocument();
    expect(screen.getByText(/Prohlížející/)).toBeInTheDocument();
  });

  it('bez jmen ze serveru odkáže na roli, ne na osobu', async () => {
    render(await ForbiddenSection({ permission: 'api_keys:read', currentRole: 'editor', workspaceSlug: 'eshop' }));
    expect(screen.getByText('Roli vám může změnit vlastník nebo správce projektu.')).toBeInTheDocument();
  });

  it('se jmény ze serveru odkáže na konkrétního člověka', async () => {
    render(
      await ForbiddenSection({
        permission: 'api_keys:read',
        currentRole: 'editor',
        workspaceSlug: 'eshop',
        problem: {
          type: '',
          title: 'Forbidden',
          status: 403,
          detail: '',
          instance: '/api/v1/api-keys',
          code: 'forbidden',
          request_id: 'req_1',
          params: { contactableMembers: ['Petr Svoboda'] },
        },
      }),
    );
    expect(screen.getByText('Roli vám může změnit Petr Svoboda.')).toBeInTheDocument();
  });

  it('nabídne cestu zpět a drží kód v data-error-code', async () => {
    const { container } = render(
      await ForbiddenSection({ permission: 'audit:read', currentRole: 'viewer', workspaceSlug: 'eshop' }),
    );
    expect(screen.getByRole('link', { name: 'Zpět na přehled projektu' })).toHaveAttribute('href', '/w/eshop');
    expect(container.querySelector('[data-error-code="forbidden"]')).not.toBeNull();
  });

  it('uvnitř obrazovky neschovává nic, jen vysvětluje', async () => {
    render(await ForbiddenSection({ permission: 'audit:read', currentRole: 'viewer', workspaceSlug: 'eshop' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
```

- [ ] **Krok 5: Napiš stav bez oprávnění a skořápku stránky**

`apps/web/src/features/settings/forbidden-section.tsx`:

```tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ForbiddenState } from '@mlain/ui/patterns/states';
import { ROLE_LABEL_KEYS } from '@/features/members/role-label';
import type { Problem } from '@/lib/api-client/problem';
import { rolesGranting, type Permission, type Role } from '@/lib/identity/permissions';

export type ForbiddenSectionProps = {
  permission: Permission;
  currentRole: Role;
  workspaceSlug: string;
  /**
   * Když blokaci vrátil server, nese `params.contactableMembers[]` se jmény
   * lidí, kteří roli mohou změnit (předpoklad E8). Když blokuje rozhraní samo,
   * jméno nemáme a text se odkáže na roli, ne na osobu.
   */
  problem?: Problem;
};

/**
 * Stav S11 z 7.1 části 6. Říká, které oprávnění chybí, které role ho mají,
 * jakou roli má uživatel a kdo s tím může něco udělat.
 */
export async function ForbiddenSection({ permission, currentRole, workspaceSlug, problem }: ForbiddenSectionProps) {
  const t = await getTranslations('settings');

  const granting = rolesGranting(permission)
    .map((role) => t(ROLE_LABEL_KEYS[role]))
    .join(', ');

  // P04 posílá `contactableMembers` jako pole objektů `{ name, email, role }`,
  // ne jako pole řetězců. Dřívější čtení jako `string[]` by vždycky vyhodnotilo
  // `undefined` a jméno kolegy by se nikdy nezobrazilo, aniž by cokoli spadlo.
  const contacts = problem?.params?.contactableMembers;
  const first = Array.isArray(contacts) ? (contacts[0] as { name?: string; email?: string } | undefined) : undefined;
  const contactName = first?.name !== undefined && first.name !== '' ? first.name : first?.email;

  return (
    <ForbiddenState
      code="forbidden"
      requestId={problem?.request_id ?? ''}
      title={t('states.forbiddenTitle')}
      body={t('states.forbiddenBody', {
        permission,
        roles: granting,
        currentRole: t(ROLE_LABEL_KEYS[currentRole]),
      })}
      whoCanHelp={
        contactName === undefined
          ? t('states.forbiddenWhoCanHelp')
          : t('states.forbiddenWhoCanHelpNamed', { name: contactName })
      }
      action={
        <Link href={`/w/${workspaceSlug}`} className="underline">
          {t('states.forbiddenBack')}
        </Link>
      }
    />
  );
}
```

`apps/web/src/features/settings/settings-page-shell.tsx`:

```tsx
import type { ReactNode } from 'react';
import { ReadOnlyBanner } from '@mlain/ui/patterns/states';

export type SettingsPageShellProps = {
  title: string;
  lead?: string;
  /** Primární akce vpravo v hlavičce, viz rozložení 4.2 části 6. */
  action?: ReactNode;
  /** Pruh stavu S12. Formuláře pod ním se vykreslují jako text, ne zašedle. */
  /** Důvod jedinou větou. `ReadOnlyBanner` z P05 bere `reason`, ne nadpis a popis. */
  readOnly?: { reason: string };
  children: ReactNode;
};

export function SettingsPageShell({ title, lead, action, readOnly, children }: SettingsPageShellProps) {
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {lead ? <p className="mt-2 text-[--color-text-muted]">{lead}</p> : null}
        </div>
        {action}
      </div>
      {readOnly ? (
        <div className="mt-4">
          <ReadOnlyBanner reason={readOnly.reason} />
        </div>
      ) : null}
      <div className="mt-8">{children}</div>
    </div>
  );
}
```

- [ ] **Krok 6: Napiš layout a přesměrování na obecné nastavení**

`apps/web/src/app/[locale]/w/[workspaceSlug]/settings/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { SettingsNav } from '@/features/settings/settings-nav';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { requireUser } from '@/lib/identity/require-user';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';

export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const me = await requireUser(`/w/${workspaceSlug}/settings`);
  if (!me.ok) return <SettingsProblem problem={me.problem} />;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  return (
    <div className="grid gap-8 md:grid-cols-[14rem_1fr]">
      <aside>
        <SettingsNav workspaceSlug={workspaceSlug} permissions={access.data.permissions} />
      </aside>
      <div>{children}</div>
    </div>
  );
}
```

`apps/web/src/app/[locale]/w/[workspaceSlug]/settings/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

export default async function SettingsIndexPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  redirect(`/w/${workspaceSlug}/settings/general`);
}
```

`apps/web/src/app/[locale]/w/[workspaceSlug]/settings/account/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

/**
 * Registr navigace P05 má u položky „Můj účet" cestu `/settings/account`,
 * tedy uvnitř projektu. Profil je ale osobní, ne projektový, a bydlí na
 * `/settings/profile` mimo skořápku projektu (5.3 části 1).
 *
 * Bez tohohle přesměrování by šestá položka menu vedla na 404. Registr
 * vlastní P05 a uzávěr S5 zakazuje měnit v něm cestu, takže se to řeší
 * na straně P06, jedním souborem, který nic nevykresluje.
 */
export default function WorkspaceAccountPage() {
  redirect('/settings/profile');
}
```

- [ ] **Krok 7: Spusť testy a ověř, že procházejí**

Run: `pnpm --filter @mlain/web exec vitest run src/features/settings/`
Expected: PASS, `Tests  12 passed (12)`.

- [ ] **Krok 8: Commit**

```bash
git add apps/web/src/features/settings "apps/web/src/app/[locale]/w"
git commit -m "feat(web): settings shell, permission filtered sub navigation, forbidden state"
```

---

### Úkol 22: Obrazovka `/w/{slug}/settings/general`

**Soubory:**
- Create: `apps/web/src/features/workspace-settings/actions.ts`
- Create: `apps/web/src/features/workspace-settings/general-form.tsx`
- Create: `apps/web/src/features/workspace-settings/general-form.test.tsx`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/general/page.tsx`

Obrazovku vidí **každý člen** (`workspace:read` má i `viewer`), ale měnit ji smí jen `workspace:update`, tedy owner a admin. Role bez zápisu dostane stav **S12 jen pro čtení**: hodnoty se vykreslí jako text, ne jako zašedlá pole, a nahoře je pruh s důvodem. Kritérium 23 kapitoly 15.3 části 6 to žádá výslovně.

- [ ] **Krok 1: Napiš padající test formuláře**

`apps/web/src/features/workspace-settings/general-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { ActionState } from '@/lib/feedback/action-result';
import { GeneralForm } from './general-form';

const messages = { settings: csSettings };

const WORKSPACE = {
  id: 'ws1',
  name: 'E-shop Kolo',
  slug: 'eshop-kolo',
  locale: 'cs',
  timezone: 'Europe/Prague',
  address_form: 'formal' as const,
  created_at: '2026-01-01T00:00:00.000Z',
};

function renderForm(canWrite: boolean, initialState?: ActionState) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <GeneralForm
        action={vi.fn()}
        workspace={WORKSPACE}
        locales={['cs', 'en']}
        timezones={['Europe/Prague', 'UTC']}
        canWrite={canWrite}
        initialState={initialState}
      />
    </NextIntlClientProvider>,
  );
}

describe('GeneralForm', () => {
  it('předvyplní název, adresu, jazyk a zónu', () => {
    renderForm(true);
    expect(screen.getByLabelText('Název projektu')).toHaveValue('E-shop Kolo');
    expect(screen.getByLabelText('Adresa projektu')).toHaveValue('eshop-kolo');
    expect(screen.getByLabelText('Jazyk projektu')).toHaveValue('cs');
    expect(screen.getByLabelText('Časová zóna projektu')).toHaveValue('Europe/Prague');
  });

  it('upozorní, že změna adresy rozbije poslané odkazy', () => {
    renderForm(true);
    expect(screen.getByText(/rozbije odkazy, které jste už poslali/)).toBeInTheDocument();
  });

  it('bez oprávnění zápisu ukáže hodnoty jako text, ne jako zašedlá pole', () => {
    renderForm(false);
    expect(screen.queryByLabelText('Název projektu')).not.toBeInTheDocument();
    expect(screen.getByText('E-shop Kolo')).toBeInTheDocument();
    // Hledá se **každý** zašedlý ovládací prvek, ne jen nativní `select`.
    // `Select` z P05 stojí na Radixu a vykreslí `<button>`, takže dotaz na
    // `select[disabled]` by nikdy nic nenašel a kontrola by procházela
    // naprázdno, ať by v DOM bylo cokoli.
    const disabled = document.querySelectorAll(
      'input[disabled], select[disabled], button[disabled], textarea[disabled], [aria-disabled="true"], [data-disabled]',
    );
    expect(disabled).toHaveLength(0);
  });

  it('bez oprávnění zápisu nevykreslí tlačítko Uložit', () => {
    renderForm(false);
    expect(screen.queryByRole('button', { name: 'Uložit' })).not.toBeInTheDocument();
  });

  it('po uložení ukáže inline stav Uloženo', () => {
    renderForm(true, { status: 'success', channel: 'inline', messageKey: 'shared.saved' });
    expect(screen.getByText('Uloženo').closest('[role="status"]')).not.toBeNull();
  });

  it('chybu jedinečnosti adresy ukáže u pole slug', () => {
    renderForm(true, {
      status: 'error',
      channel: 'inline',
      problem: {
        type: '',
        title: 'Validation failed',
        status: 422,
        detail: '',
        instance: '/api/v1/workspaces/ws1',
        code: 'validation_failed',
        request_id: 'req_1',
        errors: [{ path: 'slug', code: 'already_exists', message: 'Tuhle adresu už jiný projekt má.' }],
      },
      fieldErrors: { slug: ['Tuhle adresu už jiný projekt má.'] },
    });
    expect(screen.getByLabelText('Adresa projektu')).toHaveAttribute('aria-invalid', 'true');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/workspace-settings/general-form.test.tsx`
Expected: FAIL, `Failed to resolve import "./general-form"`.

- [ ] **Krok 3: Napiš Server Actions nastavení projektu**

`apps/web/src/features/workspace-settings/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiMutate } from '@/lib/api-client/mutate';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';

function validationProblem(instance: string, issues: Array<{ path: string; code: string; message: string }>) {
  return {
    type: 'https://docs.mlain.dev/errors/validation_failed',
    title: 'Validation failed',
    status: 422,
    detail: '',
    instance,
    code: 'validation_failed',
    request_id: '',
    errors: issues,
  };
}

const GeneralSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  locale: z.string().min(2),
  timezone: z.string().min(1),
});

export async function updateWorkspaceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = GeneralSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    name: formData.get('name'),
    slug: formData.get('slug'),
    locale: formData.get('locale'),
    timezone: formData.get('timezone'),
  });

  if (!parsed.success) {
    return failed(
      'inline',
      validationProblem(
        '/api/v1/workspaces',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      ),
    );
  }

  const { workspace_id: workspaceId, ...body } = parsed.data;
  const result = await apiMutate<{ slug: string }>(`/api/v1/workspaces/${workspaceId}`, {
    method: 'PATCH',
    body,
    workspaceId,
  });
  if (!result.ok) return failed('inline', result.problem);

  // Slug je součástí cesty, takže po jeho změně musí uživatel skončit na nové adrese.
  if (result.data.slug !== formData.get('current_slug')) {
    redirect(`/w/${result.data.slug}/settings/general`);
  }

  revalidatePath(`/w/${result.data.slug}/settings/general`);
  return succeeded({ channel: 'inline', messageKey: 'shared.saved' });
}

const AddressFormSchema = z.object({
  workspace_id: z.string().min(1),
  address_form: z.enum(['formal', 'informal']),
});

export async function updateAddressFormAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = AddressFormSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    address_form: formData.get('address_form'),
  });
  if (!parsed.success) {
    return failed(
      'page',
      validationProblem('/api/v1/workspaces', [
        { path: 'address_form', code: 'invalid', message: 'Vyberte vykání, nebo tykání.' },
      ]),
    );
  }

  const { workspace_id: workspaceId, address_form: addressForm } = parsed.data;
  const result = await apiMutate<void>(`/api/v1/workspaces/${workspaceId}`, {
    method: 'PATCH',
    body: { address_form: addressForm },
    workspaceId,
  });
  if (!result.ok) return failed('page', result.problem);

  revalidatePath(`/w/${String(formData.get('slug'))}/settings/general`);
  return succeeded({ channel: 'page', messageKey: 'general.addressForm.started' });
}

const DeleteSchema = z.object({
  workspace_id: z.string().min(1),
  confirm_name: z.string().min(1),
});

export async function deleteWorkspaceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = DeleteSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    confirm_name: formData.get('confirm_name'),
  });
  if (!parsed.success) {
    return failed(
      'page',
      validationProblem('/api/v1/workspaces', [
        { path: 'confirm_name', code: 'required', message: 'Opište název projektu.' },
      ]),
    );
  }

  const { workspace_id: workspaceId, confirm_name: confirmName } = parsed.data;
  const result = await apiMutate<void>(`/api/v1/workspaces/${workspaceId}`, {
    method: 'DELETE',
    body: { confirm_name: confirmName },
    workspaceId,
  });
  if (!result.ok) return failed('page', result.problem);

  redirect('/no-workspace');
}
```

- [ ] **Krok 4: Napiš formulář**

`apps/web/src/features/workspace-settings/general-form.tsx`:

```tsx
'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { SelectField } from '@/lib/forms/select-field';
import { localeLabel } from '@/lib/i18n/locale-label';
import { ReadOnlyValue } from '@mlain/ui/patterns/states';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import type { Workspace } from '@/lib/identity/workspace-access';

export type GeneralFormProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  workspace: Workspace;
  locales: readonly string[];
  timezones: readonly string[];
  canWrite: boolean;
  initialState?: ActionState;
};

/**
 * Vysvětlivku pod hodnotou skládá volající, protože `ReadOnlyValue` z P05
 * bere `value` jako `ReactNode`. Vlastní kopii komponenty si P06 nepíše:
 * dvě jména pro totéž ve dvou balíčcích se dřív nebo později rozejdou.
 */
function valueWithHint(value: string, hint?: string) {
  if (hint === undefined) return value;
  return (
    <>
      {value}
      <span className="mt-1 block text-sm text-[--color-text-muted]">{hint}</span>
    </>
  );
}

export function GeneralForm({ action, workspace, locales, timezones, canWrite, initialState }: GeneralFormProps) {
  const t = useTranslations('settings');
  const uiLocale = useLocale();
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  const [savedVisible, setSavedVisible] = useState(state.status === 'success');
  useEffect(() => {
    if (state.status !== 'success') return;
    setSavedVisible(true);
    const timer = window.setTimeout(() => setSavedVisible(false), 3000);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (!canWrite) {
    return (
      <section aria-labelledby="general-identity">
        <h2 id="general-identity" className="text-xl font-semibold">
          {t('general.title')}
        </h2>
        <p className="mt-2 text-[--color-text-muted]">{t('states.readOnlyTitle')}</p>
        <div className="mt-4 space-y-4">
          <ReadOnlyValue label={t('general.name')} value={workspace.name} />
          <ReadOnlyValue label={t('general.slug')} value={workspace.slug} />
          <ReadOnlyValue
            label={t('general.locale')}
            value={valueWithHint(workspace.locale, t('general.localeHint'))}
          />
          <ReadOnlyValue
            label={t('general.timezone')}
            value={valueWithHint(workspace.timezone, t('general.timezoneHint'))}
          />
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="general-identity">
      <div className="flex items-baseline justify-between">
        <h2 id="general-identity" className="text-xl font-semibold">
          {t('general.title')}
        </h2>
        <p role="status" className="text-sm text-[--color-text-muted]">
          {savedVisible ? t('shared.saved') : ''}
        </p>
      </div>

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mt-4">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      <form ref={formRef} action={formAction} className="mt-4" noValidate>
        <input type="hidden" name="workspace_id" value={workspace.id} readOnly />
        <input type="hidden" name="current_slug" value={workspace.slug} readOnly />

        <div className="mb-4">
          <Label htmlFor="name">{t('general.name')}</Label>
          <Input id="name" name="name" defaultValue={workspace.name} {...fieldAria('name', fieldErrors)} />
          <FieldError name="name" errors={fieldErrors} />
        </div>

        <div className="mb-4">
          <Label htmlFor="slug">{t('general.slug')}</Label>
          <Input id="slug" name="slug" defaultValue={workspace.slug} {...fieldAria('slug', fieldErrors)} />
          <p className="mt-1 text-sm text-[--color-text-muted]">{t('general.slugHint', { slug: workspace.slug })}</p>
          <p className="mt-1 text-sm text-[--color-warning]">{t('general.slugChangeWarning')}</p>
          <FieldError name="slug" errors={fieldErrors} />
        </div>

        <div className="mb-4">
          <SelectField
            name="locale"
            label={t('general.locale')}
            placeholder={t('shared.selectPlaceholder')}
            defaultValue={workspace.locale}
            options={locales.map((locale) => ({ value: locale, label: localeLabel(locale, uiLocale) }))}
            hint={t('general.localeHint')}
            errors={fieldErrors}
          />
        </div>

        <div className="mb-6">
          <SelectField
            name="timezone"
            label={t('general.timezone')}
            placeholder={t('shared.selectPlaceholder')}
            defaultValue={workspace.timezone}
            options={timezones.map((zone) => ({ value: zone, label: zone }))}
            hint={t('general.timezoneHint')}
            errors={fieldErrors}
          />
        </div>

        <SubmitButton label={t('shared.save')} pendingLabel={t('shared.saving')} />
      </form>
    </section>
  );
}
```

- [ ] **Krok 5: Napiš stránku**

`apps/web/src/app/[locale]/w/[workspaceSlug]/settings/general/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SUPPORTED_LOCALES } from '@mlain/i18n/locales';
import { updateWorkspaceAction } from '@/features/workspace-settings/actions';
import { GeneralForm } from '@/features/workspace-settings/general-form';
import { AddressFormSection } from '@/features/workspace-settings/address-form-section';
import { DangerZone } from '@/features/workspace-settings/danger-zone';
import { SettingsPageShell } from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { supportedTimezones } from '@/features/settings/timezones';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';
import { ROLE_LABEL_KEYS } from '@/features/members/role-label';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('general.title') };
}

export default async function GeneralSettingsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const t = await getTranslations('settings');

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  const canWrite = hasPermission(access.data, 'workspace:update');
  const canDelete = hasPermission(access.data, 'workspace:delete');

  // Počet kontaktů je jen podklad pro text dialogu o oslovení. Když selže,
  // sekce funguje dál a dialog místo počtu neuvede nic (stav S8).
  const contactCount = await apiFetch<{ count: number }>('/api/v1/contacts/count', {
    workspaceId: access.data.workspace.id,
  });

  return (
    <SettingsPageShell
      title={t('general.title')}
      lead={t('general.lead', { projectName: access.data.workspace.name })}
      readOnly={
        canWrite
          ? undefined
          : {
              reason: t('states.readOnlyBody', {
                currentRole: t(ROLE_LABEL_KEYS[access.data.role]),
                permission: 'workspace:update',
              }),
            }
      }
    >
      <div className="space-y-12">
        <GeneralForm
          action={updateWorkspaceAction}
          workspace={access.data.workspace}
          locales={SUPPORTED_LOCALES}
          timezones={supportedTimezones()}
          canWrite={canWrite}
        />
        <AddressFormSection
          workspace={access.data.workspace}
          canWrite={canWrite}
          contactCount={contactCount.ok ? contactCount.data.count : 0}
        />
        {canDelete ? <DangerZone workspace={access.data.workspace} /> : null}
      </div>
    </SettingsPageShell>
  );
}
```

**Proč se sekce smazání skrývá celá.** Smazání projektu má jen owner (`workspace:delete`). Pravidlo 2 z 7.2b části 6 zakazuje skrývat akce **uvnitř obrazovky, kterou uživatel vidí**, ale tady nejde o akci uvnitř obsahu, nýbrž o celý blok nebezpečné zóny, který je z pohledu uživatele samostatná sekce. Admin, který ji nikdy neviděl, o ni nepřijde, a nabízet mu tlačítko, které vždy skončí na 403, by bylo horší.

- [ ] **Krok 6: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/features/workspace-settings/general-form.test.tsx`
Expected: PASS, `Tests  6 passed (6)`.

- [ ] **Krok 7: Commit**

```bash
git add apps/web/src/features/workspace-settings "apps/web/src/app/[locale]/w"
git commit -m "feat(web): project general settings with read only state"
```

---

### Úkol 23: Oslovení projektu, vykání nebo tykání

**Soubory:**
- Create: `apps/web/src/features/workspace-settings/address-form-section.tsx`
- Create: `apps/web/src/features/workspace-settings/address-form-section.test.tsx`

Sloupec `workspaces.address_form` (`formal` nebo `informal`) vlastní část 1. Podle části 2 (kapitola 3.12 a poznámka u 4.5) spustí jeho změna **přepočet 5. pádu u všech kontaktů**, což je dlouhá operace na pozadí. Uživatel to musí vědět předem.

**Zařazení podle 6.1 části 6:** rozsah 2 (nad 100 položek), obnovitelnost 0 (plně vratné přepnutím zpět), vnější dopad 1 (ovlivní kolegy v projektu), součet 3, tedy úroveň **N2**: potvrzovací dialog se souhrnem a počtem. Opisování názvu by tu bylo tření bez přidané ochrany, protože akce je vratná.

**Rozhraní vyká vždy.** Tohle nastavení se týká **e-mailů odesílaných kontaktům**, ne rozhraní nástroje. Text u pole to říká výslovně, aby si nikdo nemyslel, že si tím přepne aplikaci do tykání.

- [ ] **Krok 1: Napiš padající test**

`apps/web/src/features/workspace-settings/address-form-section.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { AddressFormSectionView } from './address-form-section';

const messages = { settings: csSettings };

const WORKSPACE = {
  id: 'ws1',
  name: 'E-shop Kolo',
  slug: 'eshop-kolo',
  locale: 'cs',
  timezone: 'Europe/Prague',
  address_form: 'formal' as const,
  created_at: '2026-01-01T00:00:00.000Z',
};

function renderSection(canWrite = true, contactCount = 12480, addressForm: 'formal' | 'informal' = 'formal') {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <AddressFormSectionView
        workspace={{ ...WORKSPACE, address_form: addressForm }}
        canWrite={canWrite}
        contactCount={contactCount}
        action={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe('AddressFormSectionView', () => {
  it('řekne, že se nastavení týká e-mailů, ne rozhraní', () => {
    renderSection();
    expect(screen.getByText(/Rozhraní nástroje vám vyká vždy/)).toBeInTheDocument();
  });

  it('ukáže obě volby s ukázkou oslovení', () => {
    renderSection();
    expect(screen.getByLabelText(/Vykání/)).toBeChecked();
    expect(screen.getByText('Dobrý den, Jano,')).toBeInTheDocument();
    expect(screen.getByText('Ahoj Jano,')).toBeInTheDocument();
  });

  it('stav nesděluje jen barvou, ale i slovem', () => {
    renderSection();
    expect(screen.getByLabelText(/Vykání/)).toHaveAttribute('type', 'radio');
  });

  it('po volbě druhé možnosti otevře potvrzovací dialog s počtem kontaktů', async () => {
    renderSection();
    await userEvent.click(screen.getByLabelText(/Tykání/));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/12 480 kontaktů/)).toBeInTheDocument();
    expect(screen.getByText(/běží na pozadí/)).toBeInTheDocument();
  });

  it('dialog nabídne ústup, který vrátí původní volbu', async () => {
    renderSection();
    await userEvent.click(screen.getByLabelText(/Tykání/));
    await userEvent.click(screen.getByRole('button', { name: 'Nechat vykání' }));
    expect(screen.getByLabelText(/Vykání/)).toBeChecked();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('u nula kontaktů použije tvar pro nulu, ne „0 kontaktů"', async () => {
    renderSection(true, 0);
    await userEvent.click(screen.getByLabelText(/Tykání/));
    expect(screen.getByText(/žádného kontaktu/)).toBeInTheDocument();
  });

  it('bez oprávnění zápisu ukáže jen aktuální hodnotu jako text', () => {
    renderSection(false);
    expect(screen.queryByLabelText(/Tykání/)).not.toBeInTheDocument();
    expect(screen.getByText('Vykání')).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/workspace-settings/address-form-section.test.tsx`
Expected: FAIL, `Failed to resolve import "./address-form-section"`.

- [ ] **Krok 3: Napiš sekci**

`apps/web/src/features/workspace-settings/address-form-section.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { RadioGroup } from '@mlain/ui/components/radio-group';
import type { ActionState } from '@/lib/feedback/action-result';
import type { Workspace } from '@/lib/identity/workspace-access';
import { updateAddressFormAction } from './actions';

export type AddressForm = 'formal' | 'informal';

export type AddressFormSectionViewProps = {
  workspace: Workspace;
  canWrite: boolean;
  contactCount: number;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
};

const LABEL_KEYS = {
  formal: 'general.addressForm.formal',
  informal: 'general.addressForm.informal',
} as const satisfies Record<AddressForm, string>;

const EXAMPLE_KEYS = {
  formal: 'general.addressForm.formalExample',
  informal: 'general.addressForm.informalExample',
} as const satisfies Record<AddressForm, string>;

export function AddressFormSectionView({ workspace, canWrite, contactCount, action }: AddressFormSectionViewProps) {
  const t = useTranslations('settings');
  const confirmLabels = useConfirmDialogLabels();
  const formRef = useRef<HTMLFormElement>(null);
  const [pendingValue, setPendingValue] = useState<AddressForm | null>(null);
  const current = workspace.address_form;

  if (!canWrite) {
    return (
      <section aria-labelledby="general-address-form">
        <h2 id="general-address-form" className="text-xl font-semibold">
          {t('general.addressForm.label')}
        </h2>
        <p className="mt-2 text-[--color-text-muted]">{t('general.addressForm.hint')}</p>
        <p className="mt-4 font-medium">{t(LABEL_KEYS[current])}</p>
      </section>
    );
  }

  const target: AddressForm = pendingValue ?? (current === 'formal' ? 'informal' : 'formal');

  return (
    <section aria-labelledby="general-address-form">
      <h2 id="general-address-form" className="text-xl font-semibold">
        {t('general.addressForm.label')}
      </h2>
      <p className="mt-2 text-[--color-text-muted]">{t('general.addressForm.hint')}</p>

      <form ref={formRef} action={action as never} className="mt-4">
        <input type="hidden" name="workspace_id" value={workspace.id} readOnly />
        <input type="hidden" name="slug" value={workspace.slug} readOnly />
        <input type="hidden" name="address_form" value={target} readOnly />

        <RadioGroup
          name="address_form_choice"
          value={pendingValue ?? current}
          onValueChange={(value: string) => {
            if (value !== current) setPendingValue(value as AddressForm);
          }}
        >
          {(['formal', 'informal'] as const).map((option) => (
            <label key={option} className="flex items-start gap-3 rounded-md border border-[--color-border] p-3">
              <input
                type="radio"
                name="address_form_choice"
                value={option}
                checked={(pendingValue ?? current) === option}
                onChange={() => {
                  if (option !== current) setPendingValue(option);
                }}
              />
              <span>
                <span className="font-medium">{t(LABEL_KEYS[option])}</span>
                <span className="mt-1 block text-sm text-[--color-text-muted]">{t(EXAMPLE_KEYS[option])}</span>
              </span>
            </label>
          ))}
        </RadioGroup>

        <ConfirmDialog
          open={pendingValue !== null}
          onOpenChange={(open: boolean) => {
            if (!open) setPendingValue(null);
          }}
          level="N2"
          title={t('general.addressForm.dialogTitle', { target: t(LABEL_KEYS[target]) })}
          consequences={[
            t('general.addressForm.dialogConsequence1', { count: contactCount }),
            t('general.addressForm.dialogConsequence2'),
            t('general.addressForm.dialogConsequence3'),
          ]}
          confirmLabel={t('general.addressForm.dialogConfirm', { target: t(LABEL_KEYS[target]) })}
          cancelLabel={t('general.addressForm.dialogCancel', { current: t(LABEL_KEYS[current]) })}
          // Přepnutí oslovení je vratné: přepne se zpátky a přepočet doběhne znovu.
          irreversible={false}
          onConfirm={() => formRef.current?.requestSubmit()}
          labels={confirmLabels}
        />
      </form>
    </section>
  );
}

/** Serverová obálka, aby stránka nemusela znát akci. */
export function AddressFormSection(props: Omit<AddressFormSectionViewProps, 'action'>) {
  return <AddressFormSectionView {...props} action={updateAddressFormAction} />;
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/features/workspace-settings/address-form-section.test.tsx`
Expected: PASS, `Tests  7 passed (7)`.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/workspace-settings
git commit -m "feat(web): project greeting setting with an n2 confirmation"
```

---

### Úkol 24: Smazání projektu, úroveň N4 s opisováním názvu

**Soubory:**
- Create: `apps/web/src/features/workspace-settings/danger-zone.tsx`
- Create: `apps/web/src/features/workspace-settings/danger-zone.test.tsx`

Smazání projektu má podle 6.2 části 6 součet 6, tedy úroveň **N4**: dialog se souhrnem, počtem, výčtem následků a **opsáním identifikátoru**. Je to jediná akce v P06, která opisování má, a je to v souladu s pravidlem z 6.2: opisování zbývá jen tam, kde vratnost technicky neexistuje a kde je akce natolik vzácná, že si tření může dovolit.

Text je v 5.3 části 1 hotový a přebírá se doslova: „Smazání odstraní všechny kontakty, kampaně i statistiky. Obnovit to jde 30 dní. Pro potvrzení opište název projektu."

- [ ] **Krok 1: Napiš padající test**

`apps/web/src/features/workspace-settings/danger-zone.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { DangerZoneView } from './danger-zone';

const messages = { settings: csSettings };

const WORKSPACE = {
  id: 'ws1',
  name: 'E-shop Kolo',
  slug: 'eshop-kolo',
  locale: 'cs',
  timezone: 'Europe/Prague',
  address_form: 'formal' as const,
  created_at: '2026-01-01T00:00:00.000Z',
};

function renderZone() {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <DangerZoneView workspace={WORKSPACE} action={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe('DangerZoneView', () => {
  it('použije doslovný text z 5.3 části 1', () => {
    renderZone();
    expect(
      screen.getByText(
        'Smazání odstraní všechny kontakty, kampaně i statistiky. Obnovit to jde 30 dní. Pro potvrzení opište název projektu.',
      ),
    ).toBeInTheDocument();
  });

  it('destruktivní tlačítko je vidět a je barevně odlišené, ne schované v nabídce', () => {
    renderZone();
    const button = screen.getByRole('button', { name: 'Smazat projekt' });
    expect(button).toHaveAttribute('data-variant', 'danger');
  });

  it('dialog vyjmenuje následky a připomene třicetidenní okno', async () => {
    renderZone();
    await userEvent.click(screen.getByRole('button', { name: 'Smazat projekt' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Zmizí všechny kontakty, seznamy, segmenty a štítky/)).toBeInTheDocument();
    expect(screen.getByText(/Klíče k API a webhooky projektu okamžitě přestanou fungovat/)).toBeInTheDocument();
    expect(screen.getByText(/obnovit 30 dní/)).toBeInTheDocument();
  });

  it('vyžaduje opsání názvu projektu', async () => {
    renderZone();
    await userEvent.click(screen.getByRole('button', { name: 'Smazat projekt' }));
    expect(screen.getByLabelText('Pro potvrzení opište název projektu')).toBeInTheDocument();
  });

  it('název v tlačítku i v nadpisu dialogu je konkrétní', async () => {
    renderZone();
    await userEvent.click(screen.getByRole('button', { name: 'Smazat projekt' }));
    expect(screen.getByRole('heading', { name: 'Smazat projekt E-shop Kolo?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Smazat projekt E-shop Kolo' })).toBeInTheDocument();
  });

  it('tlačítko ústupu je vlevo a je pojmenované slovesem, ne slovem Ne', async () => {
    renderZone();
    await userEvent.click(screen.getByRole('button', { name: 'Smazat projekt' }));
    expect(screen.getByRole('button', { name: 'Nechat projekt' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ne' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
  });

  it('opsaný název jde do těla požadavku jako confirm_name', async () => {
    const { container } = renderZone();
    await userEvent.click(screen.getByRole('button', { name: 'Smazat projekt' }));
    await userEvent.type(screen.getByLabelText('Pro potvrzení opište název projektu'), 'E-shop Kolo');
    expect(container.querySelector('input[name="confirm_name"]')).toHaveValue('E-shop Kolo');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/workspace-settings/danger-zone.test.tsx`
Expected: FAIL, `Failed to resolve import "./danger-zone"`.

- [ ] **Krok 3: Napiš nebezpečnou zónu**

`apps/web/src/features/workspace-settings/danger-zone.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import type { ActionState } from '@/lib/feedback/action-result';
import type { Workspace } from '@/lib/identity/workspace-access';
import { deleteWorkspaceAction } from './actions';

export type DangerZoneViewProps = {
  workspace: Workspace;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
};

export function DangerZoneView({ workspace, action }: DangerZoneViewProps) {
  const t = useTranslations('settings');
  const confirmLabels = useConfirmDialogLabels();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  return (
    <section aria-labelledby="general-danger" className="rounded-lg border border-[--color-danger] p-6">
      <h2 id="general-danger" className="text-xl font-semibold">
        {t('general.danger.title')}
      </h2>
      <p className="mt-2 text-[--color-text-muted]">{t('general.danger.body')}</p>

      <form ref={formRef} action={action as never} className="mt-4">
        <input type="hidden" name="workspace_id" value={workspace.id} readOnly />
        <input type="hidden" name="confirm_name" value={typed} readOnly />

        <Button type="button" variant="danger" data-variant="danger" onClick={() => setOpen(true)}>
          {t('general.danger.button')}
        </Button>

        <ConfirmDialog
          open={open}
          onOpenChange={(next: boolean) => {
            setOpen(next);
            if (!next) setTyped('');
          }}
          level="N4"
          title={t('general.danger.dialogTitle', { name: workspace.name })}
          consequences={[
            t('general.danger.consequence1'),
            t('general.danger.consequence2'),
            t('general.danger.consequence3'),
            t('general.danger.consequence4'),
            // Dřív to byl prop `irreversibleNote`, který `ConfirmDialog` nemá.
            // Je to následek jako každý jiný, takže patří do seznamu následků;
            // nevratnost samotnou hlásí komponenta z `labels.irreversible`.
            t('general.danger.restoreNote'),
          ]}
          confirmPhrase={workspace.name}
          confirmPhraseLabel={t('general.danger.confirmLabel')}
          onConfirmPhraseChange={setTyped}
          confirmLabel={t('general.danger.confirm', { name: workspace.name })}
          cancelLabel={t('general.danger.cancel')}
          onConfirm={() => formRef.current?.requestSubmit()}
          labels={confirmLabels}
        />
      </form>
    </section>
  );
}

/** Serverová obálka, aby stránka nemusela znát akci. */
export function DangerZone({ workspace }: { workspace: Workspace }) {
  return <DangerZoneView workspace={workspace} action={deleteWorkspaceAction} />;
}
```

**Požadavek na P05 (`ConfirmDialog`).** Úroveň N4 musí umět `confirmPhrase`, `confirmPhraseLabel` a `onConfirmPhraseChange`. Potvrzovací tlačítko je aktivní, jen když se opsaný text přesně shoduje, a **nesmí být `disabled`**: podle kritéria 18 kapitoly 15.2 části 6 se místo zašednutí ukáže pod polem věta, co se čeká. Výchozí fokus dialogu je na tlačítku ústupu, ne na destruktivním tlačítku (9.4 části 6). Kdyby to `ConfirmDialog` neuměl, doplní se do P05, ne sem.

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/features/workspace-settings/`
Expected: PASS, `Tests  20 passed (20)`.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/workspace-settings
git commit -m "feat(web): delete project with type to confirm"
```

---

### Úkol 25: Členové projektu, seznam, změna role a odebrání

**Soubory:**
- Create: `apps/web/src/features/members/actions.ts`
- Create: `apps/web/src/features/members/members-table.tsx`
- Create: `apps/web/src/features/members/members-table.test.tsx`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/members/page.tsx`

**Zařazení akcí:**

| Akce | Třída | Kanál | Úroveň | Zdůvodnění |
|---|---|---|---|---|
| Změna role | A2 | toast s vrácením akce | N1 | Plně vratná: stačí nastavit původní roli zpět. |
| Odebrání člena | A2 | toast | **N2**, viz R7 | Vrácení technicky neexistuje, zpět jen novou pozvánkou. |

Prázdný stav používá doslovný text z 5.3 části 1: „V projektu jste zatím sami. Pozvěte kolegy a určete, co smí."

- [ ] **Krok 1: Napiš padající test tabulky**

`apps/web/src/features/members/members-table.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { Result } from '@/lib/api-client/result';
import { MembersTable, type MemberRow } from './members-table';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const messages = { settings: csSettings };

const ROWS: MemberRow[] = [
  { user_id: 'u1', email: 'jana@firma.cz', name: 'Jana Nováková', role: 'owner', created_at: '2026-01-01T00:00:00.000Z' },
  { user_id: 'u2', email: 'petr@firma.cz', name: 'Petr Svoboda', role: 'editor', created_at: '2026-03-01T00:00:00.000Z' },
];

function renderTable(
  members: Result<{ data: MemberRow[] }>,
  canManage = true,
  currentUserId = 'u1',
  // `onInvite` chybí právě tehdy, když aktér zvát nesmí. Prázdný stav pak
  // primární akci **neschová**, ale nabídne akci, která funguje, a vysvětlí to.
  onInvite: (() => void) | undefined = vi.fn(),
) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <MembersTable
        members={members}
        canManage={canManage}
        currentUserId={currentUserId}
        workspaceId="w1"
        slug="eshop"
        onInvite={onInvite}
        changeRoleAction={vi.fn()}
        removeAction={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe('MembersTable', () => {
  it('vypíše členy se jménem, e-mailem a rolí', () => {
    renderTable({ ok: true, data: { data: ROWS } });
    expect(screen.getByText('Jana Nováková')).toBeInTheDocument();
    expect(screen.getByText('petr@firma.cz')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Editor')).toBeInTheDocument();
  });

  it('u prázdného seznamu ukáže vysvětlení a primární akci, strukturálně', () => {
    renderTable({ ok: true, data: { data: [] } });
    // Kritérium 76c: kontroluje se struktura, ne doslovné znění. Text se
    // čte z katalogu, takže ho přeformulování neshodí.
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'first');
    expect(within(empty).getByTestId('empty-explanation')).toHaveTextContent(csSettings.members.empty);
    expect(within(empty).getByRole('button', { name: csSettings.members.emptyAction })).toBeInTheDocument();
  });

  it('bez oprávnění zvát akci neschová, ale nahradí ji funkční akcí a vysvětlením', () => {
    renderTable({ ok: true, data: { data: [] } }, false, 'u1', undefined);
    const empty = screen.getByTestId('empty-state');
    expect(within(empty).getByRole('button', { name: csSettings.shared.backToOverview })).toBeInTheDocument();
    expect(within(empty).getByText(csSettings.members.emptyNoPermission)).toBeInTheDocument();
  });

  it('u chyby ukáže blok s request_id a tlačítkem Zkusit znovu', () => {
    renderTable({
      ok: false,
      problem: {
        type: '',
        title: 'Dependency timeout',
        status: 504,
        detail: '',
        instance: '/api/v1/members',
        code: 'dependency_timeout',
        request_id: 'req_11',
      },
    });
    expect(screen.getByText('req_11')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
  });

  it('bez oprávnění správy ukáže roli jako text, ne jako výběr', () => {
    renderTable({ ok: true, data: { data: ROWS } }, false);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Editor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Odebrat/ })).not.toBeInTheDocument();
  });

  it('u sebe sama nenabídne odebrání ani změnu role', () => {
    renderTable({ ok: true, data: { data: ROWS } }, true, 'u1');
    expect(screen.getAllByRole('button', { name: 'Odebrat z projektu' })).toHaveLength(1);
  });

  it('odebrání otevře dialog N2 se jménem a s větou o nové pozvánce', async () => {
    renderTable({ ok: true, data: { data: ROWS } });
    await userEvent.click(screen.getByRole('button', { name: 'Odebrat z projektu' }));
    expect(screen.getByRole('heading', { name: 'Odebrat Petr Svoboda z projektu?' })).toBeInTheDocument();
    expect(screen.getByText(/jen novou pozvánkou/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nechat v projektu' })).toBeInTheDocument();
  });

  it('popisuje, co která role smí', () => {
    renderTable({ ok: true, data: { data: ROWS } });
    expect(screen.getByText(/Tvoří kontakty, šablony a kampaně/)).toBeInTheDocument();
  });

  it('výběr role má přístupné jméno se jménem člena', () => {
    renderTable({ ok: true, data: { data: ROWS } });
    expect(screen.getByRole('combobox', { name: 'Role člena Petr Svoboda' })).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/members/members-table.test.tsx`
Expected: FAIL, `Failed to resolve import "./members-table"`.

- [ ] **Krok 3: Napiš Server Actions členů**

`apps/web/src/features/members/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiMutate } from '@/lib/api-client/mutate';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';
import { IDEMPOTENCY_FIELD_NAME } from '@/lib/feedback/idempotency-field';

const RoleSchema = z.enum(['owner', 'admin', 'editor', 'viewer']);

const ChangeRoleSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  user_id: z.string().min(1),
  role: RoleSchema,
});

export async function changeMemberRoleAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = ChangeRoleSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    user_id: formData.get('user_id'),
    role: formData.get('role'),
  });

  if (!parsed.success) {
    return failed('toast', {
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: '',
      instance: '/api/v1/members',
      code: 'validation_failed',
      request_id: '',
      errors: [{ path: 'role', code: 'invalid', message: 'Neznámá role.' }],
    });
  }

  const result = await apiMutate<void>(`/api/v1/members/${parsed.data.user_id}`, {
    method: 'PATCH',
    body: { role: parsed.data.role },
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return failed('toast', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/members`);
  return succeeded({ channel: 'toast', messageKey: 'members.changeRole.done' });
}

const RemoveSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  user_id: z.string().min(1),
});

export async function removeMemberAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = RemoveSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    user_id: formData.get('user_id'),
  });
  if (!parsed.success) {
    return failed('toast', {
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: '',
      instance: '/api/v1/members',
      code: 'validation_failed',
      request_id: '',
      errors: [{ path: 'user_id', code: 'required', message: 'Chybí člen.' }],
    });
  }

  const result = await apiMutate<void>(`/api/v1/members/${parsed.data.user_id}`, {
    method: 'DELETE',
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return failed('toast', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/members`);
  return succeeded({ channel: 'toast', messageKey: 'members.remove.done' });
}

const InviteSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  email: z.string().trim().email(),
  role: RoleSchema,
});

export async function inviteMemberAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = InviteSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    email: formData.get('email'),
    role: formData.get('role'),
  });

  if (!parsed.success) {
    return failed('inlineBlock', {
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: '',
      instance: '/api/v1/invitations',
      code: 'validation_failed',
      request_id: '',
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    });
  }

  const result = await apiMutate<{ id: string }>('/api/v1/invitations', {
    method: 'POST',
    body: { email: parsed.data.email, role: parsed.data.role },
    workspaceId: parsed.data.workspace_id,
    idempotencyKey: String(formData.get(IDEMPOTENCY_FIELD_NAME) ?? ''),
  });
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/members`);
  return succeeded({
    channel: 'inlineBlock',
    messageKey: 'members.invite.done',
    values: { email: parsed.data.email },
  });
}

const RevokeInvitationSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  invitation_id: z.string().min(1),
  email: z.string().min(1),
});

export async function revokeInvitationAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = RevokeInvitationSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    invitation_id: formData.get('invitation_id'),
    email: formData.get('email'),
  });
  if (!parsed.success) {
    return failed('toast', {
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: '',
      instance: '/api/v1/invitations',
      code: 'validation_failed',
      request_id: '',
      errors: [{ path: 'invitation_id', code: 'required', message: 'Chybí pozvánka.' }],
    });
  }

  const result = await apiMutate<void>(`/api/v1/invitations/${parsed.data.invitation_id}`, {
    method: 'DELETE',
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return failed('toast', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/members`);
  return succeeded({ channel: 'toast', messageKey: 'members.invitations.revoked', values: { email: parsed.data.email } });
}
```

- [ ] **Krok 4: Napiš tabulku členů**

`apps/web/src/features/members/members-table.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { SelectField } from '@/lib/forms/select-field';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { EmptyState } from '@mlain/ui/patterns/states';
import { useToast } from '@mlain/ui/patterns/toast';
import type { Result } from '@/lib/api-client/result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { ROLES, type Role } from '@/lib/identity/permissions';
import { ROLE_LABEL_KEYS } from './role-label';

export type MemberRow = {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  created_at: string;
};

export type MembersTableProps = {
  members: Result<{ data: MemberRow[] }>;
  canManage: boolean;
  currentUserId: string;
  changeRoleAction: (formData: FormData) => void;
  removeAction: (formData: FormData) => void;
  workspaceId?: string;
  slug?: string;
  onInvite?: () => void;
};

const ROLE_DESCRIPTION_KEYS = {
  owner: 'members.roleDescription.owner',
  admin: 'members.roleDescription.admin',
  editor: 'members.roleDescription.editor',
  viewer: 'members.roleDescription.viewer',
} as const satisfies Record<Role, string>;

export function MembersTable(props: MembersTableProps) {
  const t = useTranslations('settings');
  const toast = useToast();
  const router = useRouter();
  const confirmLabels = useConfirmDialogLabels();
  const removeFormRef = useRef<HTMLFormElement>(null);
  const [pendingRemoval, setPendingRemoval] = useState<MemberRow | null>(null);

  if (!props.members.ok) {
    return <SettingsProblem problem={props.members.problem} onRetry={() => window.location.reload()} />;
  }

  const rows = props.members.data.data;

  if (rows.length === 0) {
    return (
      <EmptyState
        variant="first"
        title={t('members.title')}
        explanation={t('members.empty')}
        // `actions` je povinné a nesmí být prázdné: prázdný stav bez akce
        // porušuje kritérium 20 a `EmptyState` na něj hodí výjimku.
        // Kdo pozvat nesmí, dostane akci, která funguje, a vysvětlení proč.
        actions={
          props.onInvite
            ? [{ label: t('members.emptyAction'), onClick: props.onInvite }]
            : [
                {
                  label: t('shared.backToOverview'),
                  onClick: () => router.push(`/w/${props.slug ?? ''}`),
                  description: t('members.emptyNoPermission'),
                },
              ]
        }
      />
    );
  }

  return (
    <>
      <table className="w-full text-left">
        <caption className="sr-only">{t('members.title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('members.table.person')}</th>
            <th scope="col">{t('members.table.role')}</th>
            <th scope="col">{t('members.table.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((member) => {
            const isSelf = member.user_id === props.currentUserId;
            return (
              <tr key={member.user_id} className="border-t border-[--color-border]">
                <td className="py-3">
                  <p className="font-medium">{member.name === '' ? member.email : member.name}</p>
                  <p className="text-sm text-[--color-text-muted]">{member.email}</p>
                </td>
                <td className="py-3">
                  {props.canManage && !isSelf ? (
                    <form ref={(node) => { roleFormRefs.current[member.user_id] = node; }} action={props.changeRoleAction}>
                      <input type="hidden" name="workspace_id" value={props.workspaceId ?? ''} readOnly />
                      <input type="hidden" name="slug" value={props.slug ?? ''} readOnly />
                      <input type="hidden" name="user_id" value={member.user_id} readOnly />
                      <SelectField
                        name="role"
                        label={t('members.changeRole.label', { name: member.name })}
                        placeholder={t('shared.selectPlaceholder')}
                        defaultValue={member.role}
                        options={ROLES.map((role) => ({ value: role, label: t(ROLE_LABEL_KEYS[role]) }))}
                        onSelected={(next) => {
                          roleFormRefs.current[member.user_id]?.requestSubmit();
                          toast.info(
                            t('members.changeRole.done', {
                              name: member.name,
                              role: t(ROLE_LABEL_KEYS[next as Role]),
                            }),
                          );
                        }}
                      />
                    </form>
                  ) : (
                    <span>{t(ROLE_LABEL_KEYS[member.role])}</span>
                  )}
                  <p className="mt-1 text-sm text-[--color-text-muted]">{t(ROLE_DESCRIPTION_KEYS[member.role])}</p>
                </td>
                <td className="py-3">
                  {props.canManage && !isSelf ? (
                    <Button type="button" variant="secondary" onClick={() => setPendingRemoval(member)}>
                      {t('members.remove.button')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {pendingRemoval ? (
        <form ref={removeFormRef} action={props.removeAction}>
          <input type="hidden" name="workspace_id" value={props.workspaceId ?? ''} readOnly />
          <input type="hidden" name="slug" value={props.slug ?? ''} readOnly />
          <input type="hidden" name="user_id" value={pendingRemoval.user_id} readOnly />
          <ConfirmDialog
            open
            onOpenChange={(open: boolean) => {
              if (!open) setPendingRemoval(null);
            }}
            level="N2"
            title={t('members.remove.dialogTitle', { name: pendingRemoval.name })}
            consequences={[
              t('members.remove.consequence1'),
              t('members.remove.consequence2'),
              t('members.remove.consequence3'),
            ]}
            confirmLabel={t('members.remove.confirm', { name: pendingRemoval.name })}
            cancelLabel={t('members.remove.cancel')}
            // `onConfirm` nedostává událost, jeho podpis je `() => void | Promise<void>`.
            // Formulář se proto adresuje přes ref, stejně jako na ostatních obrazovkách.
            onConfirm={() => removeFormRef.current?.requestSubmit()}
            labels={confirmLabels}
          />
        </form>
      ) : null}
    </>
  );
}
```

- [ ] **Krok 5: Napiš stránku členů**

`apps/web/src/app/[locale]/w/[workspaceSlug]/settings/members/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { changeMemberRoleAction, removeMemberAction } from '@/features/members/actions';
import { MembersTable, type MemberRow } from '@/features/members/members-table';
import { InvitationsSection, type InvitationRow } from '@/features/members/invitations-section';
import { SettingsPageShell } from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { apiFetch } from '@/lib/api-client/fetch';
import { getCurrentUser } from '@/lib/identity/current-user';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('members.title') };
}

export default async function MembersPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const t = await getTranslations('settings');

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  if (!hasPermission(access.data, 'members:read')) {
    return (
      <ForbiddenSection permission="members:read" currentRole={access.data.role} workspaceSlug={workspaceSlug} />
    );
  }

  const canManage = hasPermission(access.data, 'members:update_role');
  const canInvite = hasPermission(access.data, 'members:invite');
  const workspaceId = access.data.workspace.id;

  const [me, members, invitations] = await Promise.all([
    getCurrentUser(),
    apiFetch<{ data: MemberRow[] }>('/api/v1/members', { workspaceId }),
    canInvite
      ? apiFetch<{ data: InvitationRow[] }>('/api/v1/invitations', { workspaceId })
      : Promise.resolve({ ok: true as const, data: { data: [] as InvitationRow[] } }),
  ]);

  return (
    <SettingsPageShell title={t('members.title')} lead={t('members.lead')}>
      <div className="space-y-12">
        <MembersTable
          members={members}
          canManage={canManage}
          currentUserId={me.ok ? me.data.user.id : ''}
          changeRoleAction={changeMemberRoleAction as never}
          removeAction={removeMemberAction as never}
          workspaceId={workspaceId}
          slug={workspaceSlug}
        />
        {canInvite ? (
          <InvitationsSection invitations={invitations} workspaceId={workspaceId} slug={workspaceSlug} />
        ) : null}
      </div>
    </SettingsPageShell>
  );
}
```

- [ ] **Krok 6: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/features/members/members-table.test.tsx`
Expected: PASS, `Tests  9 passed (9)`.

- [ ] **Krok 7: Commit**

```bash
git add apps/web/src/features/members "apps/web/src/app/[locale]/w"
git commit -m "feat(web): members list, role change with undo, member removal"
```

---

### Úkol 26: Pozvánky do projektu

**Soubory:**
- Create: `apps/web/src/features/members/invitations-section.tsx`
- Create: `apps/web/src/features/members/invitations-section.test.tsx`

Pozvánka platí 7 dní, opakované pozvání téhož e-mailu revokuje předchozí a maximum čekajících je **100 na projekt** (3.3 části 1). Sto pozvánek je stav **S15 přes limit**: uvádí aktuální hodnotu, limit a co se s tím dá dělat.

Zrušení pozvánky je **A2 a N1**. Nabízí se „Pozvat znovu", ne „Vrátit zpět", protože nová pozvánka má nový token a pošle nový e-mail; tvrdit, že se akce vrátila, by byla lež.

- [ ] **Krok 1: Napiš padající test**

`apps/web/src/features/members/invitations-section.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { Result } from '@/lib/api-client/result';
import { InvitationsSectionView, type InvitationRow } from './invitations-section';

const messages = { settings: csSettings };

const ROWS: InvitationRow[] = [
  {
    id: 'i1',
    email: 'novy@firma.cz',
    role: 'editor',
    invited_by_name: 'Jana Nováková',
    expires_at: '2026-08-07T10:00:00.000Z',
    created_at: '2026-07-31T10:00:00.000Z',
  },
];

function renderSection(invitations: Result<{ data: InvitationRow[] }>) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <InvitationsSectionView
        invitations={invitations}
        workspaceId="ws1"
        slug="eshop"
        inviteAction={vi.fn()}
        revokeAction={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

function manyInvitations(count: number): InvitationRow[] {
  return Array.from({ length: count }, (_value, index) => ({
    ...ROWS[0]!,
    id: `i${index}`,
    email: `clovek${index}@firma.cz`,
  }));
}

describe('InvitationsSectionView', () => {
  it('vypíše čekající pozvánky s e-mailem, rolí a platností', () => {
    renderSection({ ok: true, data: { data: ROWS } });
    expect(screen.getByText('novy@firma.cz')).toBeInTheDocument();
    expect(screen.getByText('Editor')).toBeInTheDocument();
    expect(screen.getByText('Jana Nováková')).toBeInTheDocument();
  });

  it('u prázdného seznamu ukáže vysvětlení a akci, ne prázdnou tabulku', () => {
    renderSection({ ok: true, data: { data: [] } });
    const empty = screen.getByTestId('empty-state');
    expect(within(empty).getByTestId('empty-explanation')).toHaveTextContent(
      csSettings.members.invitations.empty,
    );
    expect(within(empty).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('formulář pozvání má e-mail, roli a vysvětlení sedmidenní platnosti', () => {
    renderSection({ ok: true, data: { data: ROWS } });
    expect(screen.getByLabelText('E-mail kolegy')).toBeInTheDocument();
    expect(screen.getByLabelText('Role')).toBeInTheDocument();
    expect(screen.getByText(/platí 7 dní/)).toBeInTheDocument();
  });

  it('u stovky pozvánek ukáže stav přes limit a formulář schová', () => {
    renderSection({ ok: true, data: { data: manyInvitations(100) } });
    expect(screen.getByText('Víc pozvánek naráz poslat nejde')).toBeInTheDocument();
    expect(screen.getByText(/100 pozvánek, což je maximum/)).toBeInTheDocument();
    expect(screen.queryByLabelText('E-mail kolegy')).not.toBeInTheDocument();
  });

  it('u devadesáti devíti pozvánek formulář zůstává', () => {
    renderSection({ ok: true, data: { data: manyInvitations(99) } });
    expect(screen.getByLabelText('E-mail kolegy')).toBeInTheDocument();
  });

  it('u chyby ukáže blok s request_id', () => {
    renderSection({
      ok: false,
      problem: {
        type: '',
        title: 'Forbidden',
        status: 403,
        detail: '',
        instance: '/api/v1/invitations',
        code: 'forbidden',
        request_id: 'req_21',
      },
    });
    expect(screen.getByText('req_21')).toBeInTheDocument();
  });

  it('u již existujícího člena ukáže hlášku, která radí změnit roli', () => {
    render(
      <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
        <InvitationsSectionView
          invitations={{ ok: true, data: { data: [] } }}
          workspaceId="ws1"
          slug="eshop"
          inviteAction={vi.fn()}
          revokeAction={vi.fn()}
          initialState={{
            status: 'error',
            channel: 'inlineBlock',
            problem: {
              type: '',
              title: 'Already member',
              status: 409,
              detail: '',
              instance: '/api/v1/invitations',
              code: 'already_member',
              request_id: 'req_22',
            },
            fieldErrors: {},
          }}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Tenhle člověk už v projektu je')).toBeInTheDocument();
    expect(screen.getByText(/změnit přímo v seznamu členů/)).toBeInTheDocument();
  });

  it('zrušení pozvánky nabízí Pozvat znovu, ne Vrátit zpět', async () => {
    renderSection({ ok: true, data: { data: ROWS } });
    expect(screen.getByRole('button', { name: 'Zrušit pozvánku' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zrušit pozvánku' }));
    expect(screen.queryByRole('button', { name: 'Vrátit zpět' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/members/invitations-section.test.tsx`
Expected: FAIL, `Failed to resolve import "./invitations-section"`.

- [ ] **Krok 3: Napiš sekci pozvánek**

`apps/web/src/features/members/invitations-section.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { SelectField } from '@/lib/forms/select-field';
import { EmptyState, OverLimitState } from '@mlain/ui/patterns/states';
import type { Result } from '@/lib/api-client/result';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { IdempotencyField } from '@/lib/feedback/idempotency-field';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { ROLES, type Role } from '@/lib/identity/permissions';
import { ROLE_LABEL_KEYS } from './role-label';
import { inviteMemberAction, revokeInvitationAction } from './actions';

/** Maximum čekajících pozvánek na projekt podle 3.3 části 1. */
export const PENDING_INVITATION_LIMIT = 100;

export type InvitationRow = {
  id: string;
  email: string;
  role: Role;
  invited_by_name: string;
  expires_at: string;
  created_at: string;
};

export type InvitationsSectionViewProps = {
  invitations: Result<{ data: InvitationRow[] }>;
  workspaceId: string;
  slug: string;
  inviteAction: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  revokeAction: (formData: FormData) => void;
  initialState?: ActionState;
};

export function InvitationsSectionView(props: InvitationsSectionViewProps) {
  const t = useTranslations('settings');
  const format = useFormatter();
  const [state, formAction] = useActionState(props.inviteAction, props.initialState ?? IDLE);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};

  const rows = props.invitations.ok ? props.invitations.data.data : [];
  const atLimit = rows.length >= PENDING_INVITATION_LIMIT;

  return (
    <section aria-labelledby="members-invitations">
      <h2 id="members-invitations" className="text-xl font-semibold">
        {t('members.invitations.title')}
      </h2>

      {!props.invitations.ok ? (
        <div className="mt-4">
          <SettingsProblem problem={props.invitations.problem} onRetry={() => window.location.reload()} />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            variant="first"
            title={t('members.invitations.title')}
            explanation={t('members.invitations.empty')}
            actions={[
              {
                label: t('members.invitations.emptyAction'),
                // Primární akce prázdného stavu vede rovnou do formuláře pod ním.
                onClick: () => document.getElementById('invite-email')?.focus(),
              },
            ]}
          />
        </div>
      ) : (
        <table className="mt-4 w-full text-left">
          <caption className="sr-only">{t('members.invitations.title')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('members.invitations.email')}</th>
              <th scope="col">{t('members.invitations.role')}</th>
              <th scope="col">{t('members.invitations.invitedBy')}</th>
              <th scope="col">{t('members.invitations.expiresAt')}</th>
              <th scope="col">{t('members.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((invitation) => (
              <tr key={invitation.id} className="border-t border-[--color-border]">
                <td className="py-3">{invitation.email}</td>
                <td className="py-3">{t(ROLE_LABEL_KEYS[invitation.role])}</td>
                <td className="py-3">{invitation.invited_by_name}</td>
                <td className="py-3">
                  <time dateTime={invitation.expires_at} title={invitation.expires_at}>
                    {format.dateTime(new Date(invitation.expires_at), 'short')}
                  </time>
                </td>
                <td className="py-3">
                  <form action={props.revokeAction}>
                    <input type="hidden" name="workspace_id" value={props.workspaceId} readOnly />
                    <input type="hidden" name="slug" value={props.slug} readOnly />
                    <input type="hidden" name="invitation_id" value={invitation.id} readOnly />
                    <input type="hidden" name="email" value={invitation.email} readOnly />
                    <Button type="submit" variant="secondary">
                      {t('members.invitations.revoke')}
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {atLimit ? (
        <div className="mt-6">
          <OverLimitState
            title={t('members.invitations.limitTitle')}
            body={t('members.invitations.limitBody')}
          />
        </div>
      ) : (
        <div className="mt-6">
          <h3 className="font-medium">{t('members.invite.title')}</h3>
          <p className="mt-1 text-sm text-[--color-text-muted]">{t('members.invite.lead')}</p>

          {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
            <div className="mt-4">
              <SettingsProblem problem={state.problem} />
            </div>
          ) : null}

          {state.status === 'success' ? (
            <p role="status" className="mt-4 text-sm">
              {t('members.invite.done', { email: String(state.values?.email ?? '') })}
            </p>
          ) : null}

          <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3" noValidate>
            <IdempotencyField />
            <input type="hidden" name="workspace_id" value={props.workspaceId} readOnly />
            <input type="hidden" name="slug" value={props.slug} readOnly />

            <div>
              <Label htmlFor="invite-email">{t('members.invite.email')}</Label>
              <Input id="invite-email" name="email" type="email" {...fieldAria('email', fieldErrors)} />
              <FieldError name="email" errors={fieldErrors} />
            </div>

            <div>
              <SelectField
                name="role"
                label={t('members.invite.role')}
                placeholder={t('shared.selectPlaceholder')}
                defaultValue="viewer"
                options={ROLES.map((role) => ({ value: role, label: t(ROLE_LABEL_KEYS[role]) }))}
                errors={fieldErrors}
              />
            </div>

            <SubmitButton label={t('members.invite.submit')} pendingLabel={t('members.invite.submitting')} />
          </form>
        </div>
      )}
    </section>
  );
}

/** Serverová obálka, aby stránka nemusela znát akce. */
export function InvitationsSection(props: {
  invitations: Result<{ data: InvitationRow[] }>;
  workspaceId: string;
  slug: string;
}) {
  return (
    <InvitationsSectionView
      {...props}
      inviteAction={inviteMemberAction}
      revokeAction={revokeInvitationAction as never}
    />
  );
}
```

- [ ] **Krok 4: Spusť testy členů a ověř, že procházejí**

Run: `pnpm --filter @mlain/web exec vitest run src/features/members/`
Expected: PASS, `Tests  17 passed (17)`.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/features/members
git commit -m "feat(web): pending invitations with limit state"
```

---

### Úkol 27: Klíče k API, seznam a vytvoření se zobrazením sekretu

**Soubory:**
- Create: `apps/web/src/features/api-keys/actions.ts`
- Create: `apps/web/src/features/api-keys/api-keys-table.tsx`
- Create: `apps/web/src/features/api-keys/api-keys-table.test.tsx`
- Create: `apps/web/src/features/api-keys/secret-reveal.tsx`
- Create: `apps/web/src/features/api-keys/secret-reveal.test.tsx`
- Create: `apps/web/src/features/api-keys/create-key-panel.tsx`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/api-keys/page.tsx`

**Sekret se ukazuje právě jednou.** Hláška je v 5.3 části 1 hotová a přebírá se doslova: „Zkopírujte si sekret teď. Už ho nikdy neuvidíme ani my." Kritérium 25 části 1 zároveň žádá, aby výpis klíčů sekret neobsahoval v žádném poli; hlídá to test.

Prázdný stav používá doslovný text z 5.3 části 1: „Zatím nemáte žádný API klíč. Klíč slouží k propojení e-shopu nebo vlastní aplikace."

- [ ] **Krok 1: Napiš padající test odhalení sekretu**

`apps/web/src/features/api-keys/secret-reveal.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { SecretReveal } from './secret-reveal';

const messages = { settings: csSettings };
const SECRET = 'ml_live_ugzmhvhf___79_Pv6-fj39vX08_Lx8O_u7ezr6uno5-bl5OPi4eA';

function renderReveal(onClose = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <SecretReveal secret={SECRET} titleKey="apiKeys.secret.title" warningKey="apiKeys.secret.warning" onClose={onClose} />
    </NextIntlClientProvider>,
  );
}

describe('SecretReveal', () => {
  it('použije doslovnou hlášku ze specifikace', () => {
    renderReveal();
    expect(screen.getByText('Zkopírujte si sekret teď. Už ho nikdy neuvidíme ani my.')).toBeInTheDocument();
  });

  it('ukáže celý sekret, ne zkrácený', () => {
    renderReveal();
    expect(screen.getByText(SECRET)).toBeInTheDocument();
  });

  it('nabídne zkopírování sekretu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderReveal();
    await userEvent.click(screen.getByRole('button', { name: 'Zkopírovat' }));
    expect(writeText).toHaveBeenCalledWith(SECRET);
  });

  it('zavření vyžaduje potvrzení, že si sekret uživatel uložil', async () => {
    const onClose = vi.fn();
    renderReveal(onClose);
    await userEvent.click(screen.getByRole('button', { name: 'Hotovo' }));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText('Sekret mám uložený'));
    await userEvent.click(screen.getByRole('button', { name: 'Hotovo' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tlačítko Hotovo nemá disabled ani před zaškrtnutím', () => {
    renderReveal();
    expect(screen.getByRole('button', { name: 'Hotovo' })).not.toHaveAttribute('disabled');
  });

  it('je oznámené čtečce obrazovky', () => {
    renderReveal();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/api-keys/secret-reveal.test.tsx`
Expected: FAIL, `Failed to resolve import "./secret-reveal"`.

- [ ] **Krok 3: Napiš odhalení sekretu**

`apps/web/src/features/api-keys/secret-reveal.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { CopyButton } from '@mlain/ui/components/copy-button';

export type SecretRevealProps = {
  secret: string;
  /** Klíče jsou literály, protože sekret se odhaluje u klíčů i u webhooků. */
  titleKey: 'apiKeys.secret.title' | 'webhooks.secret.title';
  warningKey: 'apiKeys.secret.warning' | 'webhooks.secret.warning';
  hintKey?: 'webhooks.secret.hint';
  onClose: () => void;
};

/**
 * Sekret se ukazuje právě jednou, hned po vytvoření. Zavření je za
 * zaškrtnutím, aby ho nikdo nezavřel omylem. Tlačítko přitom **nemá**
 * `disabled` (kritérium 18 kapitoly 15.2 části 6): místo mrtvého tlačítka
 * se ukáže věta, co se čeká.
 */
export function SecretReveal({ secret, titleKey, warningKey, hintKey, onClose }: SecretRevealProps) {
  const t = useTranslations('settings');
  const [acknowledged, setAcknowledged] = useState(false);
  const [nudge, setNudge] = useState(false);

  return (
    <section role="alert" className="rounded-lg border border-[--color-warning] bg-[--color-surface] p-6">
      <h3 className="text-lg font-semibold">{t(titleKey)}</h3>
      <p className="mt-2 font-medium text-[--color-warning]">{t(warningKey)}</p>
      {hintKey ? <p className="mt-2 text-sm text-[--color-text-muted]">{t(hintKey)}</p> : null}

      <div className="mt-4 flex items-center gap-2 rounded-md bg-[--color-surface-muted] p-3">
        <code className="break-all">{secret}</code>
        <CopyButton value={secret} label={t('shared.copy')} copiedLabel={t('shared.copied')} />
      </div>

      <label className="mt-4 flex items-center gap-2">
        <Checkbox
          checked={acknowledged}
          // Radix předává `boolean | 'indeterminate'`. Zúžení na `boolean`
          // není pod `strictFunctionTypes` přiřaditelné a typová kontrola spadne.
          onCheckedChange={(state: boolean | 'indeterminate') => {
            const value = state === true;
            setAcknowledged(value);
            if (value) setNudge(false);
          }}
        />
        <span>{t('apiKeys.secret.acknowledge')}</span>
      </label>

      {nudge ? (
        <p role="status" className="mt-2 text-sm text-[--color-warning]">
          {t('apiKeys.secret.acknowledge')}
        </p>
      ) : null}

      <div className="mt-4">
        <Button
          type="button"
          variant="primary"
          onClick={() => {
            if (acknowledged) onClose();
            else setNudge(true);
          }}
        >
          {t('apiKeys.secret.close')}
        </Button>
      </div>
    </section>
  );
}
```

- [ ] **Krok 4: Napiš padající test tabulky klíčů**

`apps/web/src/features/api-keys/api-keys-table.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { Result } from '@/lib/api-client/result';
import { ApiKeysTable, type ApiKeyRow } from './api-keys-table';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const messages = { settings: csSettings };

const ROWS: ApiKeyRow[] = [
  {
    id: 'k1',
    name: 'E-shop, objednávky',
    prefix: 'ugzmhvhf',
    kind: 'secret',
    scopes: ['contacts:read', 'contacts:write'],
    created_by_name: 'Jana Nováková',
    last_used_at: '2026-07-30T10:00:00.000Z',
    expires_at: null,
    revoked_at: null,
    previous_expires_at: null,
    created_at: '2026-05-01T10:00:00.000Z',
  },
  {
    id: 'k2',
    name: 'Starý import',
    prefix: 'abcdefgh',
    kind: 'secret',
    scopes: ['contacts:read'],
    created_by_name: 'Petr Svoboda',
    last_used_at: null,
    expires_at: null,
    revoked_at: '2026-07-01T10:00:00.000Z',
    previous_expires_at: null,
    created_at: '2026-02-01T10:00:00.000Z',
  },
];

function renderTable(keys: Result<{ data: ApiKeyRow[] }>, canWrite = true) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <ApiKeysTable keys={keys} canWrite={canWrite} workspaceId="ws1" slug="eshop" onCreate={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe('ApiKeysTable', () => {
  it('ukáže jen prefix, nikdy sekret', () => {
    const { container } = renderTable({ ok: true, data: { data: ROWS } });
    expect(screen.getByText(/ml_live_ugzmhvhf/)).toBeInTheDocument();
    expect(container.textContent).not.toContain('__79_Pv6');
  });

  it('u prázdného seznamu ukáže vysvětlení a primární akci, strukturálně', () => {
    renderTable({ ok: true, data: { data: [] } });
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'first');
    expect(within(empty).getByTestId('empty-explanation')).toHaveTextContent(csSettings.apiKeys.empty);
    expect(within(empty).getByRole('button', { name: csSettings.apiKeys.emptyAction })).toBeInTheDocument();
  });

  it('stav klíče sděluje slovem, ne jen barvou', () => {
    renderTable({ ok: true, data: { data: ROWS } });
    expect(screen.getByText('Aktivní')).toBeInTheDocument();
    expect(screen.getByText('Zrušený')).toBeInTheDocument();
  });

  it('u nepoužitého klíče napíše Nikdy, ne prázdno', () => {
    renderTable({ ok: true, data: { data: ROWS } });
    expect(screen.getByText('Nikdy')).toBeInTheDocument();
  });

  it('u zrušeného klíče nenabídne rotaci ani revokaci', () => {
    renderTable({ ok: true, data: { data: ROWS } });
    expect(screen.getAllByRole('button', { name: 'Rotovat sekret' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Zrušit klíč' })).toHaveLength(1);
  });

  it('u klíče v přechodném období uvede, do kdy platí starý sekret', () => {
    renderTable({
      ok: true,
      data: {
        data: [{ ...ROWS[0]!, previous_expires_at: '2026-07-31T12:00:00.000Z' }],
      },
    });
    expect(screen.getByText(/starý sekret platí do/)).toBeInTheDocument();
  });

  it('bez oprávnění zápisu ukáže klíče, ale žádné akce', () => {
    renderTable({ ok: true, data: { data: ROWS } }, false);
    expect(screen.getByText('E-shop, objednávky')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rotovat sekret' })).not.toBeInTheDocument();
  });

  it('u chyby ukáže blok s request_id a s tlačítkem Zkusit znovu', () => {
    renderTable({
      ok: false,
      problem: {
        type: '',
        title: 'Service unavailable',
        status: 503,
        detail: '',
        instance: '/api/v1/api-keys',
        code: 'service_unavailable',
        request_id: 'req_31',
      },
    });
    expect(screen.getByText('req_31')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
  });
});
```

- [ ] **Krok 5: Napiš Server Actions klíčů**

`apps/web/src/features/api-keys/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiMutate } from '@/lib/api-client/mutate';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';
import { IDEMPOTENCY_FIELD_NAME } from '@/lib/feedback/idempotency-field';

const CreateSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  scopes: z.array(z.string().min(1)).min(1),
});

export async function createApiKeyAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = CreateSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    name: formData.get('name'),
    scopes: formData.getAll('scopes').map(String),
  });

  if (!parsed.success) {
    return failed('inlineBlock', {
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: '',
      instance: '/api/v1/api-keys',
      code: 'validation_failed',
      request_id: '',
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') === 'scopes' ? 'scopes' : issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    });
  }

  const result = await apiMutate<{ id: string; secret: string }>('/api/v1/api-keys', {
    method: 'POST',
    body: { name: parsed.data.name, scopes: parsed.data.scopes },
    workspaceId: parsed.data.workspace_id,
    idempotencyKey: String(formData.get(IDEMPOTENCY_FIELD_NAME) ?? ''),
  });
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/api-keys`);
  return succeeded({ channel: 'inlineBlock', messageKey: 'apiKeys.secret.title', data: result.data });
}

const RotateSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  key_id: z.string().min(1),
  grace_seconds: z.coerce.number().int().min(0).max(86400),
});

export async function rotateApiKeyAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = RotateSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    key_id: formData.get('key_id'),
    grace_seconds: formData.get('grace_seconds') ?? 0,
  });
  if (!parsed.success) {
    return failed('page', {
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: '',
      instance: '/api/v1/api-keys',
      code: 'validation_failed',
      request_id: '',
      errors: [{ path: 'grace_seconds', code: 'out_of_range', message: 'Zvolte 0 až 86400 sekund.' }],
    });
  }

  const result = await apiMutate<{ id: string; secret: string }>(
    `/api/v1/api-keys/${parsed.data.key_id}/rotate`,
    {
      method: 'POST',
      body: { grace_seconds: parsed.data.grace_seconds },
      workspaceId: parsed.data.workspace_id,
    },
  );
  if (!result.ok) return failed('page', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/api-keys`);
  return succeeded({ channel: 'page', messageKey: 'apiKeys.rotate.done', data: result.data });
}

const RevokeSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  key_id: z.string().min(1),
  name: z.string().min(1),
});

export async function revokeApiKeyAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = RevokeSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    key_id: formData.get('key_id'),
    name: formData.get('name'),
  });
  if (!parsed.success) {
    return failed('page', {
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: '',
      instance: '/api/v1/api-keys',
      code: 'validation_failed',
      request_id: '',
      errors: [{ path: 'key_id', code: 'required', message: 'Chybí klíč.' }],
    });
  }

  const result = await apiMutate<void>(`/api/v1/api-keys/${parsed.data.key_id}`, {
    method: 'DELETE',
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return failed('page', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/api-keys`);
  return succeeded({ channel: 'page', messageKey: 'apiKeys.revoke.done', values: { name: parsed.data.name } });
}
```

- [ ] **Krok 6: Napiš tabulku klíčů**

`apps/web/src/features/api-keys/api-keys-table.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { EmptyState } from '@mlain/ui/patterns/states';
import { CheckIcon, ClockIcon, SlashIcon } from '@/lib/ui/status-icons';
import type { Result } from '@/lib/api-client/result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { RotateKeyDialog } from './rotate-key-dialog';
import { RevokeKeyDialog } from './revoke-key-dialog';

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  kind: 'secret' | 'public';
  scopes: string[];
  created_by_name: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  previous_expires_at: string | null;
  created_at: string;
};

export type ApiKeysTableProps = {
  keys: Result<{ data: ApiKeyRow[] }>;
  canWrite: boolean;
  workspaceId: string;
  slug: string;
  onCreate: () => void;
};

type KeyStatus = 'active' | 'revoked' | 'expired';

export function keyStatus(row: ApiKeyRow, now: Date): KeyStatus {
  if (row.revoked_at !== null) return 'revoked';
  if (row.expires_at !== null && new Date(row.expires_at) <= now) return 'expired';
  return 'active';
}

const STATUS_KEYS = {
  active: 'apiKeys.status.active',
  revoked: 'apiKeys.status.revoked',
  expired: 'apiKeys.status.expired',
} as const satisfies Record<KeyStatus, string>;

const STATUS_TONES = { active: 'success', revoked: 'neutral', expired: 'warning' } as const;

/**
 * `Badge` má ikonu povinnou schválně: stav se nikdy nesděluje jen barvou
 * (pravidlo 11.3 části 6). Barva a slovo samy o sobě nestačí lidem, kteří
 * barvy nerozliší, a text bez ikony se v tabulce ztratí mezi ostatními.
 */
const STATUS_ICONS: Record<KeyStatus, React.ReactNode> = {
  active: CheckIcon,
  revoked: SlashIcon,
  expired: ClockIcon,
};

export function ApiKeysTable(props: ApiKeysTableProps) {
  const t = useTranslations('settings');
  const format = useFormatter();
  const router = useRouter();
  const [rotating, setRotating] = useState<ApiKeyRow | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);
  const now = new Date();

  if (!props.keys.ok) {
    return <SettingsProblem problem={props.keys.problem} onRetry={() => window.location.reload()} />;
  }

  const rows = props.keys.data.data;

  if (rows.length === 0) {
    return (
      <EmptyState
        variant="first"
        title={t('apiKeys.title')}
        explanation={t('apiKeys.empty')}
        actions={
          props.canWrite
            ? [{ label: t('apiKeys.emptyAction'), onClick: props.onCreate }]
            : [
                {
                  label: t('shared.backToOverview'),
                  onClick: () => router.push(`/w/${props.slug}`),
                  description: t('apiKeys.emptyNoPermission'),
                },
              ]
        }
      />
    );
  }

  return (
    <>
      <table className="w-full text-left">
        <caption className="sr-only">{t('apiKeys.title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('apiKeys.table.name')}</th>
            <th scope="col">{t('apiKeys.table.prefix')}</th>
            <th scope="col">{t('apiKeys.table.scopes')}</th>
            <th scope="col">{t('apiKeys.table.lastUsedAt')}</th>
            <th scope="col">{t('apiKeys.table.status')}</th>
            <th scope="col">{t('apiKeys.table.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = keyStatus(row, now);
            const rotating2 = row.previous_expires_at !== null && new Date(row.previous_expires_at) > now;
            return (
              <tr key={row.id} className="border-t border-[--color-border]">
                <td className="py-3">
                  <p className="font-medium">{row.name}</p>
                  <p className="text-sm text-[--color-text-muted]">{row.created_by_name}</p>
                </td>
                <td className="py-3">
                  <code>ml_live_{row.prefix}_…</code>
                </td>
                <td className="py-3 text-sm">{row.scopes.join(', ')}</td>
                <td className="py-3">
                  {row.last_used_at === null ? (
                    t('shared.never')
                  ) : (
                    <time dateTime={row.last_used_at} title={row.last_used_at}>
                      {format.relativeTime(new Date(row.last_used_at))}
                    </time>
                  )}
                </td>
                <td className="py-3">
                  <Badge tone={STATUS_TONES[status]} icon={STATUS_ICONS[status]}>
                    {t(STATUS_KEYS[status])}
                  </Badge>
                  {rotating2 ? (
                    <p className="mt-1 text-sm text-[--color-warning]">
                      {t('apiKeys.status.rotating', {
                        time: format.dateTime(new Date(row.previous_expires_at!), 'short'),
                      })}
                    </p>
                  ) : null}
                </td>
                <td className="py-3">
                  {props.canWrite && status === 'active' ? (
                    <div className="flex gap-2">
                      <Button type="button" variant="secondary" onClick={() => setRotating(row)}>
                        {t('apiKeys.rotate.button')}
                      </Button>
                      <Button type="button" variant="danger" onClick={() => setRevoking(row)}>
                        {t('apiKeys.revoke.button')}
                      </Button>
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {rotating ? (
        <RotateKeyDialog
          apiKey={rotating}
          workspaceId={props.workspaceId}
          slug={props.slug}
          onClose={() => setRotating(null)}
        />
      ) : null}
      {revoking ? (
        <RevokeKeyDialog
          apiKey={revoking}
          workspaceId={props.workspaceId}
          slug={props.slug}
          onClose={() => setRevoking(null)}
        />
      ) : null}
    </>
  );
}
```

**Pozor na pořadí destruktivních tlačítek.** Podle 11.3 části 6 nesmí být destruktivní akce bezprostředně vedle běžné. „Rotovat sekret" a „Zrušit klíč" jsou obě rizikové, ale různě: mezera mezi nimi je proto povinná (`gap-2` je minimum) a „Zrušit klíč" je jediné s variantou `danger`.

- [ ] **Krok 7: Napiš panel vytvoření klíče**

`apps/web/src/features/api-keys/create-key-panel.tsx`:

```tsx
'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { IdempotencyField } from '@/lib/feedback/idempotency-field';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { SecretReveal } from './secret-reveal';
import { createApiKeyAction } from './actions';

export type CreateKeyPanelProps = {
  workspaceId: string;
  slug: string;
  /** Scopes, které smí aktér klíči udělit. Nikdy víc, než má sám. */
  availableScopes: readonly string[];
  action?: (previous: ActionState, formData: FormData) => Promise<ActionState>;
};

export function CreateKeyPanel({ workspaceId, slug, availableScopes, action }: CreateKeyPanelProps) {
  const t = useTranslations('settings');
  const [state, formAction] = useActionState(action ?? createApiKeyAction, IDLE);
  const [dismissed, setDismissed] = useState(false);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};

  const created = state.status === 'success' ? (state.data as { secret: string } | undefined) : undefined;

  if (created && !dismissed) {
    return (
      <SecretReveal
        secret={created.secret}
        titleKey="apiKeys.secret.title"
        warningKey="apiKeys.secret.warning"
        onClose={() => setDismissed(true)}
      />
    );
  }

  return (
    <section aria-labelledby="api-keys-create">
      <h2 id="api-keys-create" className="text-xl font-semibold">
        {t('apiKeys.create.title')}
      </h2>
      <p className="mt-2 text-[--color-text-muted]">{t('apiKeys.create.lead')}</p>

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mt-4">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      <form action={formAction} className="mt-4" noValidate>
        <IdempotencyField />
        <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
        <input type="hidden" name="slug" value={slug} readOnly />

        <div className="mb-4">
          <Label htmlFor="key-name">{t('apiKeys.create.name')}</Label>
          <Input id="key-name" name="name" {...fieldAria('name', fieldErrors)} />
          <p className="mt-1 text-sm text-[--color-text-muted]">{t('apiKeys.create.nameHint')}</p>
          <FieldError name="name" errors={fieldErrors} />
        </div>

        <fieldset className="mb-6">
          <legend className="font-medium">{t('apiKeys.create.scopes')}</legend>
          <p className="mt-1 text-sm text-[--color-text-muted]">{t('apiKeys.create.scopesHint')}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {availableScopes.map((scope) => (
              <label key={scope} className="flex items-center gap-2">
                <Checkbox name="scopes" value={scope} />
                <code className="text-sm">{scope}</code>
              </label>
            ))}
          </div>
          <FieldError name="scopes" errors={fieldErrors} />
        </fieldset>

        <SubmitButton label={t('apiKeys.create.submit')} pendingLabel={t('apiKeys.create.submitting')} />
      </form>
    </section>
  );
}
```

- [ ] **Krok 8: Napiš stránku klíčů**

`apps/web/src/app/[locale]/w/[workspaceSlug]/settings/api-keys/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiKeysTable, type ApiKeyRow } from '@/features/api-keys/api-keys-table';
import { CreateKeyPanel } from '@/features/api-keys/create-key-panel';
import { SettingsPageShell } from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('apiKeys.title') };
}

export default async function ApiKeysPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const t = await getTranslations('settings');

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  if (!hasPermission(access.data, 'api_keys:read')) {
    return (
      <ForbiddenSection permission="api_keys:read" currentRole={access.data.role} workspaceSlug={workspaceSlug} />
    );
  }

  const canWrite = hasPermission(access.data, 'api_keys:write');
  const keys = await apiFetch<{ data: ApiKeyRow[] }>('/api/v1/api-keys', {
    workspaceId: access.data.workspace.id,
  });

  return (
    <SettingsPageShell title={t('apiKeys.title')} lead={t('apiKeys.lead')}>
      <div className="space-y-12">
        <ApiKeysTable
          keys={keys}
          canWrite={canWrite}
          workspaceId={access.data.workspace.id}
          slug={workspaceSlug}
          onCreate={() => undefined}
        />
        {canWrite ? (
          <CreateKeyPanel
            workspaceId={access.data.workspace.id}
            slug={workspaceSlug}
            availableScopes={access.data.permissions}
          />
        ) : null}
      </div>
    </SettingsPageShell>
  );
}
```

**Proč `availableScopes` jsou oprávnění aktéra.** Klíč nesmí umět víc než člověk, který ho vytvořil, jinak by si admin vyrobil klíč se `backups:run`, které jeho role nemá. Vynucení na serveru vlastní P04, tohle je jen odpovídající nabídka v rozhraní.

- [ ] **Krok 9: Spusť testy a ověř, že procházejí**

Run: `pnpm --filter @mlain/web exec vitest run src/features/api-keys/`
Expected: PASS, `Tests  14 passed (14)`.

- [ ] **Krok 10: Commit**

```bash
git add apps/web/src/features/api-keys "apps/web/src/app/[locale]/w"
git commit -m "feat(web): api keys list and creation with one time secret"
```

---

### Úkol 28: Rotace a revokace klíče k API

**Soubory:**
- Create: `apps/web/src/features/api-keys/rotate-key-dialog.tsx`
- Create: `apps/web/src/features/api-keys/rotate-key-dialog.test.tsx`
- Create: `apps/web/src/features/api-keys/revoke-key-dialog.tsx`
- Create: `apps/web/src/features/api-keys/revoke-key-dialog.test.tsx`

**Zařazení podle 6.2 části 6:** rotace klíče k API je v tabulce výslovně jako **N3**, tedy dialog se souhrnem, počtem, výčtem následků a **zaškrtnutím jedné konkrétní věty**. Revokace v tabulce není; podle os z 6.1 má rozsah 0, obnovitelnost 2 (zrušený klíč nejde vzkřísit) a vnější dopad 2 (rozbije integraci u zákazníka), tedy součet 4 a úroveň **N3** také.

Přechodné období rotace je parametr `grace_seconds` (0 až 86400) z 3.5 části 1 a kritérium 26c ho ověřuje. Rozhraní nabízí tři hodnoty, ne volné pole: 0, 3600 a 86400.

- [ ] **Krok 1: Napiš padající test rotace**

`apps/web/src/features/api-keys/rotate-key-dialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { ApiKeyRow } from './api-keys-table';
import { RotateKeyDialogView } from './rotate-key-dialog';

const messages = { settings: csSettings };

const KEY: ApiKeyRow = {
  id: 'k1',
  name: 'E-shop, objednávky',
  prefix: 'ugzmhvhf',
  kind: 'secret',
  scopes: ['contacts:read'],
  created_by_name: 'Jana Nováková',
  last_used_at: '2026-07-30T10:00:00.000Z',
  expires_at: null,
  revoked_at: null,
  previous_expires_at: null,
  created_at: '2026-05-01T10:00:00.000Z',
};

function renderDialog() {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <RotateKeyDialogView apiKey={KEY} workspaceId="ws1" slug="eshop" onClose={vi.fn()} action={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe('RotateKeyDialogView', () => {
  it('nadpis jmenuje konkrétní klíč', () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Rotovat sekret klíče E-shop, objednávky?' })).toBeInTheDocument();
  });

  it('vyjmenuje následky včetně toho, že se oprávnění nemění', () => {
    renderDialog();
    expect(screen.getByText(/nový sekret a ukážeme ho jednou/)).toBeInTheDocument();
    expect(screen.getByText(/přestanou fungovat, jakmile doběhne přechodné období/)).toBeInTheDocument();
    expect(screen.getByText(/Oprávnění klíče se nemění/)).toBeInTheDocument();
  });

  it('nabídne tři hodnoty přechodného období, ne volné pole', () => {
    renderDialog();
    const select = screen.getByLabelText('Přechodné období pro starý sekret');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Bez přechodného období' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '1 hodina' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '24 hodin' })).toBeInTheDocument();
  });

  it('vyžaduje zaškrtnutí konkrétní věty, ne obecného souhlasu', () => {
    renderDialog();
    expect(screen.getByLabelText('Rozumím, že starý sekret přestane platit')).toBeInTheDocument();
    expect(screen.queryByLabelText('Souhlasím')).not.toBeInTheDocument();
  });

  it('tlačítko ústupu je pojmenované slovesem', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Nechat současný sekret' })).toBeInTheDocument();
  });

  it('výchozí hodnota přechodného období je nula', () => {
    renderDialog();
    expect(screen.getByLabelText('Přechodné období pro starý sekret')).toHaveValue('0');
  });

  it('zvolená hodnota se propíše do skrytého pole grace_seconds', async () => {
    const { container } = renderDialog();
    await userEvent.selectOptions(screen.getByLabelText('Přechodné období pro starý sekret'), '3600');
    expect(container.querySelector('input[name="grace_seconds"]')).toHaveValue('3600');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/api-keys/rotate-key-dialog.test.tsx`
Expected: FAIL, `Failed to resolve import "./rotate-key-dialog"`.

- [ ] **Krok 3: Napiš dialog rotace**

`apps/web/src/features/api-keys/rotate-key-dialog.tsx`:

```tsx
'use client';

import { useActionState, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Label } from '@mlain/ui/components/label';
import { SelectField } from '@/lib/forms/select-field';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import type { ApiKeyRow } from './api-keys-table';
import { SecretReveal } from './secret-reveal';
import { rotateApiKeyAction } from './actions';

/** Tři nabízené hodnoty místo volného pole. Rozsah 0 až 86400 je z 3.5 části 1. */
const GRACE_OPTIONS = [
  { value: '0', labelKey: 'apiKeys.rotate.graceOptions.none' },
  { value: '3600', labelKey: 'apiKeys.rotate.graceOptions.hour' },
  { value: '86400', labelKey: 'apiKeys.rotate.graceOptions.day' },
] as const;

export type RotateKeyDialogViewProps = {
  apiKey: ApiKeyRow;
  workspaceId: string;
  slug: string;
  onClose: () => void;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
};

export function RotateKeyDialogView({ apiKey, workspaceId, slug, onClose, action }: RotateKeyDialogViewProps) {
  const t = useTranslations('settings');
  const confirmLabels = useConfirmDialogLabels();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(action, IDLE);
  const [grace, setGrace] = useState('0');
  const [confirming, setConfirming] = useState(false);
  const graceOption = GRACE_OPTIONS.find((option) => option.value === grace) ?? GRACE_OPTIONS[0];

  const rotated = state.status === 'success' ? (state.data as { secret: string } | undefined) : undefined;

  if (rotated) {
    return (
      <SecretReveal
        secret={rotated.secret}
        titleKey="apiKeys.secret.title"
        warningKey="apiKeys.secret.warning"
        onClose={onClose}
      />
    );
  }

  return (
    <form ref={formRef} action={formAction}>
      <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="key_id" value={apiKey.id} readOnly />
      {/* `grace_seconds` do FormData vkládá SelectField vlastním skrytým polem. */}

      {state.status === 'error' ? <SettingsProblem problem={state.problem} /> : null}

      {/*
        Výběr doby dožití dřív stál uvnitř `<ConfirmDialog>` jako `children`.
        Ten prop komponenta nemá a mít nemá: dialog má popsat následky, ne
        sbírat vstupy. Pořadí je teď takové, jaké ve skutečnosti je: nejdřív
        se vybere doba, pak se potvrzuje, a hodnota se do následků promítne,
        takže uživatel v dialogu vidí, co přesně potvrzuje.
      */}
      <div className="mt-4">
        <SelectField
          name="grace_seconds"
          label={t('apiKeys.rotate.graceLabel')}
          placeholder={t('shared.selectPlaceholder')}
          defaultValue={grace}
          options={GRACE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
          hint={t('apiKeys.rotate.graceHint')}
          onSelected={setGrace}
        />
      </div>

      <div className="mt-6 flex gap-3">
        <Button type="button" variant="primary" onClick={() => setConfirming(true)}>
          {t('apiKeys.rotate.button')}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('apiKeys.rotate.panelCancel')}
        </Button>
      </div>

      <ConfirmDialog
        // Dialog se otevře až po volbě doby dožití. Kdyby byl otevřený hned,
        // uživatel by potvrzoval hodnotu, na kterou pod ním nedosáhne.
        open={confirming}
        onOpenChange={setConfirming}
        level="N3"
        title={t('apiKeys.rotate.dialogTitle', { name: apiKey.name })}
        consequences={[
          t('apiKeys.rotate.consequence1'),
          t('apiKeys.rotate.consequence2', { grace: t(graceOption.labelKey) }),
          t('apiKeys.rotate.consequence3'),
        ]}
        acknowledgement={t('apiKeys.rotate.acknowledge')}
        confirmLabel={t('apiKeys.rotate.confirm')}
        cancelLabel={t('apiKeys.rotate.cancel')}
        onConfirm={() => formRef.current?.requestSubmit()}
        labels={confirmLabels}
      />
    </form>
  );
}

/** Serverová obálka, aby tabulka nemusela znát akci. */
export function RotateKeyDialog(props: Omit<RotateKeyDialogViewProps, 'action'>) {
  return <RotateKeyDialogView {...props} action={rotateApiKeyAction} />;
}
```

- [ ] **Krok 4: Napiš padající test revokace**

`apps/web/src/features/api-keys/revoke-key-dialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { ApiKeyRow } from './api-keys-table';
import { RevokeKeyDialogView } from './revoke-key-dialog';

const messages = { settings: csSettings };

const KEY: ApiKeyRow = {
  id: 'k1',
  name: 'E-shop, objednávky',
  prefix: 'ugzmhvhf',
  kind: 'secret',
  scopes: ['contacts:read'],
  created_by_name: 'Jana Nováková',
  last_used_at: '2026-07-30T10:00:00.000Z',
  expires_at: null,
  revoked_at: null,
  previous_expires_at: null,
  created_at: '2026-05-01T10:00:00.000Z',
};

function renderDialog(lastUsedAt: string | null = KEY.last_used_at) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <RevokeKeyDialogView
        apiKey={{ ...KEY, last_used_at: lastUsedAt }}
        workspaceId="ws1"
        slug="eshop"
        onClose={vi.fn()}
        action={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe('RevokeKeyDialogView', () => {
  it('nadpis jmenuje konkrétní klíč a tlačítko taky', () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Zrušit klíč E-shop, objednávky?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zrušit klíč E-shop, objednávky' })).toBeInTheDocument();
  });

  it('řekne, že akce je okamžitá a nevratná', () => {
    renderDialog();
    expect(screen.getByText(/přestanou fungovat okamžitě/)).toBeInTheDocument();
    expect(screen.getByText(/Obnovit ho nejde/)).toBeInTheDocument();
  });

  it('uvede, kdy byl klíč naposledy použit', () => {
    renderDialog();
    expect(screen.getByText(/Naposledy byl použit/)).toBeInTheDocument();
  });

  it('u nepoužitého klíče napíše Nikdy, ne prázdno', () => {
    renderDialog(null);
    expect(screen.getByText(/Nikdy/)).toBeInTheDocument();
  });

  it('vyžaduje zaškrtnutí konkrétní věty', () => {
    renderDialog();
    expect(screen.getByLabelText('Rozumím, že zrušený klíč už nepůjde obnovit')).toBeInTheDocument();
  });

  it('tlačítko ústupu je pojmenované slovesem, ne slovem Ne', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Nechat klíč' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ne' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Krok 5: Napiš dialog revokace**

`apps/web/src/features/api-keys/revoke-key-dialog.tsx`:

```tsx
'use client';

import { useActionState, useRef } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import type { ApiKeyRow } from './api-keys-table';
import { revokeApiKeyAction } from './actions';

export type RevokeKeyDialogViewProps = {
  apiKey: ApiKeyRow;
  workspaceId: string;
  slug: string;
  onClose: () => void;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
};

export function RevokeKeyDialogView({ apiKey, workspaceId, slug, onClose, action }: RevokeKeyDialogViewProps) {
  const t = useTranslations('settings');
  const confirmLabels = useConfirmDialogLabels();
  const format = useFormatter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(action, IDLE);

  const lastUsed =
    apiKey.last_used_at === null
      ? t('shared.never')
      : format.dateTime(new Date(apiKey.last_used_at), 'short');

  return (
    <form ref={formRef} action={formAction}>
      <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="key_id" value={apiKey.id} readOnly />
      <input type="hidden" name="name" value={apiKey.name} readOnly />

      {state.status === 'error' ? <SettingsProblem problem={state.problem} /> : null}

      <ConfirmDialog
        open
        onOpenChange={(open: boolean) => {
          if (!open) onClose();
        }}
        level="N3"
        title={t('apiKeys.revoke.dialogTitle', { name: apiKey.name })}
        consequences={[
          t('apiKeys.revoke.consequence1'),
          t('apiKeys.revoke.consequence2'),
          t('apiKeys.revoke.consequence3', { lastUsed }),
        ]}
        acknowledgement={t('apiKeys.revoke.acknowledge')}
        confirmLabel={t('apiKeys.revoke.confirm', { name: apiKey.name })}
        cancelLabel={t('apiKeys.revoke.cancel')}
        onConfirm={() => formRef.current?.requestSubmit()}
        labels={confirmLabels}
      />
    </form>
  );
}

/** Serverová obálka, aby tabulka nemusela znát akci. */
export function RevokeKeyDialog(props: Omit<RevokeKeyDialogViewProps, 'action'>) {
  return <RevokeKeyDialogView {...props} action={revokeApiKeyAction} />;
}
```

- [ ] **Krok 6: Spusť testy klíčů a ověř, že procházejí**

Run: `pnpm --filter @mlain/web exec vitest run src/features/api-keys/`
Expected: PASS, `Tests  27 passed (27)`.

- [ ] **Krok 7: Commit**

```bash
git add apps/web/src/features/api-keys
git commit -m "feat(web): api key rotation with grace period and revocation"
```

---

### Úkol 29: Webhooky, seznam, limit a vypnutý stav

**Soubory:**
- Create: `apps/web/src/features/webhooks/actions.ts`
- Create: `apps/web/src/features/webhooks/webhooks-table.tsx`
- Create: `apps/web/src/features/webhooks/webhooks-table.test.tsx`
- Create: `apps/web/src/features/webhooks/disabled-banner.tsx`
- Create: `apps/web/src/features/webhooks/disabled-banner.test.tsx`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/webhooks/page.tsx`

**Limity z 3.8 části 1:** nejvýš **20 endpointů na projekt** (stav S15) a nejvýš 50 typů událostí na endpoint.

**Deaktivace:** po dvaceti neúspěších po sobě, nebo po 72 hodinách bez úspěchu při aspoň 10 pokusech. Text z 5.3 části 1 se přebírá doslova: „Váš webhook jsme vypnuli po 20 neúspěšných pokusech. Opravte cíl a zapněte ho znovu." Podrobnější podání z hlášky 25 v 10.3 části 6 se použije v detailu, kde je místo na adresu, stavový kód a datum.

Prázdný stav používá doslovný text z 5.3 části 1: „Žádný webhook. Webhook pošle událost na vaši adresu, jakmile se něco stane."

- [ ] **Krok 1: Napiš padající test pruhu deaktivace**

`apps/web/src/features/webhooks/disabled-banner.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { DisabledBanner } from './disabled-banner';

const messages = { settings: csSettings };

function renderBanner(detail = true) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <DisabledBanner
        url="https://eshop.cz/hooks/mlain"
        lastStatus={500}
        since="2026-07-29T08:00:00.000Z"
        withDetail={detail}
        onEnable={vi.fn()}
        endpointHref="/w/eshop/settings/webhooks/w1"
      />
    </NextIntlClientProvider>,
  );
}

describe('DisabledBanner', () => {
  it('v seznamu použije krátký doslovný text ze specifikace', () => {
    renderBanner(false);
    expect(
      screen.getByText('Váš webhook jsme vypnuli po 20 neúspěšných pokusech. Opravte cíl a zapněte ho znovu.'),
    ).toBeInTheDocument();
  });

  it('v detailu doplní adresu, stavový kód a datum', () => {
    renderBanner(true);
    expect(screen.getByText(/https:\/\/eshop\.cz\/hooks\/mlain/)).toBeInTheDocument();
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it('slibuje přehrání posledních 24 hodin a říká, co se doposlat nedá', () => {
    renderBanner(true);
    expect(screen.getByText(/přehrání událostí za posledních 24 hodin/)).toBeInTheDocument();
    expect(screen.getByText(/Co je starší, se doposlat nedá/)).toBeInTheDocument();
  });

  it('nabídne obě akce z hlášky 25', () => {
    renderBanner(true);
    expect(screen.getByRole('link', { name: 'Zobrazit poslední chyby' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zapnout znovu' })).toBeInTheDocument();
  });

  it('stav nesděluje jen barvou, ale i slovem', () => {
    renderBanner(true);
    expect(screen.getByText('Váš webhook jsme vypnuli')).toBeInTheDocument();
  });

  it('drží kód v data-error-code kvůli testům', () => {
    const { container } = renderBanner(true);
    expect(container.querySelector('[data-error-code="webhook_endpoint_disabled"]')).not.toBeNull();
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/webhooks/disabled-banner.test.tsx`
Expected: FAIL, `Failed to resolve import "./disabled-banner"`.

- [ ] **Krok 3: Napiš pruh deaktivace**

`apps/web/src/features/webhooks/disabled-banner.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Alert } from '@mlain/ui/patterns/states';

export type DisabledBannerProps = {
  url: string;
  lastStatus: number | null;
  since: string | null;
  /** V seznamu stačí krátký text, v detailu je místo na adresu a datum. */
  withDetail: boolean;
  endpointHref: string;
  onEnable: () => void;
};

/**
 * Krátký text je doslovný z 5.3 části 1, podrobnější podání je z hlášky 25
 * v 10.3 části 6. Obě verze slibují přehrání posledních 24 hodin, protože to
 * 3.8 části 1 u tlačítka „Znovu aktivovat" výslovně nabízí.
 */
export function DisabledBanner(props: DisabledBannerProps) {
  const t = useTranslations('settings');
  const format = useFormatter();

  return (
    <Alert
      // `Alert` s tónem `error` si roli `alert` a ikonu nastaví sám,
      // takže se tady nekreslí potřetí. Kód v DOM zůstává kvůli testům.
      tone="error"
      data-error-code="webhook_endpoint_disabled"
      title={t('webhooks.disabled.title')}
    >
      <p>{t('webhooks.disabled.body')}</p>

      {props.withDetail ? (
        <>
          <p className="mt-2 text-sm text-[--color-text-muted]">
            {t('webhooks.disabled.detail', {
              url: props.url,
              lastStatus: props.lastStatus ?? 0,
              since: props.since === null ? '' : format.dateTime(new Date(props.since), 'short'),
            })}
          </p>
          <p className="mt-2 text-sm text-[--color-text-muted]">{t('webhooks.disabled.replayNote')}</p>
        </>
      ) : null}

      <div className="mt-3 flex gap-2">
        <Link href={`${props.endpointHref}?status=failed`} className="underline">
          {t('webhooks.disabled.showErrors')}
        </Link>
        <Button type="button" variant="primary" onClick={props.onEnable}>
          {t('webhooks.disabled.enable')}
        </Button>
      </div>
    </Alert>
  );
}
```

- [ ] **Krok 4: Napiš Server Actions webhooků**

`apps/web/src/features/webhooks/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiMutate } from '@/lib/api-client/mutate';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';
import { IDEMPOTENCY_FIELD_NAME } from '@/lib/feedback/idempotency-field';

function validationProblem(instance: string, issues: Array<{ path: string; code: string; message: string }>) {
  return {
    type: 'https://docs.mlain.dev/errors/validation_failed',
    title: 'Validation failed',
    status: 422,
    detail: '',
    instance,
    code: 'validation_failed',
    request_id: '',
    errors: issues,
  };
}

const BaseSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
});

const EndpointSchema = BaseSchema.extend({
  url: z.string().trim().url().startsWith('https://'),
  description: z.string().trim().max(500),
  event_types: z.array(z.string().min(1)).min(1).max(50),
});

export async function createWebhookAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = EndpointSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    url: formData.get('url'),
    description: formData.get('description') ?? '',
    event_types: formData.getAll('event_types').map(String),
  });

  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem(
        '/api/v1/webhook-endpoints',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      ),
    );
  }

  const result = await apiMutate<{ id: string; secret: string }>('/api/v1/webhook-endpoints', {
    method: 'POST',
    body: {
      url: parsed.data.url,
      description: parsed.data.description,
      event_types: parsed.data.event_types,
    },
    workspaceId: parsed.data.workspace_id,
    idempotencyKey: String(formData.get(IDEMPOTENCY_FIELD_NAME) ?? ''),
  });
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/webhooks`);
  return succeeded({ channel: 'inlineBlock', messageKey: 'webhooks.secret.title', data: result.data });
}

const UpdateSchema = EndpointSchema.extend({ endpoint_id: z.string().min(1) });

export async function updateWebhookAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = UpdateSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    endpoint_id: formData.get('endpoint_id'),
    url: formData.get('url'),
    description: formData.get('description') ?? '',
    event_types: formData.getAll('event_types').map(String),
  });

  if (!parsed.success) {
    return failed(
      'inline',
      validationProblem(
        '/api/v1/webhook-endpoints',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      ),
    );
  }

  const result = await apiMutate<void>(`/api/v1/webhook-endpoints/${parsed.data.endpoint_id}`, {
    method: 'PATCH',
    body: {
      url: parsed.data.url,
      description: parsed.data.description,
      event_types: parsed.data.event_types,
    },
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return failed('inline', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/webhooks`);
  return succeeded({ channel: 'inline', messageKey: 'shared.saved' });
}

const EndpointIdSchema = BaseSchema.extend({ endpoint_id: z.string().min(1) });

export async function deleteWebhookAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = EndpointIdSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    endpoint_id: formData.get('endpoint_id'),
  });
  if (!parsed.success) {
    return failed(
      'toast',
      validationProblem('/api/v1/webhook-endpoints', [
        { path: 'endpoint_id', code: 'required', message: 'Chybí webhook.' },
      ]),
    );
  }

  const result = await apiMutate<void>(`/api/v1/webhook-endpoints/${parsed.data.endpoint_id}`, {
    method: 'DELETE',
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return failed('toast', result.problem);

  // Příznak `emptied` rozliší stav S3 od S1, viz rozhodnutí R8.
  revalidatePath(`/w/${parsed.data.slug}/settings/webhooks`);
  return succeeded({ channel: 'toast', messageKey: 'webhooks.delete.done' });
}

export async function testWebhookAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = EndpointIdSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    endpoint_id: formData.get('endpoint_id'),
  });
  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem('/api/v1/webhook-endpoints', [
        { path: 'endpoint_id', code: 'required', message: 'Chybí webhook.' },
      ]),
    );
  }

  const result = await apiMutate<{ status: number; duration_ms: number }>(
    `/api/v1/webhook-endpoints/${parsed.data.endpoint_id}/test`,
    { method: 'POST', body: {}, workspaceId: parsed.data.workspace_id },
  );
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/webhooks/${parsed.data.endpoint_id}`);
  return succeeded({
    channel: 'inlineBlock',
    messageKey: 'webhooks.test.successTitle',
    values: { status: result.data.status, duration: `${result.data.duration_ms} ms` },
  });
}

export async function enableWebhookAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = EndpointIdSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    endpoint_id: formData.get('endpoint_id'),
  });
  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem('/api/v1/webhook-endpoints', [
        { path: 'endpoint_id', code: 'required', message: 'Chybí webhook.' },
      ]),
    );
  }

  const result = await apiMutate<void>(`/api/v1/webhook-endpoints/${parsed.data.endpoint_id}/enable`, {
    method: 'POST',
    body: {},
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/webhooks`);
  return succeeded({ channel: 'inlineBlock', messageKey: 'webhooks.disabled.enabled' });
}

const RetrySchema = BaseSchema.extend({ delivery_id: z.string().min(1), endpoint_id: z.string().min(1) });

export async function retryDeliveryAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = RetrySchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    delivery_id: formData.get('delivery_id'),
    endpoint_id: formData.get('endpoint_id'),
  });
  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem('/api/v1/webhook-deliveries', [
        { path: 'delivery_id', code: 'required', message: 'Chybí doručení.' },
      ]),
    );
  }

  const result = await apiMutate<void>(`/api/v1/webhook-deliveries/${parsed.data.delivery_id}/retry`, {
    method: 'POST',
    body: {},
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/webhooks/${parsed.data.endpoint_id}`);
  return succeeded({ channel: 'inlineBlock', messageKey: 'webhooks.deliveries.retried' });
}
```

- [ ] **Krok 5: Napiš padající test tabulky webhooků**

`apps/web/src/features/webhooks/webhooks-table.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { Result } from '@/lib/api-client/result';
import { WebhooksTable, type WebhookRow } from './webhooks-table';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const messages = { settings: csSettings };

const ACTIVE: WebhookRow = {
  id: 'w1',
  url: 'https://eshop.cz/hooks/mlain',
  description: 'Objednávky',
  event_types: ['contact.created'],
  status: 'active',
  disabled_reason: null,
  disabled_at: null,
  consecutive_failures: 0,
  last_success_at: '2026-07-31T10:00:00.000Z',
  last_failure_at: null,
};

function renderTable(endpoints: Result<{ data: WebhookRow[] }>, emptied = false) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <WebhooksTable
        endpoints={endpoints}
        canWrite
        workspaceId="ws1"
        slug="eshop"
        emptied={emptied}
        enableAction={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

function manyEndpoints(count: number): WebhookRow[] {
  return Array.from({ length: count }, (_value, index) => ({ ...ACTIVE, id: `w${index}` }));
}

describe('WebhooksTable', () => {
  it('vypíše adresu, události a stav', () => {
    renderTable({ ok: true, data: { data: [ACTIVE] } });
    expect(screen.getByText('https://eshop.cz/hooks/mlain')).toBeInTheDocument();
    expect(screen.getByText('contact.created')).toBeInTheDocument();
    expect(screen.getByText('Aktivní')).toBeInTheDocument();
  });

  it('u prázdného seznamu ukáže variantu first s vysvětlením a akcí', () => {
    renderTable({ ok: true, data: { data: [] } });
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'first');
    expect(within(empty).getByTestId('empty-explanation')).toHaveTextContent(csSettings.webhooks.empty);
    expect(within(empty).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('po smazání posledního webhooku ukáže variantu emptied, ne first', () => {
    renderTable({ ok: true, data: { data: [] } }, true);
    // Rozlišení S1 a S3 podle rozhodnutí R8. Varianta je v DOM, takže na ni
    // jde sáhnout, aniž by se kontrolovalo znění věty.
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'emptied');
    expect(within(empty).getByTestId('empty-explanation')).toHaveTextContent(csSettings.webhooks.emptyAfterDelete);
  });

  it('u vypnutého webhooku ukáže pruh s vysvětlením a s tlačítkem zapnout', () => {
    renderTable({
      ok: true,
      data: {
        data: [
          {
            ...ACTIVE,
            status: 'disabled',
            disabled_reason: 'too_many_failures',
            disabled_at: '2026-07-31T09:00:00.000Z',
            consecutive_failures: 20,
          },
        ],
      },
    });
    expect(screen.getByRole('button', { name: 'Zapnout znovu' })).toBeInTheDocument();
  });

  it('u selhávajícího, ale zapnutého webhooku uvede počet neúspěchů', () => {
    renderTable({ ok: true, data: { data: [{ ...ACTIVE, consecutive_failures: 3 }] } });
    expect(screen.getByText(/3 neúspěchy po sobě/)).toBeInTheDocument();
  });

  it('u dvaceti webhooků ukáže stav přes limit', () => {
    renderTable({ ok: true, data: { data: manyEndpoints(20) } });
    expect(screen.getByText('Víc webhooků přidat nejde')).toBeInTheDocument();
    expect(screen.getByText(/20 webhooků, což je maximum/)).toBeInTheDocument();
  });

  it('u devatenácti webhooků limit nehlásí', () => {
    renderTable({ ok: true, data: { data: manyEndpoints(19) } });
    expect(screen.queryByText('Víc webhooků přidat nejde')).not.toBeInTheDocument();
  });

  it('u chyby ukáže blok s request_id', () => {
    renderTable({
      ok: false,
      problem: {
        type: '',
        title: 'Forbidden',
        status: 403,
        detail: '',
        instance: '/api/v1/webhook-endpoints',
        code: 'forbidden',
        request_id: 'req_41',
      },
    });
    expect(screen.getByText('req_41')).toBeInTheDocument();
  });
});
```

- [ ] **Krok 6: Napiš tabulku webhooků a stránku**

`apps/web/src/features/webhooks/webhooks-table.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { EmptyState, OverLimitState } from '@mlain/ui/patterns/states';
import { CheckIcon, SlashIcon, WarningIcon } from '@/lib/ui/status-icons';
import type { Result } from '@/lib/api-client/result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { DisabledBanner } from './disabled-banner';

/** Maximum endpointů na projekt podle 3.8 části 1. */
export const WEBHOOK_ENDPOINT_LIMIT = 20;

export type WebhookRow = {
  id: string;
  url: string;
  description: string;
  event_types: string[];
  status: 'active' | 'disabled';
  disabled_reason: string | null;
  disabled_at: string | null;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
};

export type WebhooksTableProps = {
  endpoints: Result<{ data: WebhookRow[] }>;
  canWrite: boolean;
  workspaceId: string;
  slug: string;
  /** Příznak z URL, který rozliší stav S3 od S1, viz rozhodnutí R8. */
  emptied: boolean;
  enableAction: (formData: FormData) => void;
};

export function WebhooksTable(props: WebhooksTableProps) {
  const t = useTranslations('settings');
  const format = useFormatter();
  const router = useRouter();

  if (!props.endpoints.ok) {
    return <SettingsProblem problem={props.endpoints.problem} onRetry={() => window.location.reload()} />;
  }

  const rows = props.endpoints.data.data;

  if (rows.length === 0) {
    return (
      <EmptyState
        // Varianta rozliší stav S1 od S3, viz rozhodnutí R8. Komponenta ji
        // vypíše do `data-variant`, takže na ni jde v testu sáhnout
        // strukturálně, bez kontroly znění věty.
        variant={props.emptied ? 'emptied' : 'first'}
        title={t('webhooks.title')}
        explanation={props.emptied ? t('webhooks.emptyAfterDelete') : t('webhooks.empty')}
        actions={
          props.canWrite
            ? [{ label: t('webhooks.emptyAction'), onClick: () => router.push(`/w/${props.slug}/settings/webhooks/new`) }]
            : [
                {
                  label: t('shared.backToOverview'),
                  onClick: () => router.push(`/w/${props.slug}`),
                  description: t('webhooks.emptyNoPermission'),
                },
              ]
        }
      />
    );
  }

  return (
    <>
      <table className="w-full text-left">
        <caption className="sr-only">{t('webhooks.title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('webhooks.table.url')}</th>
            <th scope="col">{t('webhooks.table.events')}</th>
            <th scope="col">{t('webhooks.table.status')}</th>
            <th scope="col">{t('webhooks.table.lastDelivery')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = `/w/${props.slug}/settings/webhooks/${row.id}`;
            return (
              <tr key={row.id} className="border-t border-[--color-border] align-top">
                <td className="py-3">
                  <Link href={href} className="font-medium underline">
                    {row.url}
                  </Link>
                  {row.description === '' ? null : (
                    <p className="text-sm text-[--color-text-muted]">{row.description}</p>
                  )}
                  {row.status === 'disabled' && props.canWrite ? (
                    <form action={props.enableAction} className="mt-2">
                      <input type="hidden" name="workspace_id" value={props.workspaceId} readOnly />
                      <input type="hidden" name="slug" value={props.slug} readOnly />
                      <input type="hidden" name="endpoint_id" value={row.id} readOnly />
                      <DisabledBanner
                        url={row.url}
                        lastStatus={null}
                        since={row.disabled_at}
                        withDetail={false}
                        endpointHref={href}
                        onEnable={() => undefined}
                      />
                    </form>
                  ) : null}
                </td>
                <td className="py-3 text-sm">{row.event_types.join(', ')}</td>
                <td className="py-3">
                  {row.status === 'disabled' ? (
                    <Badge tone="danger" icon={SlashIcon}>
                      {t('webhooks.status.disabled')}
                    </Badge>
                  ) : row.consecutive_failures > 0 ? (
                    <Badge tone="warning" icon={WarningIcon}>
                      {t('webhooks.status.failing', { count: row.consecutive_failures })}
                    </Badge>
                  ) : (
                    <Badge tone="success" icon={CheckIcon}>
                      {t('webhooks.status.active')}
                    </Badge>
                  )}
                </td>
                <td className="py-3">
                  {row.last_success_at === null ? (
                    t('shared.never')
                  ) : (
                    <time dateTime={row.last_success_at} title={row.last_success_at}>
                      {format.relativeTime(new Date(row.last_success_at))}
                    </time>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {rows.length >= WEBHOOK_ENDPOINT_LIMIT ? (
        <div className="mt-6">
          <OverLimitState title={t('webhooks.limitTitle')} body={t('webhooks.limitBody')} />
        </div>
      ) : null}
    </>
  );
}
```

`apps/web/src/app/[locale]/w/[workspaceSlug]/settings/webhooks/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { enableWebhookAction } from '@/features/webhooks/actions';
import { WebhooksTable, WEBHOOK_ENDPOINT_LIMIT, type WebhookRow } from '@/features/webhooks/webhooks-table';
import { WebhookForm } from '@/features/webhooks/webhook-form';
import { SettingsPageShell } from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('webhooks.title') };
}

export default async function WebhooksPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ emptied?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { emptied } = await searchParams;
  const t = await getTranslations('settings');

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  if (!hasPermission(access.data, 'webhooks:read')) {
    return <ForbiddenSection permission="webhooks:read" currentRole={access.data.role} workspaceSlug={workspaceSlug} />;
  }

  const canWrite = hasPermission(access.data, 'webhooks:write');
  const endpoints = await apiFetch<{ data: WebhookRow[] }>('/api/v1/webhook-endpoints', {
    workspaceId: access.data.workspace.id,
  });

  const atLimit = endpoints.ok && endpoints.data.data.length >= WEBHOOK_ENDPOINT_LIMIT;

  return (
    <SettingsPageShell title={t('webhooks.title')} lead={t('webhooks.lead')}>
      <div className="space-y-12">
        <WebhooksTable
          endpoints={endpoints}
          canWrite={canWrite}
          workspaceId={access.data.workspace.id}
          slug={workspaceSlug}
          emptied={emptied === '1'}
          enableAction={enableWebhookAction as never}
        />
        {canWrite && !atLimit ? (
          <WebhookForm mode="create" workspaceId={access.data.workspace.id} slug={workspaceSlug} />
        ) : null}
      </div>
    </SettingsPageShell>
  );
}
```

- [ ] **Krok 7: Spusť testy a ověř, že procházejí**

Run: `pnpm --filter @mlain/web exec vitest run src/features/webhooks/`
Expected: PASS, `Tests  14 passed (14)`.

- [ ] **Krok 8: Commit**

```bash
git add apps/web/src/features/webhooks "apps/web/src/app/[locale]/w"
git commit -m "feat(web): webhook endpoints list with limit and disabled state"
```

---

### Úkol 30: Vytvoření a úprava webhook endpointu

**Soubory:**
- Create: `apps/web/src/features/webhooks/event-types.ts`
- Create: `apps/web/src/features/webhooks/webhook-form.tsx`
- Create: `apps/web/src/features/webhooks/webhook-form.test.tsx`

Podpisový sekret se ukazuje **právě jednou**, stejně jako u klíčů. Formulář navíc říká předem, že doručení je **nejméně jednou** a že se má deduplikovat podle `ML-Event-Id`; bez toho si integrátor postaví příjemce, který na duplicitu spadne.

Podle 10.4 části 6 se u zablokované adresy **nikdy** neuvádí důvod („cílí na privátní rozsah"), protože by z nástroje udělal skener vnitřní sítě. Text u pole proto říká jen to, kam neposíláme.

- [ ] **Krok 1: Napiš seznam typů událostí**

`apps/web/src/features/webhooks/event-types.ts`:

```ts
/**
 * Typy událostí, které smí endpoint odebírat. Zdrojem pravdy je backend,
 * proto se seznam načítá z API. Tenhle soubor drží jen tvar a rozdělení do
 * skupin, aby výběr padesáti položek nebyl jeden dlouhý sloupec.
 */
export type EventTypeGroup = {
  /** Prefix typu, například `contact`. Je to zároveň identifikátor skupiny. */
  prefix: string;
  types: string[];
};

export function groupEventTypes(types: readonly string[]): EventTypeGroup[] {
  const groups = new Map<string, string[]>();
  for (const type of types) {
    const prefix = type.split('.')[0] ?? type;
    const bucket = groups.get(prefix);
    if (bucket) bucket.push(type);
    else groups.set(prefix, [type]);
  }
  return [...groups.entries()]
    .map(([prefix, groupTypes]) => ({ prefix, types: groupTypes.toSorted() }))
    .toSorted((left, right) => left.prefix.localeCompare(right.prefix));
}

/** Maximum typů na endpoint podle 3.8 části 1. */
export const EVENT_TYPES_PER_ENDPOINT_LIMIT = 50;
```

- [ ] **Krok 2: Napiš padající test formuláře**

`apps/web/src/features/webhooks/webhook-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { ActionState } from '@/lib/feedback/action-result';
import { WebhookFormView } from './webhook-form';

const messages = { settings: csSettings };

const EVENT_TYPES = ['contact.created', 'contact.updated', 'campaign.sent'];

function renderForm(initialState?: ActionState, mode: 'create' | 'edit' = 'create') {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <WebhookFormView
        mode={mode}
        workspaceId="ws1"
        slug="eshop"
        availableEventTypes={EVENT_TYPES}
        action={vi.fn()}
        initialState={initialState}
      />
    </NextIntlClientProvider>,
  );
}

describe('WebhookFormView', () => {
  it('má pole adresy, popisu a výběr událostí', () => {
    renderForm();
    expect(screen.getByLabelText('Adresa, kam události posílat')).toBeInTheDocument();
    expect(screen.getByLabelText('Popis')).toBeInTheDocument();
    expect(screen.getByText('Které události posílat')).toBeInTheDocument();
  });

  it('u adresy říká jen to, kam neposíláme, nikdy proč byla adresa zablokovaná', () => {
    renderForm();
    expect(screen.getByText(/Jen https/)).toBeInTheDocument();
    expect(screen.queryByText(/privátní rozsah/)).not.toBeInTheDocument();
  });

  it('upozorní předem na doručení nejméně jednou a na ML-Event-Id', () => {
    renderForm();
    expect(screen.getByText(/nejméně jednou/)).toBeInTheDocument();
    expect(screen.getByText(/ML-Event-Id/)).toBeInTheDocument();
  });

  it('seskupí typy událostí podle předpony', () => {
    renderForm();
    expect(screen.getByRole('group', { name: 'contact' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'campaign' })).toBeInTheDocument();
  });

  it('po vytvoření ukáže podpisový sekret právě jednou', () => {
    renderForm({
      status: 'success',
      channel: 'inlineBlock',
      messageKey: 'webhooks.secret.title',
      data: { id: 'w1', secret: 'whsec_AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qhqK-2vcTL0tk' },
    });
    expect(screen.getByText('Zkopírujte si podpisový sekret teď. Už ho nikdy neuvidíme ani my.')).toBeInTheDocument();
    expect(screen.getByText('whsec_AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qhqK-2vcTL0tk')).toBeInTheDocument();
  });

  it('chybu adresy ukáže u pole', () => {
    renderForm({
      status: 'error',
      channel: 'inlineBlock',
      problem: {
        type: '',
        title: 'Validation failed',
        status: 422,
        detail: '',
        instance: '/api/v1/webhook-endpoints',
        code: 'validation_failed',
        request_id: 'req_51',
        errors: [{ path: 'url', code: 'blocked_target', message: 'Tuhle adresu volat neumíme.' }],
      },
      fieldErrors: { url: ['Tuhle adresu volat neumíme.'] },
    });
    expect(screen.getByLabelText('Adresa, kam události posílat')).toHaveAttribute('aria-invalid', 'true');
  });

  it('v režimu úprav použije jiný nadpis a jiný text tlačítka', () => {
    renderForm(undefined, 'edit');
    expect(screen.getByRole('heading', { name: 'Úprava webhooku' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uložit změny' })).toBeInTheDocument();
  });
});
```

- [ ] **Krok 3: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/webhooks/webhook-form.test.tsx`
Expected: FAIL, `Failed to resolve import "./webhook-form"`.

- [ ] **Krok 4: Napiš formulář**

`apps/web/src/features/webhooks/webhook-form.tsx`:

```tsx
'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { Textarea } from '@mlain/ui/components/textarea';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { IdempotencyField } from '@/lib/feedback/idempotency-field';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { SecretReveal } from '@/features/api-keys/secret-reveal';
import { groupEventTypes } from './event-types';
import { createWebhookAction, updateWebhookAction } from './actions';
import type { WebhookRow } from './webhooks-table';

export type WebhookFormViewProps = {
  mode: 'create' | 'edit';
  workspaceId: string;
  slug: string;
  availableEventTypes: readonly string[];
  endpoint?: WebhookRow;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  initialState?: ActionState;
};

export function WebhookFormView(props: WebhookFormViewProps) {
  const t = useTranslations('settings');
  const [state, formAction] = useActionState(props.action, props.initialState ?? IDLE);
  const [dismissed, setDismissed] = useState(false);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};

  const created = state.status === 'success' ? (state.data as { secret: string } | undefined) : undefined;
  if (created && !dismissed) {
    return (
      <SecretReveal
        secret={created.secret}
        titleKey="webhooks.secret.title"
        warningKey="webhooks.secret.warning"
        hintKey="webhooks.secret.hint"
        onClose={() => setDismissed(true)}
      />
    );
  }

  const groups = groupEventTypes(props.availableEventTypes);
  const selected = new Set(props.endpoint?.event_types ?? []);

  return (
    <section aria-labelledby="webhook-form">
      <h2 id="webhook-form" className="text-xl font-semibold">
        {props.mode === 'create' ? t('webhooks.form.createTitle') : t('webhooks.form.editTitle')}
      </h2>

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mt-4">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      <form action={formAction} className="mt-4" noValidate>
        {props.mode === 'create' ? <IdempotencyField /> : null}
        <input type="hidden" name="workspace_id" value={props.workspaceId} readOnly />
        <input type="hidden" name="slug" value={props.slug} readOnly />
        {props.endpoint ? <input type="hidden" name="endpoint_id" value={props.endpoint.id} readOnly /> : null}

        <div className="mb-4">
          <Label htmlFor="webhook-url">{t('webhooks.form.url')}</Label>
          <Input
            id="webhook-url"
            name="url"
            type="url"
            defaultValue={props.endpoint?.url}
            {...fieldAria('url', fieldErrors)}
          />
          <p className="mt-1 text-sm text-[--color-text-muted]">{t('webhooks.form.urlHint')}</p>
          <FieldError name="url" errors={fieldErrors} />
        </div>

        <div className="mb-4">
          <Label htmlFor="webhook-description">{t('webhooks.form.description')}</Label>
          <Textarea
            id="webhook-description"
            name="description"
            rows={2}
            defaultValue={props.endpoint?.description}
            {...fieldAria('description', fieldErrors)}
          />
          <p className="mt-1 text-sm text-[--color-text-muted]">{t('webhooks.form.descriptionHint')}</p>
          <FieldError name="description" errors={fieldErrors} />
        </div>

        <fieldset className="mb-4">
          <legend className="font-medium">{t('webhooks.form.events')}</legend>
          <p className="mt-1 text-sm text-[--color-text-muted]">{t('webhooks.form.eventsHint')}</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            {groups.map((group) => (
              <fieldset key={group.prefix} aria-label={group.prefix}>
                <legend className="text-sm font-medium">{group.prefix}</legend>
                {group.types.map((type) => (
                  <label key={type} className="mt-1 flex items-center gap-2">
                    <Checkbox name="event_types" value={type} defaultChecked={selected.has(type)} />
                    <code className="text-sm">{type}</code>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <FieldError name="event_types" errors={fieldErrors} />
        </fieldset>

        <p className="mb-4 rounded-md bg-[--color-surface-muted] p-3 text-sm">{t('webhooks.form.duplicateNote')}</p>

        <SubmitButton
          label={props.mode === 'create' ? t('webhooks.form.submit') : t('webhooks.form.saveSubmit')}
          pendingLabel={props.mode === 'create' ? t('webhooks.form.submitting') : t('shared.saving')}
        />
      </form>
    </section>
  );
}

/** Serverová obálka, aby stránka nemusela znát akce. */
export function WebhookForm(props: Omit<WebhookFormViewProps, 'action' | 'availableEventTypes'> & {
  availableEventTypes?: readonly string[];
}) {
  return (
    <WebhookFormView
      {...props}
      availableEventTypes={props.availableEventTypes ?? []}
      action={props.mode === 'create' ? createWebhookAction : updateWebhookAction}
    />
  );
}
```

- [ ] **Krok 5: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/features/webhooks/webhook-form.test.tsx`
Expected: PASS, `Tests  7 passed (7)`.

- [ ] **Krok 6: Commit**

```bash
git add apps/web/src/features/webhooks
git commit -m "feat(web): webhook endpoint form with one time signing secret"
```

---

### Úkol 31: Detail webhooku, log doručení, test a znovuaktivace

**Soubory:**
- Create: `apps/web/src/features/webhooks/deliveries-table.tsx`
- Create: `apps/web/src/features/webhooks/deliveries-table.test.tsx`
- Create: `apps/web/src/features/webhooks/test-webhook-panel.tsx`
- Create: `apps/web/src/features/webhooks/test-webhook-panel.test.tsx`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/webhooks/[endpointId]/page.tsx`

Testovací událost je třída **A3**: inline průběh v místě akce, tlačítko ve stavu čekání s textem, po 10 sekundách doplněné o „Trvá to déle, než jsme čekali", a **inline výsledek, který zůstává**, dokud ho uživatel nepřepíše. Toast je tu zakázaný, protože 5.4 části 6 výslovně uvádí výsledek kontroly mezi zakázaná použití toastu.

Log doručení má filtr podle stavu, takže potřebuje **S2 prázdný po filtrování** s popisem filtru slovy a s tlačítkem na jeho zrušení (kritérium 21 kapitoly 15.3 části 6).

- [ ] **Krok 1: Napiš padající test tabulky doručení**

`apps/web/src/features/webhooks/deliveries-table.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { Paginated } from '@/lib/api-client/cursor';
import type { Result } from '@/lib/api-client/result';
import { DeliveriesTable, type DeliveryRow } from './deliveries-table';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const messages = { settings: csSettings };

const ROW: DeliveryRow = {
  id: 'd1',
  event_id: 'e1',
  event_type: 'contact.created',
  status: 'failed',
  attempt: 3,
  next_attempt_at: '2026-07-31T13:00:00.000Z',
  response_status: 500,
  response_body_snippet: 'Internal Server Error',
  duration_ms: 812,
  error_code: null,
  delivered_at: null,
  created_at: '2026-07-31T12:00:00.000Z',
};

function page(rows: DeliveryRow[]): Paginated<DeliveryRow> {
  return { data: rows, pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 50 } };
}

function renderTable(
  deliveries: Result<Paginated<DeliveryRow>>,
  filters: Record<string, string> = {},
  cursorDropped = false,
) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <DeliveriesTable
        deliveries={deliveries}
        filters={filters}
        basePath="/w/eshop/settings/webhooks/w1"
        cursorDropped={cursorDropped}
        canWrite
        workspaceId="ws1"
        slug="eshop"
        endpointId="w1"
        retryAction={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe('DeliveriesTable', () => {
  it('vypíše událost, výsledek, pokus a odpověď', () => {
    renderTable({ ok: true, data: page([ROW]) });
    expect(screen.getByText('contact.created')).toBeInTheDocument();
    expect(screen.getByText('Nedoručeno')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
  });

  it('u prázdného seznamu bez filtru ukáže vysvětlení', () => {
    renderTable({ ok: true, data: page([]) });
    // Strukturálně, ne na doslovné znění (kritérium 76c): stav má vysvětlení
    // a aspoň jednu akci, a to hlídá i sama komponenta z P05.
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'first');
    expect(within(empty).getByTestId('empty-explanation').textContent!.length).toBeGreaterThan(20);
    expect(within(empty).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('u prázdného seznamu s filtrem popíše filtr slovy a zrušení filtru vrátí na základní cestu', async () => {
    renderTable({ ok: true, data: page([]) }, { status: 'failed' });
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'filtered');
    // Filtr se zopakuje slovy, ne jménem parametru v URL.
    expect(within(empty).getByText(/Nedoručeno/)).toBeInTheDocument();
    await userEvent.click(within(empty).getByRole('button', { name: 'Zrušit filtry' }));
    expect(push).toHaveBeenCalledWith('/w/eshop/settings/webhooks/w1');
  });

  it('u neplatného kurzoru ukáže hlášku a první stránku, ne prázdno ani chybu', () => {
    renderTable({ ok: true, data: page([ROW]) }, {}, true);
    expect(screen.getByText(/Ukazujeme první stránku stejného filtru/)).toBeInTheDocument();
    expect(screen.getByText('contact.created')).toBeInTheDocument();
  });

  it('nikde nezobrazuje čísla stránek', () => {
    const { container } = renderTable({
      ok: true,
      data: {
        data: [ROW],
        pagination: { next_cursor: 'CUR', prev_cursor: null, has_more: true, limit: 50 },
      },
    });
    expect(screen.getByRole('link', { name: 'Další' })).toHaveAttribute(
      'href',
      '/w/eshop/settings/webhooks/w1?cursor=CUR',
    );
    expect(container.textContent).not.toMatch(/Stránka \d/);
  });

  it('u zablokované adresy vysvětlí, co s tím, bez uvedení rozsahu', () => {
    renderTable({ ok: true, data: page([{ ...ROW, error_code: 'blocked_target', response_status: null }]) });
    expect(screen.getByText(/nezměnil DNS záznam/)).toBeInTheDocument();
    expect(screen.queryByText(/privátní rozsah/)).not.toBeInTheDocument();
  });

  it('u chyby ukáže blok s request_id a s tlačítkem Zkusit znovu', () => {
    renderTable({
      ok: false,
      problem: {
        type: '',
        title: 'Dependency timeout',
        status: 504,
        detail: '',
        instance: '/api/v1/webhook-deliveries',
        code: 'dependency_timeout',
        request_id: 'req_61',
      },
    });
    expect(screen.getByText('req_61')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
  });

  it('u neúspěšného doručení nabídne ruční opakování', () => {
    renderTable({ ok: true, data: page([ROW]) });
    expect(screen.getByRole('button', { name: 'Zkusit doručit znovu' })).toBeInTheDocument();
  });

  it('u úspěšného doručení opakování nenabízí', () => {
    renderTable({ ok: true, data: page([{ ...ROW, status: 'succeeded', response_status: 200 }]) });
    expect(screen.queryByRole('button', { name: 'Zkusit doručit znovu' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/webhooks/deliveries-table.test.tsx`
Expected: FAIL, `Failed to resolve import "./deliveries-table"`.

- [ ] **Krok 3: Napiš tabulku doručení**

`apps/web/src/features/webhooks/deliveries-table.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { EmptyState, FilteredEmptyState } from '@mlain/ui/patterns/states';
import { CheckIcon, ClockIcon, RunningIcon, SlashIcon, WarningIcon } from '@/lib/ui/status-icons';
import { buildListHref, type Paginated } from '@/lib/api-client/cursor';
import type { Result } from '@/lib/api-client/result';
import { SettingsProblem } from '@/features/settings/settings-problem';

export type DeliveryStatus = 'pending' | 'delivering' | 'succeeded' | 'failed' | 'abandoned';

export type DeliveryRow = {
  id: string;
  event_id: string;
  event_type: string;
  status: DeliveryStatus;
  attempt: number;
  next_attempt_at: string | null;
  response_status: number | null;
  response_body_snippet: string | null;
  duration_ms: number | null;
  error_code: string | null;
  delivered_at: string | null;
  created_at: string;
};

const STATUS_KEYS = {
  pending: 'webhooks.deliveries.status.pending',
  delivering: 'webhooks.deliveries.status.delivering',
  succeeded: 'webhooks.deliveries.status.succeeded',
  failed: 'webhooks.deliveries.status.failed',
  abandoned: 'webhooks.deliveries.status.abandoned',
} as const satisfies Record<DeliveryStatus, string>;

// `Badge` zná jen neutral, accent, success, warning a danger. Tón `info` neexistuje.
const STATUS_TONES = {
  pending: 'neutral',
  delivering: 'accent',
  succeeded: 'success',
  failed: 'danger',
  abandoned: 'danger',
} as const;

const DELIVERY_ICONS: Record<DeliveryStatus, React.ReactNode> = {
  pending: ClockIcon,
  delivering: RunningIcon,
  succeeded: CheckIcon,
  failed: WarningIcon,
  abandoned: SlashIcon,
};

const RETRYABLE: DeliveryStatus[] = ['failed', 'abandoned'];

export type DeliveriesTableProps = {
  deliveries: Result<Paginated<DeliveryRow>>;
  filters: Record<string, string>;
  basePath: string;
  cursorDropped: boolean;
  canWrite: boolean;
  workspaceId: string;
  slug: string;
  endpointId: string;
  retryAction: (formData: FormData) => void;
};

export function DeliveriesTable(props: DeliveriesTableProps) {
  const t = useTranslations('settings');
  const format = useFormatter();
  const router = useRouter();

  if (!props.deliveries.ok) {
    return <SettingsProblem problem={props.deliveries.problem} onRetry={() => window.location.reload()} />;
  }

  const { data: rows, pagination } = props.deliveries.data;
  const hasFilters = Object.keys(props.filters).length > 0;

  const filterSummary = Object.entries(props.filters)
    .map(([key, value]) => (key === 'status' ? t(STATUS_KEYS[value as DeliveryStatus]) : value))
    .join(', ');

  return (
    <section aria-labelledby="webhook-deliveries">
      <h2 id="webhook-deliveries" className="text-xl font-semibold">
        {t('webhooks.deliveries.title')}
      </h2>
      <p className="mt-2 text-[--color-text-muted]">{t('webhooks.deliveries.lead')}</p>

      {props.cursorDropped ? (
        <p role="status" className="mt-4 rounded-md bg-[--color-surface-muted] p-3 text-sm">
          {t('shared.cursorDropped')}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="mt-4">
          {hasFilters ? (
            <FilteredEmptyState
              title={t('webhooks.deliveries.emptyFiltered')}
              explanation={t('webhooks.deliveries.emptyFilteredBody')}
              // Filtr se zopakuje slovy, ne jménem parametru v URL (6.5).
              filterDescription={t('shared.filtersApplied', { summary: filterSummary })}
              clearFiltersLabel={t('shared.clearFilters')}
              onClearFilters={() => router.push(props.basePath)}
            />
          ) : (
            <EmptyState
              variant="first"
              title={t('webhooks.deliveries.title')}
              explanation={t('webhooks.deliveries.empty')}
              actions={[
                {
                  label: t('webhooks.deliveries.emptyAction'),
                  onClick: () => router.refresh(),
                },
              ]}
            />
          )}
        </div>
      ) : (
        <>
          <table className="mt-4 w-full text-left">
            <caption className="sr-only">{t('webhooks.deliveries.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('webhooks.deliveries.table.eventType')}</th>
                <th scope="col">{t('webhooks.deliveries.table.status')}</th>
                <th scope="col">{t('webhooks.deliveries.table.attempt')}</th>
                <th scope="col">{t('webhooks.deliveries.table.responseStatus')}</th>
                <th scope="col">{t('webhooks.deliveries.table.createdAt')}</th>
                <th scope="col">{t('members.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[--color-border] align-top">
                  <td className="py-3">
                    <code className="text-sm">{row.event_type}</code>
                  </td>
                  <td className="py-3">
                    <Badge tone={STATUS_TONES[row.status]} icon={DELIVERY_ICONS[row.status]}>
                      {t(STATUS_KEYS[row.status])}
                    </Badge>
                    {row.error_code === 'blocked_target' ? (
                      <p className="mt-1 text-sm text-[--color-danger]">{t('webhooks.deliveries.blockedTarget')}</p>
                    ) : null}
                  </td>
                  <td className="py-3">{row.attempt}</td>
                  <td className="py-3">
                    {row.response_status === null ? '' : row.response_status}
                    {row.response_body_snippet === null ? null : (
                      <details className="mt-1 text-sm">
                        <summary className="cursor-pointer">{t('webhooks.deliveries.responseSnippet')}</summary>
                        <pre className="mt-1 whitespace-pre-wrap break-all">{row.response_body_snippet}</pre>
                      </details>
                    )}
                  </td>
                  <td className="py-3">
                    <time dateTime={row.created_at} title={row.created_at}>
                      {format.dateTime(new Date(row.created_at), 'short')}
                    </time>
                  </td>
                  <td className="py-3">
                    {props.canWrite && RETRYABLE.includes(row.status) ? (
                      <form action={props.retryAction}>
                        <input type="hidden" name="workspace_id" value={props.workspaceId} readOnly />
                        <input type="hidden" name="slug" value={props.slug} readOnly />
                        <input type="hidden" name="endpoint_id" value={props.endpointId} readOnly />
                        <input type="hidden" name="delivery_id" value={row.id} readOnly />
                        <Button type="submit" variant="secondary">
                          {t('webhooks.deliveries.retry')}
                        </Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <nav aria-label={t('webhooks.deliveries.title')} className="mt-4 flex gap-4">
            {pagination.prev_cursor ? (
              <Link href={buildListHref(props.basePath, props.filters, pagination.prev_cursor)} className="underline">
                {t('shared.previousPage')}
              </Link>
            ) : null}
            {pagination.next_cursor ? (
              <Link href={buildListHref(props.basePath, props.filters, pagination.next_cursor)} className="underline">
                {t('shared.nextPage')}
              </Link>
            ) : null}
          </nav>
        </>
      )}
    </section>
  );
}
```

- [ ] **Krok 4: Napiš padající test testovací události**

`apps/web/src/features/webhooks/test-webhook-panel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { ActionState } from '@/lib/feedback/action-result';
import { TestWebhookPanelView } from './test-webhook-panel';

const messages = { settings: csSettings };

function renderPanel(initialState?: ActionState) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <TestWebhookPanelView
        workspaceId="ws1"
        slug="eshop"
        endpointId="w1"
        action={vi.fn()}
        initialState={initialState}
      />
    </NextIntlClientProvider>,
  );
}

describe('TestWebhookPanelView', () => {
  it('nabídne poslání testovací události', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Poslat testovací událost' })).toBeInTheDocument();
  });

  it('výsledek ukáže inline v místě akce, ne toastem', () => {
    renderPanel({
      status: 'success',
      channel: 'inlineBlock',
      messageKey: 'webhooks.test.successTitle',
      values: { status: 200, duration: '812 ms' },
    });
    expect(screen.getByText('Testovací událost dorazila')).toBeInTheDocument();
    expect(screen.getByText(/200/)).toBeInTheDocument();
    expect(screen.getByText(/812 ms/)).toBeInTheDocument();
  });

  it('výsledek zůstává, dokud ho uživatel nepřepíše', () => {
    renderPanel({
      status: 'success',
      channel: 'inlineBlock',
      messageKey: 'webhooks.test.successTitle',
      values: { status: 200, duration: '812 ms' },
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('u chyby ukáže blok s request_id', () => {
    renderPanel({
      status: 'error',
      channel: 'inlineBlock',
      problem: {
        type: '',
        title: 'Service unavailable',
        status: 503,
        detail: '',
        instance: '/api/v1/webhook-endpoints/w1/test',
        code: 'service_unavailable',
        request_id: 'req_71',
      },
      fieldErrors: {},
    });
    expect(screen.getByText('req_71')).toBeInTheDocument();
  });

  it('tlačítko nemá disabled ani během odesílání', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Poslat testovací událost' })).not.toHaveAttribute('disabled');
  });
});
```

- [ ] **Krok 5: Napiš panel testu a stránku detailu**

`apps/web/src/features/webhooks/test-webhook-panel.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { SubmitButton } from '@/lib/forms/submit-button';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { testWebhookAction } from './actions';

export type TestWebhookPanelViewProps = {
  workspaceId: string;
  slug: string;
  endpointId: string;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  initialState?: ActionState;
};

/**
 * Třída A3 podle 5.1 části 6: inline průběh v místě akce a inline výsledek,
 * který zůstává. Toast je pro výsledek kontroly v 5.4 části 6 zakázaný.
 */
export function TestWebhookPanelView(props: TestWebhookPanelViewProps) {
  const t = useTranslations('settings');
  const [state, formAction] = useActionState(props.action, props.initialState ?? IDLE);

  return (
    <section aria-labelledby="webhook-test">
      <h2 id="webhook-test" className="text-xl font-semibold">
        {t('webhooks.test.button')}
      </h2>

      <form action={formAction} className="mt-4">
        <input type="hidden" name="workspace_id" value={props.workspaceId} readOnly />
        <input type="hidden" name="slug" value={props.slug} readOnly />
        <input type="hidden" name="endpoint_id" value={props.endpointId} readOnly />
        <SubmitButton label={t('webhooks.test.button')} pendingLabel={t('webhooks.test.running')} />
      </form>

      {state.status === 'success' ? (
        <div role="status" className="mt-4 rounded-md border border-[--color-success] p-4">
          <p className="font-medium">{t('webhooks.test.successTitle')}</p>
          <p className="mt-1 text-sm text-[--color-text-muted]">
            {t('webhooks.test.successBody', {
              status: String(state.values?.status ?? ''),
              duration: String(state.values?.duration ?? ''),
            })}
          </p>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="mt-4">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}
    </section>
  );
}

/** Serverová obálka, aby stránka nemusela znát akci. */
export function TestWebhookPanel(props: Omit<TestWebhookPanelViewProps, 'action'>) {
  return <TestWebhookPanelView {...props} action={testWebhookAction} />;
}
```

`apps/web/src/app/[locale]/w/[workspaceSlug]/settings/webhooks/[endpointId]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { enableWebhookAction, retryDeliveryAction } from '@/features/webhooks/actions';
import { DeliveriesTable, type DeliveryRow } from '@/features/webhooks/deliveries-table';
import { DisabledBanner } from '@/features/webhooks/disabled-banner';
import { TestWebhookPanel } from '@/features/webhooks/test-webhook-panel';
import { WebhookForm } from '@/features/webhooks/webhook-form';
import type { WebhookRow } from '@/features/webhooks/webhooks-table';
import { SettingsPageShell } from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { apiFetch } from '@/lib/api-client/fetch';
import { fetchListWithCursorFallback, readCursor, readFilters, type Paginated } from '@/lib/api-client/cursor';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('webhooks.title') };
}

const DELIVERY_FILTERS = ['status', 'event_type'] as const;

export default async function WebhookDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; endpointId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug, endpointId } = await params;
  const query = await searchParams;
  const t = await getTranslations('settings');

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  if (!hasPermission(access.data, 'webhooks:read')) {
    return <ForbiddenSection permission="webhooks:read" currentRole={access.data.role} workspaceSlug={workspaceSlug} />;
  }

  const canWrite = hasPermission(access.data, 'webhooks:write');
  const workspaceId = access.data.workspace.id;
  const filters = readFilters(query, DELIVERY_FILTERS);
  const cursor = readCursor(query);
  const basePath = `/w/${workspaceSlug}/settings/webhooks/${endpointId}`;

  const [endpoint, deliveries] = await Promise.all([
    apiFetch<WebhookRow>(`/api/v1/webhook-endpoints/${endpointId}`, { workspaceId }),
    fetchListWithCursorFallback<DeliveryRow>(
      (nextCursor) =>
        apiFetch<Paginated<DeliveryRow>>('/api/v1/webhook-deliveries', {
          workspaceId,
          searchParams: { endpoint_id: endpointId, ...filters, cursor: nextCursor, limit: 50 },
        }),
      cursor,
    ),
  ]);

  if (!endpoint.ok) {
    if (endpoint.problem.status === 404) notFound();
    return <SettingsProblem problem={endpoint.problem} />;
  }

  return (
    <SettingsPageShell title={endpoint.data.url} lead={endpoint.data.description}>
      <div className="space-y-12">
        {endpoint.data.status === 'disabled' && canWrite ? (
          <form action={enableWebhookAction as never}>
            <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
            <input type="hidden" name="slug" value={workspaceSlug} readOnly />
            <input type="hidden" name="endpoint_id" value={endpointId} readOnly />
            <DisabledBanner
              url={endpoint.data.url}
              lastStatus={null}
              since={endpoint.data.disabled_at}
              withDetail
              endpointHref={basePath}
              onEnable={() => undefined}
            />
          </form>
        ) : null}

        {canWrite ? (
          <TestWebhookPanel workspaceId={workspaceId} slug={workspaceSlug} endpointId={endpointId} />
        ) : null}

        <DeliveriesTable
          deliveries={deliveries.result}
          filters={filters}
          basePath={basePath}
          cursorDropped={deliveries.cursorDropped}
          canWrite={canWrite}
          workspaceId={workspaceId}
          slug={workspaceSlug}
          endpointId={endpointId}
          retryAction={retryDeliveryAction as never}
        />

        {canWrite ? (
          <WebhookForm
            mode="edit"
            workspaceId={workspaceId}
            slug={workspaceSlug}
            endpoint={endpoint.data}
            availableEventTypes={endpoint.data.event_types}
          />
        ) : null}
      </div>
    </SettingsPageShell>
  );
}
```

- [ ] **Krok 6: Spusť všechny testy webhooků**

Run: `pnpm --filter @mlain/web exec vitest run src/features/webhooks/`
Expected: PASS, `Tests  35 passed (35)`.

- [ ] **Krok 7: Commit**

```bash
git add apps/web/src/features/webhooks "apps/web/src/app/[locale]/w"
git commit -m "feat(web): webhook detail with delivery log, test event and re-enable"
```

---

### Úkol 32: Audit log s filtry

**Soubory:**
- Create: `apps/web/src/features/audit/audit-actions.ts`
- Create: `apps/web/src/features/audit/audit-actions.test.ts`
- Create: `apps/web/src/features/audit/audit-filters.tsx`
- Create: `apps/web/src/features/audit/audit-table.tsx`
- Create: `apps/web/src/features/audit/audit-table.test.tsx`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/audit/page.tsx`

Podle rozhodnutí **R3** je audit log datová tabulka s filtry, ne časová osa. Filtry jsou z 3.7 části 1: `action`, `actor_id`, `target_id`, `from`, `to`.

**Názvy akcí:** katalog `settings.audit.actions` obsahuje jen akce vlastněné částí 1. Akce ostatních domén (`contacts.imported`, `campaign.sent`) se zobrazí jako kód v `<code>` plus obecná věta. Doplnění hezkých názvů pro cizí domény je změna v `settings.json`, tedy práce pro P06 na výslovný pokyn, ne pro cizí plán, který by do katalogu jinak musel zapisovat.

Prázdný stav používá doslovný text z 5.3 části 1: „Zatím se nic nestalo."

- [ ] **Krok 1: Napiš padající test mapy akcí**

`apps/web/src/features/audit/audit-actions.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION_KEYS, auditActionKey, isKnownAuditAction } from './audit-actions';

const MESSAGES_DIR = path.resolve(import.meta.dirname, '../../../../../packages/i18n/messages');

function catalog(locale: 'cs' | 'en'): Record<string, string> {
  const parsed = JSON.parse(readFileSync(path.join(MESSAGES_DIR, locale, 'settings.json'), 'utf8'));
  return parsed.audit.actions as Record<string, string>;
}

describe('mapa auditních akcí', () => {
  it('pokrývá všech dvacet šest akcí části 1 z tabulky 3.7', () => {
    expect(Object.keys(AUDIT_ACTION_KEYS)).toHaveLength(26);
  });

  it('každá akce má text v obou jazycích', () => {
    const cs = catalog('cs');
    const en = catalog('en');
    for (const action of Object.keys(AUDIT_ACTION_KEYS)) {
      expect(cs, `cs postrádá ${action}`).toHaveProperty(action);
      expect(en, `en postrádá ${action}`).toHaveProperty(action);
    }
  });

  it('u známé akce vrátí klíč, u cizí undefined', () => {
    expect(auditActionKey('api_key.created')).toBe('audit.actions.api_key.created');
    expect(auditActionKey('contacts.imported')).toBeUndefined();
    expect(isKnownAuditAction('member.invited')).toBe(true);
    expect(isKnownAuditAction('campaign.sent')).toBe(false);
  });

  it('názvy akcí odpovídají konvenci entita.sloveso v minulém čase', () => {
    for (const action of Object.keys(AUDIT_ACTION_KEYS)) {
      expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });
});
```

- [ ] **Krok 2: Napiš mapu akcí**

`apps/web/src/features/audit/audit-actions.ts`:

```ts
/**
 * Akce vlastněné částí 1 podle tabulky v její 3.7. Mapa je explicitní, aby se
 * překladový klíč neskládal za běhu (kritérium 71 části 6). Akce ostatních
 * domén se zobrazují jako kód, protože jejich texty by musely do `settings.json`,
 * který vlastní P06, a dva zapisovatelé do jednoho katalogu jsou konflikt.
 */
export const AUDIT_ACTION_KEYS = {
  'user.login': 'audit.actions.user.login',
  'user.login_failed': 'audit.actions.user.login_failed',
  'user.logout': 'audit.actions.user.logout',
  'user.password_changed': 'audit.actions.user.password_changed',
  'user.password_reset_requested': 'audit.actions.user.password_reset_requested',
  'user.password_reset_completed': 'audit.actions.user.password_reset_completed',
  'workspace.created': 'audit.actions.workspace.created',
  'workspace.updated': 'audit.actions.workspace.updated',
  'workspace.deleted': 'audit.actions.workspace.deleted',
  'workspace.restored': 'audit.actions.workspace.restored',
  'workspace.ownership_transferred': 'audit.actions.workspace.ownership_transferred',
  'member.invited': 'audit.actions.member.invited',
  'member.invitation_revoked': 'audit.actions.member.invitation_revoked',
  'member.joined': 'audit.actions.member.joined',
  'member.role_changed': 'audit.actions.member.role_changed',
  'member.removed': 'audit.actions.member.removed',
  'api_key.created': 'audit.actions.api_key.created',
  'api_key.rotated': 'audit.actions.api_key.rotated',
  'api_key.revoked': 'audit.actions.api_key.revoked',
  'webhook_endpoint.created': 'audit.actions.webhook_endpoint.created',
  'webhook_endpoint.updated': 'audit.actions.webhook_endpoint.updated',
  'webhook_endpoint.deleted': 'audit.actions.webhook_endpoint.deleted',
  'webhook_endpoint.disabled': 'audit.actions.webhook_endpoint.disabled',
  'backup.created': 'audit.actions.backup.created',
  'backup.restored': 'audit.actions.backup.restored',
  'settings.updated': 'audit.actions.settings.updated',
} as const;

export type KnownAuditAction = keyof typeof AUDIT_ACTION_KEYS;

export function isKnownAuditAction(action: string): action is KnownAuditAction {
  return Object.hasOwn(AUDIT_ACTION_KEYS, action);
}

export function auditActionKey(action: string): string | undefined {
  return isKnownAuditAction(action) ? AUDIT_ACTION_KEYS[action] : undefined;
}
```

- [ ] **Krok 3: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/features/audit/audit-actions.test.ts`
Expected: PASS, `Tests  4 passed (4)`.

- [ ] **Krok 4: Napiš padající test tabulky auditu**

`apps/web/src/features/audit/audit-table.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { Paginated } from '@/lib/api-client/cursor';
import type { Result } from '@/lib/api-client/result';
import { AuditTable, type AuditRow } from './audit-table';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const messages = { settings: csSettings };

const ROW: AuditRow = {
  id: 'a1',
  actor_type: 'user',
  actor_id: 'u1',
  actor_label: 'jana@firma.cz',
  action: 'api_key.created',
  target_type: 'api_key',
  target_id: 'k1',
  request_id: 'req_81',
  metadata: {},
  created_at: '2026-07-31T12:32:07.000Z',
};

function page(rows: AuditRow[]): Paginated<AuditRow> {
  return { data: rows, pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 50 } };
}

function renderTable(entries: Result<Paginated<AuditRow>>, filters: Record<string, string> = {}) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <AuditTable entries={entries} filters={filters} basePath="/w/eshop/settings/audit" cursorDropped={false} />
    </NextIntlClientProvider>,
  );
}

describe('AuditTable', () => {
  it('vypíše čas, aktéra, akci a číslo požadavku', () => {
    renderTable({ ok: true, data: page([ROW]) });
    expect(screen.getByText('jana@firma.cz')).toBeInTheDocument();
    expect(screen.getByText('Vytvořil klíč k API')).toBeInTheDocument();
    expect(screen.getByText('req_81')).toBeInTheDocument();
  });

  it('u cizí akce ukáže kód, ne prázdno', () => {
    renderTable({ ok: true, data: page([{ ...ROW, action: 'contacts.imported' }]) });
    expect(screen.getByText('contacts.imported')).toBeInTheDocument();
  });

  it('typ aktéra pojmenuje slovem', () => {
    renderTable({ ok: true, data: page([{ ...ROW, actor_type: 'api_key', actor_label: 'E-shop' }]) });
    expect(screen.getByText('Klíč k API')).toBeInTheDocument();
  });

  it('u prázdného seznamu použije doslovný text ze specifikace', () => {
    renderTable({ ok: true, data: page([]) });
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'first');
    expect(within(empty).getByTestId('empty-explanation').textContent!.length).toBeGreaterThan(20);
    expect(within(empty).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('u prázdného seznamu s filtrem ukáže variantu filtered a zrušení filtru vrátí na základní cestu', async () => {
    renderTable({ ok: true, data: page([]) }, { action: 'api_key.created' });
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'filtered');
    await userEvent.click(within(empty).getByRole('button', { name: 'Zrušit filtry' }));
    expect(push).toHaveBeenCalledWith('/w/eshop/settings/audit');
  });

  it('u chyby ukáže blok s request_id a s tlačítkem Zkusit znovu', () => {
    renderTable({
      ok: false,
      problem: {
        type: '',
        title: 'Forbidden',
        status: 403,
        detail: '',
        instance: '/api/v1/audit-log',
        code: 'forbidden',
        request_id: 'req_82',
      },
    });
    expect(screen.getByText('req_82')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
  });

  it('připomene, jak dlouho se záznamy drží', () => {
    renderTable({ ok: true, data: page([ROW]) });
    expect(screen.getByText('Záznamy držíme 24 měsíců.')).toBeInTheDocument();
  });

  it('nikde nezobrazuje čísla stránek', () => {
    const { container } = renderTable({
      ok: true,
      data: { data: [ROW], pagination: { next_cursor: 'CUR', prev_cursor: null, has_more: true, limit: 50 } },
    });
    expect(container.textContent).not.toMatch(/Stránka \d/);
    expect(screen.getByRole('link', { name: 'Další' })).toHaveAttribute('href', '/w/eshop/settings/audit?cursor=CUR');
  });
});
```

- [ ] **Krok 5: Napiš tabulku a filtry auditu**

`apps/web/src/features/audit/audit-table.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { EmptyState, FilteredEmptyState, StaleBanner, StaleContent } from '@mlain/ui/patterns/states';
import { buildListHref, type Paginated } from '@/lib/api-client/cursor';
import type { Result } from '@/lib/api-client/result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { auditActionKey } from './audit-actions';

export type AuditRow = {
  id: string;
  actor_type: 'user' | 'api_key' | 'system';
  actor_id: string | null;
  actor_label: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  request_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

const ACTOR_TYPE_KEYS = {
  user: 'audit.actorType.user',
  api_key: 'audit.actorType.apiKey',
  system: 'audit.actorType.system',
} as const satisfies Record<AuditRow['actor_type'], string>;

export type AuditTableProps = {
  entries: Result<Paginated<AuditRow>>;
  filters: Record<string, string>;
  basePath: string;
  cursorDropped: boolean;
  /**
   * Stav S7. Obnova na pozadí selhala, takže se ukazují starší záznamy.
   * ISO čas posledního úspěšného načtení; `null` znamená, že data jsou čerstvá.
   */
  staleSince?: string | null;
};

/** Ztlumí obsah jen tehdy, když je zastaralý. Jinak ho nechá být. */
function StaleContentWhenStale({ stale, children }: { stale: boolean; children: React.ReactNode }) {
  return stale ? <StaleContent>{children}</StaleContent> : <>{children}</>;
}

export function AuditTable(props: AuditTableProps) {
  const t = useTranslations('settings');
  const format = useFormatter();
  const router = useRouter();

  if (!props.entries.ok) {
    return <SettingsProblem problem={props.entries.problem} onRetry={() => window.location.reload()} />;
  }

  const { data: rows, pagination } = props.entries.data;
  const hasFilters = Object.keys(props.filters).length > 0;

  if (rows.length === 0) {
    return hasFilters ? (
      <FilteredEmptyState
        title={t('audit.emptyFiltered')}
        explanation={t('audit.emptyFilteredBody')}
        filterDescription={t('shared.filtersApplied', { summary: Object.values(props.filters).join(', ') })}
        clearFiltersLabel={t('shared.clearFilters')}
        onClearFilters={() => router.push(props.basePath)}
      />
    ) : (
      <EmptyState
        variant="first"
        title={t('audit.title')}
        explanation={t('audit.empty')}
        actions={[{ label: t('audit.emptyAction'), onClick: () => router.refresh() }]}
      />
    );
  }

  return (
    <>
      {props.cursorDropped ? (
        <p role="status" className="mb-4 rounded-md bg-[--color-surface-muted] p-3 text-sm">
          {t('shared.cursorDropped')}
        </p>
      ) : null}

      {/*
        Stav S7: zastaralá data se **nezahazují ani neschovávají**. Zůstanou
        čitelná a použitelná, jen ztlumená, a nad nimi je vidět, jak jsou stará
        a jak zkusit obnovu znovu. Zobrazit čerstvě vypadající staré číslo je
        horší než přiznat stáří.
      */}
      {props.staleSince !== undefined && props.staleSince !== null ? (
        <div className="mb-4">
          <StaleBanner
            lastUpdatedLabel={t('states.staleTitle', {
              time: format.dateTime(new Date(props.staleSince), 'short'),
            })}
            retryAction={
              <Button type="button" variant="secondary" onClick={() => router.refresh()}>
                {t('shared.tryAgain')}
              </Button>
            }
          />
        </div>
      ) : null}

      <StaleContentWhenStale stale={props.staleSince !== undefined && props.staleSince !== null}>
      <table className="w-full text-left">
        <caption className="sr-only">{t('audit.title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('audit.table.when')}</th>
            <th scope="col">{t('audit.table.actor')}</th>
            <th scope="col">{t('audit.table.action')}</th>
            <th scope="col">{t('audit.table.target')}</th>
            <th scope="col">{t('audit.table.requestId')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const actionKey = auditActionKey(row.action);
            return (
              <tr key={row.id} className="border-t border-[--color-border] align-top">
                <td className="py-3">
                  <time dateTime={row.created_at} title={row.created_at}>
                    {format.dateTime(new Date(row.created_at), 'short')}
                  </time>
                </td>
                <td className="py-3">
                  <p>{row.actor_label}</p>
                  <p className="text-sm text-[--color-text-muted]">{t(ACTOR_TYPE_KEYS[row.actor_type])}</p>
                </td>
                <td className="py-3">
                  {actionKey ? t(actionKey as 'audit.actions.user.login') : <code className="text-sm">{row.action}</code>}
                </td>
                <td className="py-3 text-sm">
                  {row.target_type === null ? '' : <code>{row.target_type}</code>}{' '}
                  {row.target_id === null ? '' : <code>{row.target_id}</code>}
                </td>
                <td className="py-3">
                  {row.request_id === null ? '' : <code className="text-sm">{row.request_id}</code>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      </StaleContentWhenStale>

      <p className="mt-4 text-sm text-[--color-text-muted]">{t('audit.retention')}</p>

      <nav aria-label={t('audit.title')} className="mt-4 flex gap-4">
        {pagination.prev_cursor ? (
          <Link href={buildListHref(props.basePath, props.filters, pagination.prev_cursor)} className="underline">
            {t('shared.previousPage')}
          </Link>
        ) : null}
        {pagination.next_cursor ? (
          <Link href={buildListHref(props.basePath, props.filters, pagination.next_cursor)} className="underline">
            {t('shared.nextPage')}
          </Link>
        ) : null}
      </nav>
    </>
  );
}
```

`apps/web/src/features/audit/audit-filters.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { SelectField } from '@/lib/forms/select-field';
import { AUDIT_ACTION_KEYS } from './audit-actions';

export type AuditFiltersProps = {
  basePath: string;
  filters: Record<string, string>;
};

/**
 * Filtry jsou v query parametrech, ne ve stavu komponenty, aby šel odkaz na
 * filtrovaný výsledek poslat kolegovi (pravidlo z 4.3 části 6).
 */
export function AuditFilters({ basePath, filters }: AuditFiltersProps) {
  const t = useTranslations('settings');

  return (
    <form method="get" action={basePath} className="flex flex-wrap items-end gap-3">
      <div>
        <SelectField
          name="action"
          label={t('audit.filters.action')}
          placeholder={t('audit.filters.allActions')}
          defaultValue={filters.action ?? ''}
          options={Object.entries(AUDIT_ACTION_KEYS).map(([action, key]) => ({
            value: action,
            label: t(key as 'audit.actions.user.login'),
          }))}
        />
      </div>

      <div>
        <Label htmlFor="audit-from">{t('audit.filters.from')}</Label>
        <Input id="audit-from" name="from" type="date" defaultValue={filters.from ?? ''} />
      </div>

      <div>
        <Label htmlFor="audit-to">{t('audit.filters.to')}</Label>
        <Input id="audit-to" name="to" type="date" defaultValue={filters.to ?? ''} />
      </div>

      <Button type="submit" variant="secondary">
        {t('audit.filters.apply')}
      </Button>
    </form>
  );
}
```

- [ ] **Krok 6: Napiš stránku auditu**

`apps/web/src/app/[locale]/w/[workspaceSlug]/settings/audit/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AuditFilters } from '@/features/audit/audit-filters';
import { AuditTable, type AuditRow } from '@/features/audit/audit-table';
import { SettingsPageShell } from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { apiFetch } from '@/lib/api-client/fetch';
import { fetchListWithCursorFallback, readCursor, readFilters, type Paginated } from '@/lib/api-client/cursor';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('audit.title') };
}

/** Filtry podle 3.7 části 1. */
const AUDIT_FILTERS = ['action', 'actor_id', 'target_id', 'from', 'to'] as const;

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const t = await getTranslations('settings');

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  if (!hasPermission(access.data, 'audit:read')) {
    return <ForbiddenSection permission="audit:read" currentRole={access.data.role} workspaceSlug={workspaceSlug} />;
  }

  const workspaceId = access.data.workspace.id;
  const filters = readFilters(query, AUDIT_FILTERS);
  const cursor = readCursor(query);
  const basePath = `/w/${workspaceSlug}/settings/audit`;

  const entries = await fetchListWithCursorFallback<AuditRow>(
    (nextCursor) =>
      apiFetch<Paginated<AuditRow>>('/api/v1/audit-log', {
        workspaceId,
        searchParams: { ...filters, cursor: nextCursor, limit: 50 },
      }),
    cursor,
  );

  return (
    <SettingsPageShell title={t('audit.title')} lead={t('audit.lead')}>
      <div className="space-y-8">
        <AuditFilters basePath={basePath} filters={filters} />
        <AuditTable
          entries={entries.result}
          filters={filters}
          basePath={basePath}
          cursorDropped={entries.cursorDropped}
        />
      </div>
    </SettingsPageShell>
  );
}
```

- [ ] **Krok 7: Spusť testy auditu a ověř, že procházejí**

Run: `pnpm --filter @mlain/web exec vitest run src/features/audit/`
Expected: PASS, `Tests  12 passed (12)`.

- [ ] **Krok 8: Commit**

```bash
git add apps/web/src/features/audit "apps/web/src/app/[locale]/w"
git commit -m "feat(web): audit log table with filters and cursor pagination"
```

---

### Úkol 33: Segmentové stavy, načítání, chyba, nenalezeno a offline

**Soubory:**
- Create: `apps/web/src/app/[locale]/(auth)/loading.tsx`
- Create: `apps/web/src/app/[locale]/(account)/loading.tsx`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/loading.tsx`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/error.tsx`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/not-found.tsx`
- Create: `apps/web/src/features/settings/settings-skeleton.tsx`
- Create: `apps/web/src/features/settings/offline-watcher.tsx`
- Create: `apps/web/src/features/settings/offline-watcher.test.tsx`

Tenhle úkol uzavírá stavy, které nepatří jedné obrazovce, ale celému segmentu: **S4 načítání** jako skeleton ve tvaru budoucího obsahu, **S9 chyba**, **S13 nenalezeno** a **S10 offline**.

Skeleton se nezobrazí u operace kratší než 300 ms a jakmile se zobrazí, zůstane aspoň 400 ms (kritérium 80 kapitoly 15.6 části 6). Logiku vlastní P05, tady se jen použije.

- [ ] **Krok 1: Napiš skeleton nastavení**

`apps/web/src/features/settings/settings-skeleton.tsx`:

```tsx
import { useTranslations } from 'next-intl';
import { DetailSkeleton, TableSkeleton } from '@mlain/ui/patterns/states';
import { DeferredSkeleton } from '@/lib/forms/deferred-skeleton';

/**
 * Skeleton má tvar budoucího obsahu, ne spinner (stav S4 v 7.1 části 6).
 * Obrys hlavičky kreslí `DetailSkeleton`, obrys tabulky `TableSkeleton`,
 * obojí z `@mlain/ui/patterns/states`. Vlastní obdélníky z primitiva by
 * znamenaly třetí podobu téhož tvaru vedle dvou, které už existují.
 */
export function SettingsSkeleton() {
  const t = useTranslations('settings');

  return (
    <DeferredSkeleton>
      <div aria-live="polite">
        <DetailSkeleton />
        <div className="mt-8">
          <TableSkeleton rows={4} columns={4} label={t('states.loadingLabel')} />
        </div>
      </div>
    </DeferredSkeleton>
  );
}
```

- [ ] **Krok 2: Napiš tři soubory `loading.tsx`**

`apps/web/src/app/[locale]/w/[workspaceSlug]/settings/loading.tsx`:

```tsx
import { SettingsSkeleton } from '@/features/settings/settings-skeleton';

export default function SettingsLoading() {
  return <SettingsSkeleton />;
}
```

`apps/web/src/app/[locale]/(account)/loading.tsx`:

```tsx
import { SettingsSkeleton } from '@/features/settings/settings-skeleton';

export default function AccountLoading() {
  return <SettingsSkeleton />;
}
```

`apps/web/src/app/[locale]/(auth)/loading.tsx`:

```tsx
import { Skeleton } from '@mlain/ui/components/skeleton';
import { DeferredSkeleton } from '@/lib/forms/deferred-skeleton';

export default function AuthLoading() {
  return (
    <DeferredSkeleton>
      <div aria-busy="true" className="rounded-xl border border-[--color-border] bg-[--color-surface] p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-3 h-4 w-full" />
        <div className="mt-8 space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-40" />
        </div>
      </div>
    </DeferredSkeleton>
  );
}
```

- [ ] **Krok 3: Napiš hranici chyby a stav nenalezeno**

`apps/web/src/app/[locale]/w/[workspaceSlug]/settings/error.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';

/**
 * Poslední záchrana pro chybu, kterou obrazovka nezachytila sama. Next.js
 * v produkci text výjimky zahazuje a nechává jen `digest`, takže se ukazuje
 * právě on: je to jediný identifikátor, který jde dohledat v logu.
 * Očekávané chyby se sem nedostávají, ty vykresluje `SettingsProblem`
 * s plnohodnotným `request_id`.
 */
export default function SettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('settings');

  return (
    <section role="alert" data-error-code="internal_error" className="rounded-lg border border-[--color-border] p-6">
      <h1 className="text-xl font-semibold">{t('errors.internalError.title')}</h1>
      <p className="mt-2 text-[--color-text-muted]">{t('errors.internalError.body')}</p>
      <div className="mt-4">
        <Button type="button" variant="secondary" onClick={reset}>
          {t('shared.tryAgain')}
        </Button>
      </div>
      {error.digest ? (
        <details className="mt-3 text-xs text-[--color-text-muted]">
          <summary className="cursor-pointer">{t('errorBlock.detailsSummary')}</summary>
          <p className="mt-2">
            {t('errorBlock.requestId')}: <code>{error.digest}</code>
          </p>
        </details>
      ) : null}
    </section>
  );
}
```

`apps/web/src/app/[locale]/w/[workspaceSlug]/settings/not-found.tsx`:

```tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/** Stav S13 z 7.1 části 6: co se mohlo stát a cesta zpátky. */
export default async function SettingsNotFound() {
  const t = await getTranslations('settings');

  return (
    <section className="rounded-lg border border-[--color-border] p-6">
      <h1 className="text-xl font-semibold">{t('states.notFoundTitle')}</h1>
      <p className="mt-2 text-[--color-text-muted]">{t('states.notFoundBody')}</p>
      <p className="mt-4">
        <Link href="/" className="underline">
          {t('states.notFoundBack')}
        </Link>
      </p>
    </section>
  );
}
```

- [ ] **Krok 4: Napiš padající test hlídače offline**

`apps/web/src/features/settings/offline-watcher.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { OfflineWatcher } from './offline-watcher';

const messages = { settings: csSettings };

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

afterEach(() => setOnline(true));

function renderWatcher() {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <OfflineWatcher />
    </NextIntlClientProvider>,
  );
}

describe('OfflineWatcher', () => {
  it('při připojení nic nevykreslí', () => {
    renderWatcher();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('po ztrátě spojení ukáže pruh se zněním z katalogu, ne s natvrdo zapsanou větou', () => {
    renderWatcher();
    act(() => setOnline(false));
    // Kritérium 76c zakazuje kontrolovat doslovné znění. Test proto čte
    // tentýž klíč, jaký čte komponenta: přeformulování textu ho neshodí,
    // ale prázdný nebo chybějící překlad ano.
    expect(screen.getByRole('status')).toHaveTextContent(csSettings.states.offlineBody);
    expect(csSettings.states.offlineBody.length).toBeGreaterThan(20);
  });

  it('pruh je oznámený čtečce obrazovky', () => {
    renderWatcher();
    act(() => setOnline(false));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('po obnovení spojení pruh zmizí', () => {
    renderWatcher();
    act(() => setOnline(false));
    act(() => setOnline(true));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
```

- [ ] **Krok 5: Napiš hlídače offline**

`apps/web/src/features/settings/offline-watcher.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Stav S10 z 7.1 části 6. Systémový pruh vlastní P05, ale ten zobrazuje
 * celoaplikační stavy podle priority z 7.4. Tady jde o lokální pojistku pro
 * obrazovky nastavení, aby uživatel poznal, proč se ukládání nedaří, i když
 * skořápka pruh z nějakého důvodu nevykreslí.
 */
export function OfflineWatcher() {
  const t = useTranslations('settings');
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    setOffline(!navigator.onLine);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <p role="status" className="rounded-md border border-[--color-warning] bg-[--color-surface-muted] p-3 text-sm">
      {t('states.offlineBody')}
    </p>
  );
}
```

- [ ] **Krok 6: Zapoj hlídače do skořápky nastavení**

V `apps/web/src/features/settings/settings-page-shell.tsx` doplň import

```tsx
import { OfflineWatcher } from './offline-watcher';
```

a hned pod blok `readOnly` vlož

```tsx
      <div className="mt-4">
        <OfflineWatcher />
      </div>
```

- [ ] **Krok 7: Spusť testy a ověř, že procházejí**

Run: `pnpm --filter @mlain/web exec vitest run src/features/settings/`
Expected: PASS, `Tests  16 passed (16)`.

- [ ] **Krok 8: Commit**

```bash
git add apps/web/src/features/settings "apps/web/src/app/[locale]"
git commit -m "feat(web): segment level loading, error, not found and offline states"
```

---

### Úkol 34: Stránka detailu úlohy

**Soubory:**
- Create: `apps/web/src/features/jobs/job-detail.tsx`
- Create: `apps/web/src/features/jobs/job-detail.test.tsx`
- Create: `apps/web/src/app/[locale]/w/[workspaceSlug]/jobs/[kind]/[jobId]/page.tsx`

Stránka detailu úlohy je jediná obrazovka P06, která nepatří do nastavení ani do
profilu. **Nemá to být překvapení, je to rozhodnutí z evidence** (nález N30):
P05 dodal prezentační vrstvu Centra úloh, P04 dodal endpointy a registr zdrojů,
ale **P04 obrazovky nepíše žádné** a má to ve svém výčtu vyloučení. Odkaz z
Centra úloh by tedy vedl na cestu, kterou nikdo nenaplní.

**Cesta nese druh úlohy.** Endpoint je `GET /api/v1/jobs/{kind}/{id}` a `kind`
v něm stojí schválně: ID pocházejí z různých doménových tabulek (`imports` u P11,
`campaign_audience_progress` u P13) a napříč nimi nejsou zaručeně jedinečná.
Stránka proto bydlí na `/w/{slug}/jobs/{kind}/{jobId}`, ne na `/w/{slug}/jobs/{jobId}`,
jak psalo dřívější znění P05 a P04. Odkaz staví ten, kdo zná `kind`, a ten je
v odpovědi endpointu.

**P06 žádný vlastní zdroj úloh neregistruje.** Přepočet 5. pádu po přepnutí
oslovení běží na pozadí, ale je to úloha nad kontakty a tabulku postupu k ní
vlastní P07. P06 ji jen spouští přes `PATCH /api/v1/workspaces/{id}`. Registrace
zdroje by znamenala číst cizí tabulku, což uzávěr vlastnictví zakazuje.

- [ ] **Krok 1: Napiš padající test detailu**

`apps/web/src/features/jobs/job-detail.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { Result } from '@/lib/api-client/result';
import { JobDetail, type JobRow } from './job-detail';

const messages = { settings: csSettings };

const RUNNING: JobRow = {
  id: 'j1',
  kind: 'import',
  title: 'Import kontaktů',
  status: 'running',
  done: 120,
  total: 400,
  started_by: 'Jana Nováková',
  started_at: '2026-07-31T08:00:00.000Z',
  updated_at: '2026-07-31T08:03:00.000Z',
  finished_at: null,
  note: null,
};

function renderDetail(job: Result<{ job: JobRow }>) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <JobDetail job={job} backHref="/w/eshop" />
    </NextIntlClientProvider>,
  );
}

describe('JobDetail', () => {
  it('ukáže postup číslem i podílem, ne jen pruhem', () => {
    renderDetail({ ok: true, data: { job: RUNNING } });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '120');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '400');
  });

  it('u cizí úlohy uvede, kdo ji spustil', () => {
    renderDetail({ ok: true, data: { job: RUNNING } });
    expect(screen.getByText(/Jana Nováková/)).toBeInTheDocument();
  });

  it('u dokončené úlohy s chybami to neschová do zeleného stavu', () => {
    renderDetail({
      ok: true,
      data: { job: { ...RUNNING, status: 'completedWithErrors', done: 400, finished_at: '2026-07-31T08:10:00.000Z' } },
    });
    expect(screen.getByTestId('job-status')).toHaveAttribute('data-status', 'completedWithErrors');
  });

  it('neznámou úlohu vykreslí jako stav nenalezeno s cestou zpět, ne jako chybu', () => {
    renderDetail({
      ok: false,
      problem: {
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        code: 'not_found',
        detail: '',
        instance: '/api/v1/jobs/import/j1',
        request_id: 'req_1',
      },
    });
    expect(screen.getByTestId('not-found-state')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zpět na přehled projektu' })).toHaveAttribute('href', '/w/eshop');
  });

  it('jinou chybu ukáže jako blok S9 s číslem požadavku', () => {
    renderDetail({
      ok: false,
      problem: {
        type: 'about:blank',
        title: 'Server error',
        status: 500,
        code: 'internal_error',
        detail: '',
        instance: '/api/v1/jobs/import/j1',
        request_id: 'req_2',
      },
    });
    expect(screen.getByText('req_2')).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/jobs/job-detail.test.tsx`
Expected: FAIL, `Failed to resolve import "./job-detail"`.

- [ ] **Krok 3: Napiš detail úlohy**

`apps/web/src/features/jobs/job-detail.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { NotFoundState } from '@mlain/ui/patterns/states';
import type { Result } from '@/lib/api-client/result';
import { SettingsProblem } from '@/features/settings/settings-problem';

/** Tvar z `GET /api/v1/jobs/{kind}/{id}`, viz úkol 45 plánu P04. */
export type JobRow = {
  id: string;
  kind: string;
  title: string;
  status: 'running' | 'paused' | 'completed' | 'completedWithErrors' | 'failed' | 'cancelled';
  done: number;
  total: number;
  started_by: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  note: string | null;
};

const STATUS_KEYS = {
  running: 'jobs.status.running',
  paused: 'jobs.status.paused',
  completed: 'jobs.status.completed',
  completedWithErrors: 'jobs.status.completedWithErrors',
  failed: 'jobs.status.failed',
  cancelled: 'jobs.status.cancelled',
} as const satisfies Record<JobRow['status'], string>;

export function JobDetail({ job, backHref }: { job: Result<{ job: JobRow }>; backHref: string }) {
  const t = useTranslations('settings');
  const format = useFormatter();

  if (!job.ok) {
    // Neznámý druh i neznámé ID vrací P04 shodně jako 404, aby z odpovědi
    // nešlo zjistit, které druhy úloh instalace zná. Stav S13 tomu odpovídá.
    if (job.problem.status === 404) {
      return (
        <NotFoundState
          title={t('jobs.notFoundTitle')}
          body={t('jobs.notFoundBody')}
          backLink={
            <Link href={backHref} className="underline">
              {t('shared.backToOverview')}
            </Link>
          }
        />
      );
    }
    return <SettingsProblem problem={job.problem} onRetry={() => window.location.reload()} />;
  }

  const row = job.data.job;

  return (
    <section aria-labelledby="job-title" className="space-y-4">
      <h1 id="job-title" className="text-2xl font-semibold">
        {row.title}
      </h1>

      <p data-testid="job-status" data-status={row.status} className="text-[--color-text-muted]">
        {t(STATUS_KEYS[row.status])}
      </p>

      {/*
        Postup je i číslem, ne jen pruhem: pruh sám o sobě neřekne, kolik
        položek zbývá, a čtečka obrazovky z něj přečte jen procenta.
      */}
      <div
        role="progressbar"
        aria-valuenow={row.done}
        aria-valuemin={0}
        aria-valuemax={row.total}
        aria-label={row.title}
        className="h-2 w-full overflow-hidden rounded bg-[--color-surface-muted]"
      >
        <div
          className="h-full bg-[--color-accent]"
          style={{ width: `${row.total === 0 ? 0 : Math.round((row.done / row.total) * 100)}%` }}
        />
      </div>
      <p className="text-sm">{t('jobs.progress', { done: row.done, total: row.total })}</p>

      {row.started_by !== null ? (
        <p className="text-sm text-[--color-text-muted]">{t('jobs.startedBy', { person: row.started_by })}</p>
      ) : null}

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-[--color-text-muted]">{t('jobs.startedAt')}</dt>
        <dd>
          <time dateTime={row.started_at}>{format.dateTime(new Date(row.started_at), 'short')}</time>
        </dd>
        {row.finished_at !== null ? (
          <>
            <dt className="text-[--color-text-muted]">{t('jobs.finishedAt')}</dt>
            <dd>
              <time dateTime={row.finished_at}>{format.dateTime(new Date(row.finished_at), 'short')}</time>
            </dd>
          </>
        ) : null}
      </dl>

      {row.note !== null ? <p className="text-sm">{row.note}</p> : null}

      <p>
        <Link href={backHref} className="underline">
          {t('shared.backToOverview')}
        </Link>
      </p>
    </section>
  );
}
```

- [ ] **Krok 4: Napiš stránku**

`apps/web/src/app/[locale]/w/[workspaceSlug]/jobs/[kind]/[jobId]/page.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { requireUser } from '@/lib/identity/require-user';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { JobDetail, type JobRow } from '@/features/jobs/job-detail';

export async function generateMetadata({ params }: { params: Promise<{ kind: string; jobId: string }> }) {
  await params;
  const t = await getTranslations('settings');
  return { title: t('jobs.title') };
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; kind: string; jobId: string }>;
}) {
  const { workspaceSlug, kind, jobId } = await params;

  const me = await requireUser(`/w/${workspaceSlug}/jobs/${kind}/${jobId}`);
  if (!me.ok) return <SettingsProblem problem={me.problem} />;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) return <SettingsProblem problem={access.problem} />;

  // `kind` i `jobId` jdou z URL, takže se kódují, ne vkládají syrové.
  const job = await apiFetch<{ job: JobRow }>(
    `/api/v1/jobs/${encodeURIComponent(kind)}/${encodeURIComponent(jobId)}`,
    { workspaceId: access.data.workspace.id },
  );

  return <JobDetail job={job} backHref={`/w/${workspaceSlug}`} />;
}
```

- [ ] **Krok 5: Spusť testy a ověř, že procházejí**

Run: `pnpm --filter @mlain/web exec vitest run src/features/jobs/`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Krok 6: Commit**

```bash
git add apps/web/src/features/jobs "apps/web/src/app/[locale]/w"
git commit -m "feat(web): job detail page for the jobs center"
```

---

### Úkol 35: Testy přístupnosti přes axe na všech čtrnácti obrazovkách

**Soubory:**
- Create: `apps/web/e2e/settings/fixtures.ts`
- Create: `apps/web/e2e/settings/a11y.spec.ts`

Podle 11.4 části 6 má ověřování tři vrstvy a **zelený automatický test není doklad přístupnosti**, jen doklad, že nejsou hrubé chyby. Tenhle úkol dodává vrstvu 1, úkol 36 část vrstvy 2 a ruční kontrolní seznam z 11.5 se vyplňuje v úkolu 37.

**Čtrnáct obrazovek, šestnáct průchodů.** Obrazovek je čtrnáct: šest mimo přihlášení, profil, pět sekcí nastavení, detail webhooku a detail úlohy. Průchodů je o dva víc, protože `/reset-password` se prochází bez tokenu i s ním (jsou to dva různé stavy téže cesty) a rozcestník `/w/{slug}/settings` se prochází zvlášť, aby se ověřilo, že přesměrování na obecné nastavení skutečně proběhne.

- [ ] **Krok 1: Napiš sdílené fixtures**

`apps/web/e2e/settings/fixtures.ts`:

```ts
import { test as base, expect, type Page } from '@playwright/test';

export const OWNER = {
  email: 'e2e-owner@example.com',
  password: 'e2e heslo dost dlouhe',
  name: 'Vlastník',
  workspaceName: 'E2E Projekt',
  slug: 'e2e-projekt',
};

export const VIEWER = {
  email: 'e2e-viewer@example.com',
  password: 'e2e prohlizejici heslo',
};

/** Založí instalaci, když ještě neexistuje. Opakované volání je bez následku. */
export async function ensureInstallation(page: Page): Promise<void> {
  const response = await page.request.post('/api/v1/setup', {
    data: {
      email: OWNER.email,
      password: OWNER.password,
      name: OWNER.name,
      workspace_name: OWNER.workspaceName,
      locale: 'cs',
    },
  });
  expect([201, 409]).toContain(response.status());
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Heslo').fill(password);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

/**
 * Založí webhook endpoint a vrátí jeho ID. Detail webhooku je obrazovka,
 * kterou bez záznamu nejde otevřít, a přeskočený test není doklad ničeho.
 */
export async function createWebhookEndpoint(page: Page): Promise<string> {
  const response = await page.request.post('/api/v1/webhook-endpoints', {
    data: { url: 'https://example.com/hook', events: ['contact.created'] },
  });
  expect(response.status(), await response.text()).toBe(201);
  const created = (await response.json()) as { id: string };
  expect(created.id).toBeTruthy();
  return created.id;
}

export const test = base.extend<{ signedInPage: Page }>({
  signedInPage: async ({ page }, use) => {
    await ensureInstallation(page);
    await signIn(page, OWNER.email, OWNER.password);
    await use(page);
  },
});

export { expect };
```

- [ ] **Krok 2: Napiš test přístupnosti**

`apps/web/e2e/settings/a11y.spec.ts`:

```ts
import AxeBuilder from '@axe-core/playwright';
import { ensureInstallation, expect, test } from './fixtures';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Šest obrazovek dostupných bez přihlášení. */
const PUBLIC_SCREENS = [
  { name: 'setup', path: '/setup' },
  { name: 'login', path: '/login' },
  { name: 'forgot-password', path: '/forgot-password' },
  { name: 'reset-password bez tokenu', path: '/reset-password' },
  { name: 'reset-password s tokenem', path: '/reset-password?token=neplatny' },
  { name: 'invitations/accept bez tokenu', path: '/invitations/accept' },
];

/**
 * Osm cest pro přihlášeného uživatele.
 *
 * Dřívější seznam měl sedm a chyběly v něm tři, které kapitola 10.4 vypisuje
 * jako vlastní cesty v routeru: **rozcestník nastavení**, **detail webhooku**
 * (nejsložitější tabulka v celém plánu, s filtry, kurzorem a akcemi)
 * a **detail úlohy**. Detail webhooku a detail úlohy potřebují záznam,
 * který v čisté instalaci neexistuje, takže si ho fixture založí; když se
 * to nepovede, test **selže**, nepřeskočí se.
 */
const PRIVATE_SCREENS = [
  { name: 'no-workspace', path: '/no-workspace' },
  { name: 'profil', path: '/settings/profile' },
  { name: 'rozcestník nastavení', path: '/w/e2e-projekt/settings' },
  { name: 'projekt', path: '/w/e2e-projekt/settings/general' },
  { name: 'tým', path: '/w/e2e-projekt/settings/members' },
  { name: 'klíče k API', path: '/w/e2e-projekt/settings/api-keys' },
  { name: 'webhooky', path: '/w/e2e-projekt/settings/webhooks' },
  { name: 'audit log', path: '/w/e2e-projekt/settings/audit' },
];

test.describe('přístupnost obrazovek bez přihlášení', () => {
  for (const screen of PUBLIC_SCREENS) {
    test(`${screen.name} nemá porušení WCAG 2.2 AA`, async ({ page }) => {
      await ensureInstallation(page);
      await page.goto(screen.path);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
});

test.describe('přístupnost obrazovek po přihlášení', () => {
  for (const screen of PRIVATE_SCREENS) {
    test(`${screen.name} nemá porušení WCAG 2.2 AA`, async ({ signedInPage }) => {
      await signedInPage.goto(screen.path);
      const results = await new AxeBuilder({ page: signedInPage }).withTags(WCAG).analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
});

test.describe('přístupnost obrazovek, které potřebují vlastní záznam', () => {
  test('detail webhooku nemá porušení WCAG 2.2 AA', async ({ signedInPage }) => {
    const endpointId = await createWebhookEndpoint(signedInPage);
    await signedInPage.goto(`/w/e2e-projekt/settings/webhooks/${endpointId}`);
    const results = await new AxeBuilder({ page: signedInPage }).withTags(WCAG).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('detail neznámé úlohy nemá porušení WCAG 2.2 AA', async ({ signedInPage }) => {
    // Registr zdrojů úloh je po vlně 0 prázdný, takže se vykreslí stav S13.
    // I ten je plnohodnotná obrazovka a musí projít, ne se přeskočit.
    await signedInPage.goto('/w/e2e-projekt/jobs/import/00000000-0000-7000-8000-000000000000');
    const results = await new AxeBuilder({ page: signedInPage }).withTags(WCAG).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});

test.describe('přístupnost otevřených dialogů', () => {
  test('dialog smazání projektu nemá porušení a drží fokus', async ({ signedInPage }) => {
    await signedInPage.goto('/w/e2e-projekt/settings/general');
    await signedInPage.getByRole('button', { name: 'Smazat projekt' }).click();
    await expect(signedInPage.getByRole('dialog')).toBeVisible();

    const results = await new AxeBuilder({ page: signedInPage }).withTags(WCAG).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);

    await signedInPage.keyboard.press('Escape');
    await expect(signedInPage.getByRole('dialog')).toBeHidden();
    await expect(signedInPage.getByRole('button', { name: 'Smazat projekt' })).toBeFocused();
  });
});

test.describe('přístupnost v tmavém režimu a při zvětšení', () => {
  test('profil v tmavém režimu nemá porušení kontrastu', async ({ signedInPage }) => {
    await signedInPage.emulateMedia({ colorScheme: 'dark' });
    await signedInPage.goto('/settings/profile');
    const results = await new AxeBuilder({ page: signedInPage }).withTags(WCAG).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('tým při zvětšení na 200 procent nerozbije rozvržení', async ({ signedInPage }) => {
    await signedInPage.setViewportSize({ width: 640, height: 720 });
    await signedInPage.goto('/w/e2e-projekt/settings/members');
    const overflows = await signedInPage.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

test.describe('přístupnost v angličtině', () => {
  test('přihlášení v angličtině nemá porušení', async ({ page }) => {
    await ensureInstallation(page);
    await page.goto('/en/login');
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
```

- [ ] **Krok 3: Spusť testy přístupnosti**

Run: `pnpm --filter @mlain/web exec playwright test e2e/settings/a11y.spec.ts`
Expected: PASS, 18 testů zelených. Každé porušení se opravuje v komponentě P06; kdyby vzniklo v komponentě z `packages/ui`, patří oprava do P05.

- [ ] **Krok 4: Commit**

```bash
git add apps/web/e2e/settings
git commit -m "test(web): axe accessibility checks on all p06 screens"
```

---

### Úkol 36: Povinné stavy seznamů a průchod rolí prohlížející

**Soubory:**
- Create: `apps/web/e2e/settings/states.spec.ts`
- Create: `apps/web/e2e/settings/keyboard.spec.ts`

Kritérium 19 kapitoly 15.3 části 6 žádá, aby se stavy kontrolovaly **sadou testů, které simulují prázdnou odpověď, chybu, 403, 404 a offline**. Tenhle úkol je dodává mechanicky pro všech sedm seznamů P06.

- [ ] **Krok 1: Napiš test povinných stavů**

`apps/web/e2e/settings/states.spec.ts`:

```ts
import { expect, test } from './fixtures';

/** Sedm seznamů, které P06 vlastní, a endpoint, ze kterého se plní. */
const LISTS = [
  { name: 'relace', path: '/settings/profile', api: '**/api/v1/auth/sessions*' },
  { name: 'tým', path: '/w/e2e-projekt/settings/members', api: '**/api/v1/members*' },
  { name: 'pozvánky', path: '/w/e2e-projekt/settings/members', api: '**/api/v1/invitations*' },
  { name: 'klíče k API', path: '/w/e2e-projekt/settings/api-keys', api: '**/api/v1/api-keys*' },
  { name: 'webhooky', path: '/w/e2e-projekt/settings/webhooks', api: '**/api/v1/webhook-endpoints*' },
  { name: 'audit log', path: '/w/e2e-projekt/settings/audit', api: '**/api/v1/audit-log*' },
  {
    name: 'log doručení',
    path: '/w/e2e-projekt/settings/webhooks',
    api: '**/api/v1/webhook-deliveries*',
  },
] as const;

function problemBody(code: string, status: number) {
  return JSON.stringify({
    type: `https://docs.mlain.dev/errors/${code}`,
    title: code,
    status,
    detail: 'Testovací chyba.',
    instance: '/api/v1/test',
    code,
    request_id: 'req_e2e_1',
  });
}

test.describe('povinné stavy každého seznamu', () => {
  for (const list of LISTS) {
    test(`${list.name}: prázdná odpověď ukáže vysvětlení a ne prázdnou plochu`, async ({ signedInPage }) => {
      await signedInPage.route(list.api, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [],
            pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 50 },
          }),
        }),
      );
      await signedInPage.goto(list.path);
      const body = await signedInPage.locator('main').innerText();
      expect(body.trim().length).toBeGreaterThan(40);
    });

    test(`${list.name}: chyba 500 ukáže request_id a tlačítko Zkusit znovu`, async ({ signedInPage }) => {
      await signedInPage.route(list.api, (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: problemBody('internal_error', 500),
        }),
      );
      await signedInPage.goto(list.path);
      await expect(signedInPage.getByText('req_e2e_1')).toBeVisible();
      await expect(signedInPage.getByRole('button', { name: 'Zkusit znovu' }).first()).toBeVisible();
    });

    test(`${list.name}: chyba má sbalitelné technické detaily s kódem`, async ({ signedInPage }) => {
      await signedInPage.route(list.api, (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: problemBody('internal_error', 500),
        }),
      );
      await signedInPage.goto(list.path);
      const details = signedInPage.locator('details', { hasText: 'Technické detaily' }).first();
      await expect(details).toBeVisible();
      await details.locator('summary').click();
      await expect(details.getByText('internal_error')).toBeVisible();
    });
  }
});

test.describe('stavy bez oprávnění a nenalezeno', () => {
  test('403 na klíčích ukáže chybějící oprávnění a cestu zpět', async ({ signedInPage }) => {
    await signedInPage.route('**/api/v1/api-keys*', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/problem+json',
        body: problemBody('forbidden', 403),
      }),
    );
    await signedInPage.goto('/w/e2e-projekt/settings/api-keys');
    await expect(signedInPage.locator('[data-error-code]')).toHaveCount(1);
  });

  test('neexistující projekt v adrese ukáže stav nenalezeno, ne prázdno', async ({ signedInPage }) => {
    await signedInPage.goto('/w/neexistujici-projekt/settings/general');
    await expect(signedInPage.getByText('Tuhle položku jsme nenašli')).toBeVisible();
  });

  test('neexistující webhook ukáže stav nenalezeno', async ({ signedInPage }) => {
    await signedInPage.goto('/w/e2e-projekt/settings/webhooks/00000000-0000-7000-8000-000000000000');
    await expect(signedInPage.getByText('Tuhle položku jsme nenašli')).toBeVisible();
  });
});

test.describe('offline', () => {
  test('ztráta spojení ukáže pruh a formuláře zůstanou vyplněné', async ({ signedInPage, context }) => {
    await signedInPage.goto('/w/e2e-projekt/settings/general');
    await signedInPage.getByLabel('Název projektu').fill('Rozepsaný název');
    await context.setOffline(true);
    await expect(signedInPage.getByText('Ztratili jsme spojení. Zkoušíme se připojit.')).toBeVisible();
    await expect(signedInPage.getByLabel('Název projektu')).toHaveValue('Rozepsaný název');
    await context.setOffline(false);
  });
});

test.describe('neplatný kurzor', () => {
  test('odkaz s rozbitým kurzorem ukáže první stránku a hlášku, ne chybu', async ({ signedInPage }) => {
    await signedInPage.goto('/w/e2e-projekt/settings/audit?cursor=rozbity');
    await expect(signedInPage.getByText(/Ukazujeme první stránku stejného filtru/)).toBeVisible();
    await expect(signedInPage.locator('table')).toBeVisible();
  });
});

test.describe('sekce, na kterou uživatel nemá oprávnění', () => {
  test('prohlížející nevidí v navigaci tým, klíče, webhooky ani audit', async ({ page }) => {
    await page.goto('/login');
    // Prohlížející vzniká pozvánkou v testovacích datech, viz krok 3 tohohle úkolu.
    await page.getByLabel('E-mail').fill('e2e-viewer@example.com');
    await page.getByLabel('Heslo').fill('e2e prohlizejici heslo');
    await page.getByRole('button', { name: 'Přihlásit se' }).click();
    await page.goto('/w/e2e-projekt/settings/general');

    const nav = page.getByRole('navigation', { name: 'Nastavení' });
    await expect(nav.getByRole('link', { name: 'Projekt' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Tým' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Klíče k API' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Webhooky' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
  });

  test('přímý přístup prohlížejícího na audit vrátí vysvětlení a odkaz zpět', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('e2e-viewer@example.com');
    await page.getByLabel('Heslo').fill('e2e prohlizejici heslo');
    await page.getByRole('button', { name: 'Přihlásit se' }).click();
    await page.goto('/w/e2e-projekt/settings/audit');

    await expect(page.getByText('Na tuhle část nemáte oprávnění')).toBeVisible();
    await expect(page.getByText('audit:read')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Zpět na přehled projektu' })).toBeVisible();
  });

  test('prohlížející vidí nastavení projektu jako text, ne jako zašedlá pole', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('e2e-viewer@example.com');
    await page.getByLabel('Heslo').fill('e2e prohlizejici heslo');
    await page.getByRole('button', { name: 'Přihlásit se' }).click();
    await page.goto('/w/e2e-projekt/settings/general');

    await expect(page.getByText('Tuhle sekci můžete jen prohlížet')).toBeVisible();
    // Totéž co v jednotkovém testu: `select[disabled]` sám o sobě neměří nic,
    // protože Radix nativní `<select>` nevykreslí. Kritérium 18 mluví
    // o zašedlé akci, ne o konkrétní značce.
    await expect(
      page.locator(
        'input[disabled], select[disabled], button[disabled], textarea[disabled], [aria-disabled="true"], [data-disabled]',
      ),
    ).toHaveCount(0);
  });
});
```

- [ ] **Krok 2: Doplň do fixtures založení prohlížejícího**

Do `apps/web/e2e/settings/fixtures.ts` přidej na konec:

```ts
/**
 * Založí prohlížejícího, pokud ještě neexistuje. Pozvánka se přijímá přes API,
 * protože e-mail v testovacím běhu nikam neodchází a token se bere z odpovědi.
 */
export async function ensureViewer(page: Page): Promise<void> {
  await ensureInstallation(page);
  await signIn(page, OWNER.email, OWNER.password);

  const me = await page.request.get('/api/v1/auth/me');
  const body = (await me.json()) as { memberships: Array<{ workspace_id: string }>; csrf_token: string };
  const workspaceId = body.memberships[0]!.workspace_id;

  const invitation = await page.request.post('/api/v1/invitations', {
    headers: { 'x-workspace-id': workspaceId, 'x-csrf-token': body.csrf_token },
    data: { email: VIEWER.email, role: 'viewer' },
  });
  if (invitation.status() === 409) return;

  const created = (await invitation.json()) as { token?: string };
  if (created.token === undefined) {
    throw new Error('P04 musí v testovacím režimu vracet token pozvánky, jinak se prohlížející nedá založit.');
  }

  await page.request.post('/api/v1/auth/logout', { headers: { 'x-csrf-token': body.csrf_token } });
  await page.goto(`/invitations/accept?token=${created.token}`);
}
```

**Poznámka k tokenu pozvánky.** V produkci se token nikdy nevrací v odpovědi, chodí jen e-mailem. Pro E2E ho potřebujeme, protože v testovacím běhu žádná pošta neodchází. P04 má rozhodnutí R7, podle kterého `LoggingSystemMailer` mimo produkci **zaloguje odkaz na úrovni `warn`**. Test si ho může vzít odtud, nebo P04 doplní vracení tokenu jen při `NODE_ENV=test`. Rozhodnutí patří P04, ne sem; kdyby ani jedna cesta nevedla, prohlížející se založí přímým zápisem do databáze v seed skriptu P16.

- [ ] **Krok 3: Napiš test klávesových průchodů**

`apps/web/e2e/settings/keyboard.spec.ts`:

```ts
import { expect, test } from './fixtures';

test.describe('ovládání z klávesnice', () => {
  test('přihlášení se dá vyplnit a odeslat bez myši', async ({ page }) => {
    await page.goto('/login');
    await page.keyboard.press('Tab');
    await page.keyboard.type('e2e-owner@example.com');
    await page.keyboard.press('Tab');
    await page.keyboard.type('e2e heslo dost dlouhe');
    await page.keyboard.press('Enter');
    await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  });

  test('sub-navigace nastavení je průchozí tabulátorem a označuje aktuální stránku', async ({ signedInPage }) => {
    await signedInPage.goto('/w/e2e-projekt/settings/general');
    const current = signedInPage.getByRole('navigation', { name: 'Nastavení' }).getByRole('link', { name: 'Projekt' });
    await expect(current).toHaveAttribute('aria-current', 'page');
    await current.focus();
    await expect(current).toBeFocused();
  });

  test('dialog smazání projektu vrací fokus na spouštěč', async ({ signedInPage }) => {
    await signedInPage.goto('/w/e2e-projekt/settings/general');
    const trigger = signedInPage.getByRole('button', { name: 'Smazat projekt' });
    await trigger.focus();
    await signedInPage.keyboard.press('Enter');
    await expect(signedInPage.getByRole('dialog')).toBeVisible();
    await signedInPage.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });

  test('výchozí fokus v destruktivním dialogu není na destruktivním tlačítku', async ({ signedInPage }) => {
    await signedInPage.goto('/w/e2e-projekt/settings/general');
    await signedInPage.getByRole('button', { name: 'Smazat projekt' }).click();
    const destructive = signedInPage.getByRole('dialog').getByRole('button', { name: /^Smazat projekt / });
    await expect(destructive).not.toBeFocused();
  });

  test('po odeslání formuláře s chybou skočí fokus na první chybné pole', async ({ signedInPage }) => {
    await signedInPage.goto('/w/e2e-projekt/settings/general');
    await signedInPage.getByLabel('Adresa projektu').fill('NEPLATNÁ ADRESA');
    await signedInPage.getByRole('button', { name: 'Uložit' }).click();
    await expect(signedInPage.getByLabel('Adresa projektu')).toBeFocused();
  });

  test('sekret klíče jde zkopírovat z klávesnice', async ({ signedInPage, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signedInPage.goto('/w/e2e-projekt/settings/api-keys');
    await signedInPage.getByLabel('Název klíče').fill('Klávesnicový klíč');
    await signedInPage.getByRole('checkbox').first().check();
    await signedInPage.getByRole('button', { name: 'Vytvořit klíč' }).click();
    await expect(signedInPage.getByText('Zkopírujte si sekret teď. Už ho nikdy neuvidíme ani my.')).toBeVisible();
    await signedInPage.getByRole('button', { name: 'Zkopírovat' }).first().focus();
    await signedInPage.keyboard.press('Enter');
    const copied = await signedInPage.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^ml_live_/);
  });
});
```

- [ ] **Krok 4: Spusť oba testovací soubory**

Run: `pnpm --filter @mlain/web exec playwright test e2e/settings/states.spec.ts e2e/settings/keyboard.spec.ts`
Expected: PASS, 33 testů zelených.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/e2e/settings
git commit -m "test(web): mandatory list states, viewer walkthrough, keyboard paths"
```

---

### Úkol 37: Kompletní série a kontrolní seznam přístupnosti

**Soubory:**
- Create: `docs/superpowers/checklists/2026-07-31-p06-a11y.md`

Podle pravidla „hotovo znamená ověřeno" se plán nepovažuje za dokončený, dokud neprojde celá série a dokud není vyplněný kontrolní seznam z 11.5 části 6 pro každou obrazovku.

- [ ] **Krok 1: Zapni test katalogu akcí, který byl v úkolu 5 přeskočený**

Run: `pnpm --filter @mlain/web exec vitest run src/lib/feedback/action-catalog.test.ts`
Expected: PASS, `Tests  4 passed (4)`. Test teď najde všech 27 akcí v jejich modulech.

- [ ] **Krok 2: Spusť jednotkové testy a testy komponent**

Run: `pnpm --filter @mlain/web test:unit`
Expected: PASS. Očekávaný součet je 232 testů; když je jich méně, něco se nespustilo.

- [ ] **Krok 3: Spusť typovou kontrolu a lint**

Run: `pnpm --filter @mlain/web typecheck`
Expected: PASS, žádná chyba.

Run: `pnpm --filter @mlain/web lint`
Expected: PASS. Pravidlo z P05, které zakazuje `disabled` na primárním tlačítku, musí projít bez jediné výjimky v allowlistu pro soubory P06.

- [ ] **Krok 4: Spusť kontrolu katalogů a licencí**

Run: `pnpm ci:i18n-check`
Expected: exit code 0.

Run: `pnpm ci:licenses-node`
Expected: exit code 0. `msw` je MIT, takže brána projde bez nové výjimky.

- [ ] **Krok 5: Spusť databázové a integrační testy**

Run: `pnpm --filter @mlain/web test:db`
Expected: PASS, preflight z úkolu 1 a test změny hesla z úkolu 19.

- [ ] **Krok 6: Spusť testy v prohlížeči**

Run: `pnpm --filter @mlain/web test:e2e`
Expected: PASS, včetně testů přístupnosti z úkolu 35 a testů stavů a klávesnice z úkolu 36.

- [ ] **Krok 7: Ověř, že v repozitáři není dlouhá pomlčka**

Run: `grep -rn "$(printf '\\u2014')" packages/i18n/messages apps/web/src apps/web/e2e`
Expected: žádný výstup, exit code 1.

- [ ] **Krok 8: Vyplň kontrolní seznam 11.5 pro každou obrazovku**

`docs/superpowers/checklists/2026-07-31-p06-a11y.md`:

```markdown
# Kontrolní seznam přístupnosti, plán P06

Vyplňuje autor před sloučením, jednou za každou obrazovku. Seznam je z kapitoly
11.5 části 6. Automatický test je jen jedna ze tří vrstev, tohle je vrstva dvě.

Legenda: `+` splněno ověřením, `n` neaplikuje se, s uvedením důvodu.

| Obrazovka | klávesnicí | fokus vidět | zoom 200 % | odstíny šedi | barva plus slovo | popisky polí | chyba u pole | ohlášení čtečce | dialog a Esc | prázdný, načítání, chyba | oba jazyky s ICU | axe zelený |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/setup` | | | | | | | | | n | n | | |
| `/login` | | | | | | | | | n | n | | |
| `/forgot-password` | | | | | | | | | n | n | | |
| `/reset-password` | | | | | | | | | n | n | | |
| `/invitations/accept` | | | | | | | | | n | n | | |
| `/no-workspace` | | | | | | | | | n | | | |
| `/settings/profile` | | | | | | | | | | | | |
| `/w/{slug}/settings/general` | | | | | | | | | | | | |
| `/w/{slug}/settings/members` | | | | | | | | | | | | |
| `/w/{slug}/settings/api-keys` | | | | | | | | | | | | |
| `/w/{slug}/settings/webhooks` | | | | | | | | | | | | |
| `/w/{slug}/settings/webhooks/{id}` | | | | | | | | | | | | |
| `/w/{slug}/settings/audit` | | | | | | | | | n | | | |

## Minimální scénář se čtečkou obrazovky

Z kapitoly 11.4 části 6 se plánu P06 týkají první dva body. Zbytek scénáře
pokrývají plány P07 a P13.

- [ ] Přihlásit se (VoiceOver a Safari)
- [ ] Projít nastavení projektu a slyšet, co která sekce je

## Co automat nezachytil a ověřilo se ručně

| Věc | Jak se ověřila |
|---|---|
| Smysluplnost hlášek | přečtením nahlas, věta po větě |
| Pořadí fokusu v sub-navigaci | průchodem tabulátorem bez myši |
| Rozlišitelnost stavů bez barev | režimem odstínů šedi v prohlížeči |
| Čitelnost sekretu klíče čtečkou | přečtením znak po znaku ve VoiceOver |
```

- [ ] **Krok 9: Commit**

```bash
git add docs/superpowers/checklists/2026-07-31-p06-a11y.md
git commit -m "docs: p06 accessibility checklist for all thirteen screens"
```

---

## 8. Pořadí provádění

Úkoly jdou po sobě, ale ne všechny na sobě závisí. Kdo plán provádí subagenty, může pouštět paralelně to, co je ve stejném řádku.

| Vlna | Úkoly | Podmínka |
|---|---|---|
| 0 | 1 | Preflight. Když neprojde, plán nezačíná. |
| 1 | 2, 4, 6, 7 | Čisté funkce bez závislostí mezi sebou. |
| 2 | 3, 5, 8, 9 | Potřebují typy z vlny 1. |
| 3 | 10 | Katalogy. Musí být před obrazovkami. |
| 4 | 11 | Sdílené prvky formulářů. |
| 5 | 12, 13, 14, 15, 16, 17 | Šest obrazovek přihlášení, navzájem nezávislé. |
| 6 | 18, 19, 20 | Profil. 19 a 20 potřebují 18 kvůli stránce. |
| 7 | 21 | Skořápka nastavení. |
| 8 | 22, 25, 27, 29, 32 | Pět obrazovek nastavení, navzájem nezávislé. |
| 9 | 23, 24, 26, 28, 30, 31 | Nadstavby nad obrazovkami z vlny 8. |
| 10 | 33 | Segmentové stavy. |
| 11 | 34, 35 | Testy v prohlížeči. Potřebují všechny obrazovky. |
| 12 | 36 | Kompletní série a kontrolní seznam. |

**Jediná tvrdá podmínka mezi vlnami:** katalogy (úkol 10) musí existovat dřív než první obrazovka. Obrazovka psaná bez katalogu skončí s literály v JSX a ty se pak dohledávají ručně.

---

## 9. Pokrytá akceptační kritéria

### 9.1 Z kapitoly 8 části 1 (`01-platforma.md`)

| Kritérium | Znění zkráceně | Kde je pokryté |
|---|---|---|
| 15 | Deset neúspěchů vede k `423 account_locked` | Úkol 13 (vlastní stav obrazovky s vysvětlením patnáctiminutového okna) |
| 17 | Změna hesla revokuje ostatní relace | Úkol 19, krok 5 (integrační test proti reálnému API) |
| 18 | `logout-all` zneplatní i aktuální cookie | Úkol 20 (dialog N2 a přesměrování na přihlášení) |
| 22 | Odebrání posledního ownera vrátí 409 | Úkol 25 (hláška `lastOwner`, role v tabulce se nezmění) |
| 23 | `viewer` dostane 403 `forbidden` | Úkol 21 a 35 (sekce se nezobrazuje, přímý přístup je stav S11) |
| 25 | Sekret klíče je v odpovědi právě jednou | Úkol 27 (test „ukáže jen prefix, nikdy sekret" plus preflight E6) |
| 26c | Rotace s `grace_seconds` | Úkol 28 (tři hodnoty přechodného období, odznak „starý sekret platí do") |
| 27, 28 | Neplatné tělo vrátí 422 s `errors[].path` | Úkol 4 a 12 (mapování na pole formuláře, fokus na první chybné pole) |
| 29 | Každá chybová odpověď obsahuje `request_id` | Úkol 8 (blok S9 s číslem požadavku a tlačítkem zkopírovat) |
| 30, 31 | Idempotence zápisů | Úkol 5 (skryté pole s klíčem, stabilní přes celé zobrazení formuláře) |
| 32 | Překročení limitu vrátí 429 s `Retry-After` | Úkol 13 a 14 (hláška s počtem sekund z `retry_after`) |
| 33 | Stránkování přes 10 000 položek | Úkol 6 (kurzor v URL, bez čísel stránek, náhrada při neplatném kurzoru) |
| 37 | Endpoint vracející 410 je `disabled` | Úkol 29 (pruh vypnutého webhooku se stavem a s tlačítkem zapnout) |
| 40 | Dvacet neúspěchů deaktivuje endpoint | Úkol 29 a 31 (doslovný text z 5.3, podrobnosti a přehrání 24 hodin v detailu) |
| 51, 52, 53 | i18n: parita klíčů, výjimka u chybějícího klíče, `plural` | Úkol 10 (devět testů katalogů, mimo jiné vykreslení pro 0, 1, 2, 5 a 1,5) |

Kritéria 1 až 14, 16, 19 až 21e, 24, 26, 26b, 34 až 36b, 38, 39 a 41 až 56 patří plánům P01, P02, P03, P04, P09 a P16. P06 je nepokrývá a netvrdí to.

### 9.2 Z kapitoly 15 části 6 (`06-ui-ux.md`)

| Kritérium | Znění zkráceně | Kde je pokryté |
|---|---|---|
| 1 | Každá mutační akce má právě jeden kanál zpětné vazby | Úkol 5 (katalog 27 akcí, test porovná kanál s třídou podle tabulky 5.2) |
| 3 | Chybový toast se sám nezavře | Úkol 25 a 26 (chyby akcí členů jdou do toastu, který drží P05) |
| 5 | Selhaná optimistická akce vrátí stav přesně zpět | Úkol 25 (výběr role se vrátí na původní hodnotu, hláška `changeRole.failed`) |
| 18 | Žádné primární tlačítko nemá `disabled` | Úkol 11 (test `SubmitButton`), potvrzeno lintem v úkolu 37 |
| 19 | Každá obrazovka má implementované všechny povinné stavy | Úkol 36 (21 testů pro sedm seznamů: prázdno, chyba, technické detaily) |
| 20 | Prázdný stav má vysvětlení a aspoň jednu akci | Úkol 36 (strukturální test na délku textu, ne snapshot znění); `EmptyState` z P05 navíc na prázdné `actions` hodí výjimku |
| 21 | Prázdný stav po filtrování se liší a popisuje filtr | Úkol 31 a 32 (log doručení a audit log, `FilteredEmptyState`) |
| 22 | Chybový stav má sbalitelné podrobnosti s kódem a `request_id` | Úkol 8, ověřeno v prohlížeči v úkolu 36 |
| 23 | `viewer` vidí obsah jako text, ne zašedlá pole | Úkol 22 (test „bez oprávnění zápisu ukáže hodnoty jako text") a úkol 36 |
| 68, 69, 70 | Žádná dlouhá pomlčka, žádný zakázaný výraz, parita klíčů | Úkol 10, znovu ověřeno v úkolu 37 |
| 71 | Žádný klíč se neskládá za běhu | Úkol 7 (mapa kódů), úkol 16 (mapa rolí), úkol 32 (mapa auditních akcí) |
| 72 | Všechny počty používají ICU `plural` včetně `=0` | Úkol 10 (test kategorií a vykreslení pro sedm hodnot) |
| 76 | Neznámý kód zobrazí `detail` ze serveru a `request_id` | Úkol 7 a 13 (test „u neznámého kódu ukáže detail ze serveru") |
| 76b | Každý kód z mapování 10.2 má klíč v obou katalozích | Úkol 10 (test pokrytí proti oběma mapám kódů) |
| 76c | Testy nekontrolují doslovné znění vět | Úkol 10 (kontroluje se struktura, parita a zákazy, ne snapshot) |
| 78, 79 | Žádná čísla stránek, kurzor v URL, náhrada při neplatném kurzoru | Úkol 6, ověřeno v prohlížeči v úkolu 36 |
| 80 | Indikátor se nezobrazí do 300 ms a pak zůstane 400 ms | Úkol 33 (`DeferredSkeleton` nad `useDelayedFlag` z P05) |

Kritéria 2, 4, 6 až 17, 24 až 67, 71b až 71d, 73 až 75, 77 a 81 až 82 patří jiným plánům: dlouhé úlohy, kampaně, import, segmenty, editor, reporty a rozpočet balíku.

---

## 10. Soubory, které tenhle plán vlastní

Vlastní znamená: **tenhle plán je smí vytvořit a měnit. Žádný jiný plán do nich nesahá.**

### 10.1 Katalogy i18n (4 soubory)

- `packages/i18n/messages/cs/auth.json`
- `packages/i18n/messages/en/auth.json`
- `packages/i18n/messages/cs/settings.json`
- `packages/i18n/messages/en/settings.json`

### 10.2 Knihovní vrstva `apps/web/src/lib` (38 souborů)

- `apps/web/src/lib/api-client/problem.ts` a `problem.test.ts`
- `apps/web/src/lib/api-client/result.ts` a `result.test.ts`
- `apps/web/src/lib/api-client/base-url.ts`
- `apps/web/src/lib/api-client/fetch.ts` a `fetch.test.ts`
- `apps/web/src/lib/api-client/mutate.ts` a `mutate.test.ts`
- `apps/web/src/lib/api-client/cursor.ts` a `cursor.test.ts`
- `apps/web/src/lib/errors/error-keys.ts` a `error-keys.test.ts`
- `apps/web/src/lib/errors/field-errors.ts` a `field-errors.test.ts`
- `apps/web/src/lib/errors/problem-block.tsx` a `problem-block.test.tsx`
- `apps/web/src/lib/identity/permissions.ts` a `permissions.test.ts`
- `apps/web/src/lib/identity/current-user.ts`
- `apps/web/src/lib/identity/require-user.ts` a `require-user.test.ts`
- `apps/web/src/lib/identity/workspace-access.ts` a `workspace-access.test.ts`
- `apps/web/src/lib/feedback/action-result.ts`
- `apps/web/src/lib/feedback/action-catalog.ts` a `action-catalog.test.ts`
- `apps/web/src/lib/feedback/confirm-labels.ts`
- `apps/web/src/lib/feedback/idempotency-field.tsx`
- `apps/web/src/lib/forms/submit-button.tsx` a `submit-button.test.tsx`
- `apps/web/src/lib/forms/field-error.tsx`
- `apps/web/src/lib/forms/form-error-summary.tsx`
- `apps/web/src/lib/forms/use-form-error-focus.ts`
- `apps/web/src/lib/forms/password-field.tsx` a `password-field.test.tsx`
- `apps/web/src/lib/forms/deferred-skeleton.tsx`
- `apps/web/src/lib/i18n/catalog.test.ts`

### 10.3 Doménové adresáře `apps/web/src/features` (celé)

- `apps/web/src/features/auth/` (`actions.ts`, `auth-card.tsx`, `action-problem.tsx`, `setup-form.tsx`, `login-form.tsx`, `forgot-password-form.tsx`, `reset-password-form.tsx`, `accept-invitation-panel.tsx`, `no-workspace-panel.tsx` a jejich testy)
- `apps/web/src/features/profile/` (`actions.ts`, `profile-form.tsx`, `change-password-form.tsx`, `describe-device.ts`, `sessions-section.tsx` a jejich testy)
- `apps/web/src/features/settings/` (`settings-nav.tsx`, `settings-page-shell.tsx`, `settings-problem.tsx`, `forbidden-section.tsx`, `settings-skeleton.tsx`, `offline-watcher.tsx`, `timezones.ts` a jejich testy)
- `apps/web/src/features/workspace-settings/` (`actions.ts`, `general-form.tsx`, `address-form-section.tsx`, `danger-zone.tsx` a jejich testy)
- `apps/web/src/features/members/` (`actions.ts`, `role-label.ts`, `members-table.tsx`, `invitations-section.tsx` a jejich testy)
- `apps/web/src/features/api-keys/` (`actions.ts`, `api-keys-table.tsx`, `secret-reveal.tsx`, `create-key-panel.tsx`, `rotate-key-dialog.tsx`, `revoke-key-dialog.tsx` a jejich testy)
- `apps/web/src/features/webhooks/` (`actions.ts`, `event-types.ts`, `webhooks-table.tsx`, `webhook-form.tsx`, `disabled-banner.tsx`, `deliveries-table.tsx`, `test-webhook-panel.tsx` a jejich testy)
- `apps/web/src/features/audit/` (`audit-actions.ts`, `audit-filters.tsx`, `audit-table.tsx` a jejich testy)
- `apps/web/src/features/jobs/` (`job-detail.tsx` a jeho test)

### 10.4 Cesty v routeru (24 souborů)

- `apps/web/src/app/[locale]/(auth)/layout.tsx`, `loading.tsx`
- `apps/web/src/app/[locale]/(auth)/setup/page.tsx`
- `apps/web/src/app/[locale]/(auth)/login/page.tsx`
- `apps/web/src/app/[locale]/(auth)/forgot-password/page.tsx`
- `apps/web/src/app/[locale]/(auth)/reset-password/page.tsx`
- `apps/web/src/app/[locale]/(auth)/invitations/accept/page.tsx`
- `apps/web/src/app/[locale]/(account)/layout.tsx`, `loading.tsx`
- `apps/web/src/app/[locale]/(account)/no-workspace/page.tsx`
- `apps/web/src/app/[locale]/(account)/settings/profile/page.tsx`
- `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/layout.tsx`, `page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx` (pět souborů)
- `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/account/page.tsx` (přesměrování na osobní profil)
- `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/general/page.tsx`
- `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/members/page.tsx`
- `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/api-keys/page.tsx`
- `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/webhooks/page.tsx`
- `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/webhooks/[endpointId]/page.tsx`
- `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/audit/page.tsx`
- `apps/web/src/app/[locale]/w/[workspaceSlug]/jobs/[kind]/[jobId]/page.tsx`

**Počty jsou přepočítané skriptem** ze všech řádků `Create:` a `Modify:` v kapitole 7, ne odhadem. Dva řádky nesou po dvou souborech (`layout.tsx` a `loading.tsx` u obou skupin) a jeden pět, proto je položek v seznamu míň než souborů.

### 10.5 Testy a dokumentace (10 souborů)

- `apps/web/test/p06/test-runner.test.ts`
- `apps/web/test/p06/ui-contract.ts`
- `apps/web/test/p06/ui-imports.test.ts`
- `apps/web/test/p06/preflight.test.ts`
- `apps/web/test/p06/change-password.test.ts`
- `apps/web/e2e/settings/fixtures.ts`
- `apps/web/e2e/settings/a11y.spec.ts`
- `apps/web/e2e/settings/states.spec.ts`
- `apps/web/e2e/settings/keyboard.spec.ts`
- `docs/superpowers/checklists/2026-07-31-p06-a11y.md`

### 10.6 Věta o hranicích

**Mimo soubory vyjmenované v kapitolách 10.1 až 10.5 tenhle plán nesahá na nic.**

Konkrétně a jmenovitě:

- **Nesahá na backend.** `packages/core` celý (identita, audit, platforma, webhooky, joby), `apps/web/src/lib/api` (obálka chyb, stránkování, idempotence, rate limit, verzování, autentizace, generátor OpenAPI) a `apps/web/src/app/api` vlastní **P04**. P06 volá HTTP endpointy pod `/api/v1`, nevolá doménové služby přímo a nezakládá jediný route handler.
- **Nesahá na komponenty ani na skořápku.** `packages/ui` celý (tokeny, primitiva, komponenty K1 až K8, stavy obrazovek, mechanismy zpětné vazby), `packages/i18n/src`, `packages/i18n/messages/{cs,en}/common.json`, kořenový `apps/web/src/app/layout.tsx`, `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/w/[workspaceSlug]/layout.tsx` a `apps/web/playwright.config.ts` vlastní **P05**. Když komponenta chybí nebo neumí, co je potřeba, doplní se požadavek do P05 a P06 na něj počká; vlastní komponenta v `packages/ui` se **nedopisuje**.
- **Nesahá na registr navigace.** `packages/ui/src/patterns/navigation/registry.ts` vlastní **P05** a obsahuje celý strom dopředu. P06 ho **jen čte a vykresluje výstup `visibleNavigation`**; filtrování si nepíše sám, protože dvě pravidla pro totéž se rozejdou a to o mizející prázdné sekci se zapomíná první. Nepřidává položku, nemění cestu ani popisek. Jediné, co P06 kvůli registru dělá u sebe, je přesměrování `/w/{slug}/settings/account` na osobní profil, aby šestá položka menu nevedla na 404.
- **Nesahá na `apps/web/src/proxy.ts`.** V Next.js 16 se soubor pro middleware jmenuje `proxy.ts` a exportuje funkci `proxy`. Vlastní ho **P05** se všemi matchery naráz (uzávěr S6). Autentizační brána P06 proto žije v Server Components jednotlivých obrazovek, viz rozhodnutí R9.
- **Nesahá na databázi.** `packages/db` celý vlastní **P03**. P06 nespouští jediný dotaz a nezná schéma jinak než přes tvar odpovědí API.
- **Nesahá na kořen repozitáře, konfiguraci ani CI.** `package.json` v kořeni, `pnpm-workspace.yaml`, `turbo.json`, `packages/config`, `docker/`, `.github/workflows`, `licenses.allow.json`, registr chybových kódů `packages/core/errors/registry.ts` a registr front vlastní **P01**.
- **Nesahá na kontrakty.** `packages/contracts` vlastní **P02**, `packages/contracts/openapi.json` se generuje a nikdy neslučuje ručně.

Dvě úzké výjimky jsou vyjmenované v kapitole 0.3 a nic dalšího si plán nedovolí: přidání `msw` do `devDependencies` v `apps/web/package.json` a nic víc v tom manifestu.

---

## 11. Sebekontrola

Po dopsání plánu jsem ho prošel proti zadání z kapitoly 5 řídicího dokumentu a proti 5.3 části 1. Tady je, co kontrola našla, a co se s tím stalo.

### 11.1 Pokrytí zadání

| Požadavek ze zadání | Kde je |
|---|---|
| `/setup`, `/login`, `/forgot-password`, `/reset-password`, `/invitations/accept`, `/no-workspace` | Úkoly 12 až 17 |
| `/settings/profile`: jméno, jazyk, zóna, změna hesla, aktivní relace | Úkoly 18, 19, 20 |
| `/w/{slug}/settings/general`: název, slug, jazyk, zóna, oslovení, smazání | Úkoly 22, 23, 24 |
| `/w/{slug}/settings/members`: seznam, pozvánky, změna role, odebrání | Úkoly 25, 26 |
| `/w/{slug}/settings/api-keys`: seznam, vytvoření, sekret jednou, rotace, revokace | Úkoly 27, 28 |
| `/w/{slug}/settings/webhooks`: seznam, detail s logem doručení, test, znovuaktivace | Úkoly 29, 30, 31 |
| `/w/{slug}/settings/audit`: seznam s filtry | Úkol 32 |
| `/w/{slug}/jobs/{kind}/{jobId}`: detail úlohy (nález N30) | Úkol 34 |
| Namespace i18n `auth` a `settings` | Úkol 10 |
| Povinné stavy každého seznamu | Kapitola 6, úkoly 8, 33, 36 |
| Sekce bez oprávnění se v navigaci nezobrazuje, přímý přístup vrací 403 | Úkol 21, ověřeno v úkolu 36 |
| Sekret klíče právě jednou, s hotovou hláškou | Úkol 27 |
| Smazání projektu opsáním názvu | Úkol 24 |
| Vykání, oslovení nastavitelné na projektu | Katalogy v úkolu 10, přepínač v úkolu 23 |
| Chyby: text, `request_id`, sbalené technické detaily, `data-error-code` | Úkol 8 |
| Čeština a angličtina od prvního dne | Úkol 10, testy parity a ICU |
| Testy přístupnosti přes `axe-core` v Playwrightu | Úkol 35 |
| Testy se skutečně spouštějí, ne jen tváří zeleně | Úkol 1, krok 1, plus požadavek P06→P01.1 |
| Každá knihovna s licencí | Kapitola 3 |
| Výslovný seznam vlastněných souborů | Kapitola 10 |
| Akceptační kritéria číslem | Kapitola 9 |

### 11.2 Co kontrola opravila

1. **Popisky tlačítka u hesla v profilu.** První verze formuláře změny hesla používala klíče `shared.copy` a `shared.close` jako „Zobrazit heslo" a „Skrýt heslo". Oprava je v úkolu 19, kroky 1 a 4: doplnily se klíče `shared.showPassword` a `shared.hidePassword`. **Revize přidala druhou půlku:** klíče byly jen v katalogu `auth`, kdežto formulář změny hesla běží v namespace `settings`, takže by za běhu vypsal jméno klíče místo textu. Teď jsou v obou namespace, a hlídá to kontrola, která porovnává každý klíč použitý v kódu proti katalogu.
2. **Skládaný klíč u role v pozvánce.** Stránka `/invitations/accept` sestavovala klíč výrazem `shared.role.${role}`, což zakazuje kritérium 71 části 6, a hodnota navíc chodí z parametru URL. Vznikla explicitní mapa `ROLE_LABEL_KEYS` (úkol 16). **Revize dokončila i druhou půlku:** výpis stránky mapu dřív nepoužíval a skládaný výraz v něm zůstal, takže se opravovalo až prózou po napsání souboru. Teď je ve výpisu rovnou správně.
3. **Text „Zkopírovat vše" složený ze dvou fragmentů.** `ProblemBlock` skládal popisek z `labels.copy` a slova „vše". Oprava je v úkolu 8: samostatný klíč `errorBlock.copyAll` je v typu `ProblemBlockLabels` od začátku.
4. **Dlouhá pomlčka v testu katalogů.** Test na zákaz znaku U+2014 ten znak obsahoval jako literál. Oprava: `String.fromCharCode(0x2014)`.

### 11.2b Co opravila revize a srovnání s hotovými dodavateli

Druhý průchod proběhl proti **hotové** podobě P01, P04 a P05, ne proti tomu, jak vypadaly při psaní P06. Ověřovalo se spuštěním, ne přečtením.

1. **Testy P06 se nespouštěly.** 44 ze 46 testovacích souborů leží v `src/**`, mimo vzor, který konfigurace od P01 hlídá. Kompletní série by skončila zeleně a s kódem 0, aniž by jediný z nich proběhl. Ověřeno spuštěním na Vitest 4.1.10. Oprava: kapitola 2.3, formální požadavek P06→P01.1 v 2.4 a **kontrola v úkolu 1, kroku 1**, která leží uvnitř starého vzoru, takže se spustí i tehdy, když se nespustí nic jiného.
2. **Tvar konfigurace, na kterém se tři plány dohodly, nestačil.** Bez registrace úklidu v `vitest.setup.ts` se automatický `cleanup` Testing Library nezaregistruje a testy komponent padají na `Found multiple elements with the role "button"`. Postihlo by to všech 27 testů komponent P06 a vypadalo by to jako chyba testu. Ověřeno spuštěním; přesné znění obou souborů je v kapitole 2.4.
3. **Pět jmen stavových komponent, které P05 nezaložil.** `ErrorState`, `LoadingSkeleton`, `StaleDataBanner`, `PartialErrorBoundary` a `OfflineBanner` byly jen v typovém kontraktu a P06 je nikde nevykresloval. Vypadly; čím jsou nahrazené, je v tabulce v kapitole 2.2.
4. **`LimitReachedState` se jmenuje `OverLimitState`** a bere `body`, ne `description`. Dvě místa použití.
5. **Prázdné stavy měly špatné props.** `EmptyState` z P05 bere `variant`, `explanation` a **povinné neprázdné `actions`**, na prázdné pole hodí výjimku. Sedm míst mělo `description` a čtyři z nich žádnou akci. Opravou zároveň zmizel rozpor s vlastním pravidlem plánu: akce se uživateli bez oprávnění **neskrývá**, ale nahrazuje akcí, která funguje, plus vysvětlením.
6. **Potvrzovací dialog neměl povinný prop `labels`.** Šest volání by se nepřeložilo. Popisky se skládají na jednom místě v `lib/feedback/confirm-labels.ts`. Zároveň zmizel prop `irreversibleNote`, který komponenta nemá, `children` u rotace klíče, který taky nemá, a `onConfirm` se srovnal na podpis bez události.
7. **Devět importů mířilo na cesty, které mapa `exports` nevystavuje.** `patterns/feedback/confirm-dialog` a `patterns/navigation/registry` se hledají jako adresáře s `index.ts`. Kontrola v úkolu 1 to nově hlídá pro celý strom `src`.
8. **Filtrování navigace si plán psal sám.** Nahrazeno voláním `visibleNavigation`. Testy se srovnaly se **skutečnými** oprávněními v registru: `settings-general` chce `workspace:update`, ne `workspace:read`, a `settings-members` chce `members:invite`, ne `members:read`.
9. **Šestá položka menu vedla na 404.** Registr má „Můj účet" na `/w/{slug}/settings/account`, profil bydlí na `/settings/profile`. Doplněno přesměrování v úkolu 21.
10. **Vlastní `CopyButton`.** Zrušen, bere se z `@mlain/ui/components/copy-button`, kde ho už používá P13.
11. **Pět českých zpráv dávalo při nule negramatickou větu.** „Ukončíme žádnou relaci", „Opravte nic níž". Opraveno a **doplněna kontrola**, která tuhle třídu chyby zachytí: ověřeno, že najde všech pět původních zpráv a propustí ty správné.
12. **Test parity slotů byl rozbitý.** Výraz `/\{(\w+)[,}]/` považoval za slot i obsah větve pluralu, která je jedno slovo, takže by správně napsaná zpráva shodila build. Nahrazeno čtením ICU stromu. Našlo se to jediným způsobem, jakým to najít šlo: spuštěním nad skutečnými katalogy.
13. **Slot `{workspace}` shazoval kontrolu slovníku.** `findViolations` v P05 hledá zakázané výrazy v celé zprávě včetně jmen slotů, takže „workspace" ve slotu čtyř zpráv by shodilo `ci:i18n-check`. Slot přejmenován na `projectName`. Na straně P05 je to nález N56 v evidenci.
14. **Sweep přes axe vynechával tři obrazovky.** Rozcestník nastavení, detail webhooku (nejsložitější tabulka plánu) a nově detail úlohy. Detail webhooku potřebuje záznam, takže si ho fixture zakládá a při neúspěchu **selže, nepřeskočí se**.
15. **Deklarované počty souborů nesouhlasily se seznamy pod nimi.** Přepočítáno skriptem ze všech řádků `Create:` a `Modify:`.

### 11.2c Co našla křížová kontrola proti hotovému P05

Druhá, nezávislá kontrola postavila vedle sebe **každé vykreslení** v P06 a doslovný typ props v P05. Importy, stavové komponenty, potvrzovací dialog i navigace už seděly. Šest věcí ne.

1. **`Select` není nativní prvek.** Devět míst mu předávalo `id`, `name`, `defaultValue` a `onChange` s nativní událostí a jako potomky `<option>`. P05 dodává obálku nad Radixem: povinné `onValueChange`, `placeholder` a `aria-label`, položka se jmenuje `SelectItem`. **Nejhorší byl důsledek, o kterém typová kontrola mlčí:** Radix do formuláře nevkládá žádné pole, takže by se hodnota nedostala do `FormData` a Server Action by uložil prázdno, aniž by cokoli spadlo. Obsluha je teď na jednom místě v `lib/forms/select-field.tsx` a nese hodnotu skrytým polem.
2. **Dvě kontroly na zašedlé prvky procházely naprázdno.** Jednotkový i koncový test hledaly `select[disabled]`, tedy značku, kterou Radix nikdy nevykreslí. Kritérium 18 mluví o zašedlé akci, ne o konkrétní značce, takže dotaz nově pokrývá i `button[disabled]`, `aria-disabled` a `data-disabled`.
3. **`Badge` bez povinné ikony na šesti místech.** V P05 je `icon` povinná schválně: stav se nikdy nesděluje jen barvou (11.3). Ikony kreslí `lucide-react`, jenže ta je závislostí `packages/ui`, ne `apps/web`, a P06 si smí přidat jedinou závislost. Šest ikon proto P06 kreslí sám v `lib/ui/status-icons.tsx`, bez nové závislosti.
4. **Tón `info` u `Badge` neexistuje.** Povolené jsou `neutral`, `accent`, `success`, `warning` a `danger`. Byl dvakrát, jednou přímo a jednou v mapě stavů doručení, odkud se šířil dál.
5. **`useDelayedFlag` se volal se dvěma argumenty**, ale bere jeden: prodleva 300 ms a minimum 400 ms jsou v P05 modulové konstanty. **`Checkbox`** měl obsluhu zúženou na `boolean`, přestože Radix předává i `'indeterminate'`.
6. **Sedm mrtvých kontraktů a čtyři nepravdivá tvrzení.** `ErrorBlock`, `Alert`, `StaleBanner`, `StaleContent`, `TableSkeleton`, `DetailSkeleton` a `ForbiddenState` byly v typových deklaracích, ale P06 je nikde nevykresloval, a tabulka U4 přesto u čtyř z nich uváděla konkrétní místo použití. Všech sedm je teď **skutečně vykreslených**: chybový blok i stav bez oprávnění se přestaly kreslit ručně a duplikovat komponenty z P05, kostry používají obě skeletony, upozornění u vypnutého webhooku je `Alert` a stav S7 nad auditem konečně existuje, ne jen jako texty v katalogu. Ze stejného důvodu vypadlo z kontraktu deset primitiv, která P06 nevykresluje, a tvrzení o komponentě K1 se srovnalo s kódem: **tabulky si P06 kreslí sám** a rozhodnutí, jestli se to má změnit, je nález N59 v evidenci.

### 11.3 Rozpory se specifikací, které plán řeší vědomě

| Místo | Rozpor | Řešení |
|---|---|---|
| Odebrání člena | 6.2 části 6 dává N1 s vrácením, ale API vrácení neumí | R7: potvrzení N2 s větou o nové pozvánce |
| Audit log | Řídicí dokument čeká K8, 5.3 části 1 čeká tabulku s filtry | R3: tabulka, K8 se nepoužije |
| Obrazovka Zálohy | 5.3 části 1 ji má, kapitola 5 řídicího dokumentu ne | R2: patří P16 s vlastním namespace `backups` |
| Popisek sbaleného bloku | „Technické detaily" versus „Podrobnosti pro technickou podporu" | R6: kratší varianta, obsah podle části 6 |
| `/setup` versus onboarding | 8.1 patří P16, `/setup` patří P06 | R1: hranice je endpoint `POST /api/v1/setup` |
| Selhání sítě | Registr kódů nemá kód pro „neuskutečněný požadavek" | R5: registrované `service_unavailable` a `dependency_timeout`, prázdné `request_id` |

### 11.4 Co plán vědomě nepokrývá

- **Komponentu Centra úloh.** Prezentační vrstvu (`JobsCenter`, odznak v topbaru) dodává P05 svým rozhodnutím R4 a data k ní P04 svým úkolem 45. P06 do žádné z nich nezasahuje. **Stránku detailu úlohy ale dodává** (úkol 34): P04 obrazovky nepíše žádné a bez ní by odkaz z Centra úloh vedl nikam. Rozhodnutí je v evidenci jako nález N30.
- **Vlastní zdroj úloh.** Registr zdrojů z P04 zůstane po P06 prázdný a je to správný stav. Jediná dlouhoběžná úloha, kterou P06 spouští, je přepočet 5. pádu po přepnutí oslovení, jenže tabulku postupu k ní vlastní P07. Registrace zdroje by znamenala číst cizí tabulku.
- **Předání vlastnictví projektu.** Endpoint `POST /api/v1/workspaces/{id}/transfer-ownership` existuje a vyžaduje re-autentizaci heslem. Zadání kapitoly 5 řídicího dokumentu ho u P06 nevyjmenovává a 5.3 části 1 ho u obrazovky Projekt neuvádí. Obálka `apiMutate` na něj má připravený parametr `reauthPassword` a test v úkolu 5 ho pokrývá, ale obrazovka pro něj v P06 nevzniká. Kdo ho bude chtít, přidá ho jako rozšíření úkolu 22.
- **Obnovení smazaného projektu.** `POST /api/v1/workspaces/{id}/restore` je operace pro třicetidenní okno. Uživatel se k ní z rozhraní nedostane, protože po smazání skončí na `/no-workspace` a projekt už nevidí. Patří do P16 spolu s obnovou ze zálohy.
- **Živé aktualizace.** Infrastrukturu SSE vlastní část 5. Žádná obrazovka P06 na živém spojení nezávisí a po jeho výpadku funguje dál, jak žádá 5.4 části 1.

