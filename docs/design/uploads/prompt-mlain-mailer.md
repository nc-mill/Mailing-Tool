# Zadání: prezentační web Mlain Mailer

## Kontext produktu

Mlain Mailer je **hotová, instalovatelná** open-source aplikace pro e-mailový marketing: **completely free & self-hosted**, MIT licence, žádný licenční klíč, žádné feature gates, žádné limity na počet uživatelů ani kontaktů, nikdy „nevolá domů". Kód je na GitHubu. Čtyři pilíře: Messaging (kampaně, šablony, plánování, transakční e-maily), Customer profiles (kontakty, vlastní pole, segmenty), Behavioural tracking (opens, clicks a hlavně **co se děje na webu po prokliku** — vlajková funkce), Automation (triggery a sekvence).

**Cílové publikum:** (a) AI/tech nadšenci, kteří si nástroj chtějí vyzkoušet, (b) programátoři a DevOps lidé, kteří ho nasadí pro firmu nebo agenturu (více klientů na jedné instalaci). Web musí budovat důvěru u technicky zdatných, self-hosting smýšlejících návštěvníků.

**Design system pro víc webů:** tenhle web je první z řady prezentačních webů našich aplikací. Všechny budou sdílet **stejné logo**, liší se vždy jen **název aplikace** vedle loga. Navrhni proto tokeny a komponenty obecně (ne „mailerově"), a název aplikace v hlavičce/patičce řeš jako snadno vyměnitelný textový prvek vedle loga — ne jako součást grafiky loga.

**Logo zatím nemáme.** Na jeho místě použij dummy — jednoduchou lokální SVG značku (např. abstraktní symbol mlýnského kola / mlýna v barvách webu), uloženou v `assets/img/` s poznámkou, že se nahradí finálním logem. Protože název aplikace nebude součástí loga, pracuj s textem **„Mlain Mailer" jako s plnohodnotným, dobře viditelným prvkem identity**: v hlavičce vysazený výrazně vedle značky (typografie z tokenů, ne obrázek), stejně tak v patičce a v hero. Logo je jen doplněk — nositelem jména je text, a musí to tak fungovat i po výměně dummy značky za finální logo.

## Tón a jazyk obsahu

Veškerý obsah webu je **anglicky**. Tón: věcný, konkrétní, poctivý. Čísla a fakta místo adjektiv („$1 per 10,000 emails", „2 GB RAM" — nikdy „powerful", „seamless", „next-generation"). Žádná vymyšlená testimonials, žádná loga zákazníků, žádné vymyšlené počty uživatelů. Poctivost je tady marketingový nástroj — přiznat kompromisy (např. limity SMTP) působí u této cílovky líp než nadšení.

## Stránky

Kromě `styleguide.html`, `komponenty.html` a `default.html` (dle závazných požadavků níže) vytvoř:

1. **`index.html`** — homepage (sekce viz níže)
2. **`changelog.html`** — výpis změn aplikace
3. **`docs.html`** — zatím jen placeholder (viz níže)

Menu: **Features · How it works · Pricing · Install · FAQ** (kotvy na homepage) **· Docs · Changelog** + tlačítko **GitHub** vpravo (odkaz `https://github.com/nc-mill/Mailing-Tool`).

---

## Homepage — sekce v tomto pořadí

### 1. Hero
- Vlevo text, vpravo **koláž 2–3 screenshotů aplikace** (zatím dummy — neutrální placeholdery zasazené do „app window" rámečku, ať nevypadají jako díra v layoutu; poznámka v kódu, že se nahradí reálnými screenshoty).
- Headline (návrh): **„Email marketing you host yourself. Free forever."**
- Subheadline: „Mlain Mailer is a completely free & self-hosted email marketing tool — campaigns, contacts, behavioural tracking and automation. MIT licensed, every feature included, code on GitHub."
- CTA: primární **„View on GitHub"**, sekundární **„Live demo"** (URL zatím `#`, doplníme).
- Trust strip pod CTA (drobně, jeden řádek): `MIT license · No feature gates · Never phones home · Docker Compose install`

### 2. Feature grid
6 boxů, každý: nadpis + 2 věty, kde to jde s tvrdým číslem. Ne u každého ikona — jen kde pomáhá. Obsah:

1. **Drag & drop editor** — Build emails from blocks; never touch HTML. Every drag action has a keyboard equivalent.
2. **AI assistant, on your own key** — Describe the campaign, get a draft. Bring your own OpenAI, Anthropic, Google or OpenRouter key — typically €0.05–0.20 per newsletter, paid to them, not us. Optional; nothing depends on it.
3. **Segments made of sentences** — No AND/OR logic trees. Pick conditions in plain language, see the live count and five real people who match.
4. **Import that survives messy data** — Encoding and delimiter detected automatically, per-row errors you can download, fix and re-upload. Ten broken addresses don't reject a file of a thousand.
5. **Deliverability that protects you** — Automatic suppression list that can't be switched off, and an automatic brake: a campaign pauses itself at 8 % bounces or 0.3 % complaints, long before Amazon suspends your account. SPF, DKIM and DMARC generated with copy buttons.
6. **Twelve clients, twelve walls** — One installation, many projects. An API key belongs to exactly one project — a key for client A physically cannot read client B's contacts. Each project has its own sending account and reputation.

### 3. Tracking / timeline — vlajková sekce, dej jí nejvíc prostoru
- Headline (návrh): **„See what happens after the click."**
- Perex: „Most tools stop at opened and clicked. Mlain Mailer links the click in the email to what the person actually did on your site — pages, products, basket — in one timeline you can read."
- Hlavní vizuál: **typografický monospace blok** (žádná stock ilustrace), např.:

```
jana@example.com

14:02  received campaign "Summer Sale"
14:07  opened the email
14:07  clicked "Shop the sale"
14:07  visited /sale
14:09  viewed product "Alpha 42 sneakers"
14:11  added to basket (€59)
14:12  left
```

- Pod tím jedna věta: „And then you can act on it: everyone who reached the basket and didn't buy within 24 hours gets a reminder."
- Podsekce **„How the link is made"** — 4 kroky, technicky a stručně: (1) a single-use key valid for 15 minutes is attached to links in the email, (2) your site's script picks it up and confirms it with your server, (3) the key is stripped from the URL immediately so it can't be copied or shared, (4) it is only ever added to domains you have registered yourself. The tracking script is under 5 kB and served from your own subdomain.

### 4. Cost comparison — „What it actually costs"
- Headline (návrh): **„The software is free. Here's the whole bill."**
- Vizuál: **srovnávací graf** (sloupcový, čistě HTML/CSS, bez JS knihoven) + pod ním **tabulka s přesnými čísly** — pro tuhle cílovku je tabulka důvěryhodnější než graf, dej obojí.
- Osy: velikost listu **10 000 / 50 000 / 100 000 kontaktů**, měsíční cena. Řada Mlain Mailer barevně zvýrazněná.
- Data (list prices, mid-2026 — uveď u grafu poznámku „List prices as of mid-2026, sources on request"):

| Tool | 10,000 | 50,000 | 100,000 |
|---|---|---|---|
| Mailchimp Standard | $135/mo | $450/mo | $800/mo |
| Klaviyo | $150/mo | $720/mo | $1,380/mo |
| Kit (ConvertKit) Creator | $119/mo | — | — |
| Sendy | $69 one-time + AWS SES | $69 + SES | $69 + SES |
| **Mlain Mailer + Amazon SES** | **~€7/mo** | **~€14/mo** | **~€24/mo** |
| **Mlain Mailer + your own SMTP** | **~€5/mo** | **~€5/mo** | **~€5/mo** |

- Výpočet Mlain řádků vypiš pod tabulkou: €5/mo server (2 cores, 2 GB RAM) + Amazon SES at $1 per 10,000 emails, assuming two sends a month. With your existing hosting's SMTP, sending costs effectively nothing.
- **Poctivostní disclaimer** (povinný, drobným písmem pod grafem): „These are list prices for hosted tools. Mlain Mailer's figure does not include your time to install, update and maintain it — self-hosting trades money for responsibility. Hosted tools also bill by contact even for unsubscribed addresses; billing models differ, so compare carefully."

### 5. Install
- Headline (návrh): **„One command to install. €5/month to run."**
- Kopírovatelný snippet: `docker compose up -d`
- Dvě karty vedle sebe (odesílací kanály):
  - **Amazon SES** — about $1 per 10,000 emails. Reports bounces and complaints back, which powers the automatic protection. Recommended above ~2,000 emails a day.
  - **Your own SMTP** — the SMTP from your existing hosting works and costs effectively nothing. Recommended up to ~2,000 emails a day. Honest note: most SMTP providers don't report bounces and complaints back, so you lose part of the automatic protection — the interface says so too.
  - Krátká zmínka, že jde napojit i další alternativy (any provider speaking SMTP).
- Řádek s požadavky: `Linux server with Docker · 2 cores, 2 GB RAM, 20 GB disk · domain + TLS`
- Řádek k provozu: „Updates are `docker compose pull && docker compose up -d`. Nightly backups, kept 14 days, automatically restore-tested."
- Odkaz **„Read the docs →"** na `docs.html`.

### 6. Roadmap — jen krátké nakouknutí, ne dlouhý výpis
- Kompaktní sekce (výrazně menší než ostatní): headline např. **„What's done, what's next"**, pak jeden úzký seznam ~6 položek se štítky. Štítky jako textové badge komponenty: **Done / In progress / Planned**.
  - Done — block editor, segments, campaigns & reports
  - Done — customer timeline & website tracking
  - Done — Amazon SES & SMTP sending, suppression list
  - In progress — visual automation builder
  - In progress — A/B testing
  - Planned — WooCommerce & Shopify connectors, importers from Listmonk and Mautic
- Jedna uzavírací věta + odkaz: „The full picture lives in the open — follow the repository on GitHub."

### 7. FAQ
`<details>`/`<summary>` akordeon. Otázky a jádro odpovědí:

- **Is it really free?** — Yes. MIT license, every feature in the public repository. No license key, no seat limit, no feature gate, no Enterprise edition.
- **How will you make money?** — Later, from hosting, support and migrations — never from unlocking features.
- **SES or my own SMTP — which should I use?** — Your hosting's SMTP up to ~2,000 emails a day; Amazon SES above that, because it reports bounces and complaints back.
- **What do I need to run it?** — A Linux server with Docker, 2 cores, 2 GB RAM, 20 GB disk, a domain and a TLS certificate.
- **Can I run multiple clients on one installation?** — Yes. Projects are isolated down to the API key and the database; each has its own sending account.
- **How do I get my data out?** — CSV export, a full REST API, and direct access to your own PostgreSQL database. It's your server.
- **Does it work in languages other than English?** — Czech and English are complete, with the structure ready for more.

### 8. Závěrečné CTA + patička
- Headline (návrh): **„Built in the open, for people who'd rather own their stack."**
- CTA: `View on GitHub` · `Live demo`
- Patička: Docs · Changelog · GitHub · MIT License · Contact. Bez dalších právních odkazů.

---

## changelog.html

- Formát **Keep a Changelog**: nejnovější nahoře, nadpis verze `## 1.2.0 — 2026-07-14`, pod ním kategorie **Added / Changed / Fixed / Security** (jen ty, které mají obsah).
- Psát pro uživatele, ne commit messages: „Import now detects Windows-1250 encoding automatically", ne „fix(import): cp1250 detection".
- Naplň **2–3 ukázkovými verzemi** s realistickými položkami odpovídajícími funkcím výše (editor, import, segmenty, doručitelnost, timeline) — jsou to placeholdery, které nahradíme reálnou historií; ať je to v kódu poznat z hodnot, ne z komentářů.
- Úvodní věta stránky: „Every release, in plain language. For the commit-level history, see GitHub."

## docs.html

- Použij layout `default.html` (centrovaný obsah). Obsah zatím jen nadpis **Documentation** a jeden odstavec: „Full documentation — installation, configuration, sending setup and the REST API reference — is being written and will appear here. Until then, the README on GitHub covers installation and first steps." + odkaz na GitHub.

---

## Poznámky k vizuálu

- **Celkový charakter: jednoduchý, dobře čitelný a prostorný.** Hodně vzduchu — velkorysé mezery mezi sekcemi i uvnitř nich, obsah nehustit. Čitelnost má přednost před efektem: dostatečné velikosti písma pro běžný text, rozumná délka řádku, jasná hierarchie. Málo vizuálních vrstev — žádné zbytečné rámečky, stíny a dekorace; sekce od sebe odděluj především prostorem a klidnou změnou pozadí. Když váháš mezi ozdobnějším a jednodušším řešením, vyber jednodušší.
- **Barevnost: pastelové tóny, žádné křiklavé barvy a žádné gradienty.** Základem palety jsou **odstíny žluté** odkazující k myšlence mlýnu — obilí, mouka, sláma (tlumená obilná žlutá jako primární akcent, k tomu teplé krémové/off-white pozadí a tmavý neutrál pro text). Doplňkové barvy drž rovněž pastelové a tlumené, ať s žlutou ladí a nepřekřikují ji. Pozor na kontrast: žlutá je světlá barva, takže text na žlutých plochách řeš tmavým neutrálem a hlídej WCAG AA — žlutou používej hlavně na plochy, akcenty a zvýraznění, ne na text.
- Screenshoty aplikace zatím neexistují — všude, kde by byly, použij neutrální dummy placeholder v rámečku app okna, s poznámkou v kódu co tam patří. Nikdy stock ilustrace.
- Nejsilnější vizuální prvek webu je **monospace timeline** v sekci 3 — postav vizuální jazyk webu tak, aby monospace/„log" estetika byla záměrný motiv (může se propsat do changelogu, install snippetu, badge v roadmapě), ne cizí těleso.
- Graf v sekci 4 čistě HTML/CSS (žádné chart knihovny), přístupný — data vždy i v tabulce.

---

## Závazné požadavky na design

### 1) Technologie a soubory
- Tvoř výhradně pomocí **HTML, CSS a JS** (žádné frameworky ani preprocesory).
- Veškeré CSS dej do **jednoho souboru `style.css`**, který linkuješ ze všech stránek – je to jediný zdroj pravdy pro design tokeny.
- Web musí být **rovnou použitelný jako statický web** – **bez externích závislostí**: žádné externí knihovny, skripty, styly ani jejich CDN, žádný build. Obrázky jako **lokální soubory**; fonty ideálně taky – jediná povolená výjimka je **dočasný fallback fontů na Google Fonts CDN**, dokud je nestáhnu lokálně (viz bod 5).
- Soubory tvoř v tomto pořadí:
  1. **`styleguide.html`** – design systém / základní kámen (definuje tokeny a základní prvky, viz bod 12).
  2. **`komponenty.html`** – knihovna všech sekcí webu v plném rozsahu (viz bod 12b).
  3. **`default.html`** – jednoduchá stránka s nadpisem a centrovaným obsahem (např. GDPR a jiný obsah, který není designovaný na míru).
  4. **`index.html`** – šablona homepage / landing page, **skládaná z komponent** z `komponenty.html`.

### 2) Reset a kořenové nastavení
- Na začátek `style.css` dej **minimální vlastní reset**: `box-sizing: border-box` na `*`, vynulování výchozích `margin`/`padding`, rozumné výchozí styly. (Slouží jako sdílený základ – v případě WordPressu si ho zrcadlím v Bricks → Global Theme Styles.)
- `html { font-size: 62.5%; }` aby `1rem = 10px` (tedy `16px = 1.6rem`).
- HTML boilerplate: `<!DOCTYPE html>`, `<html lang="cs">`, `<meta charset="utf-8">`, viewport meta, `<title>`, `<meta name="description">`.

### 3) CSS metodologie a pojmenování
- Třídy piš v **BEM** a pojmenovávej je logicky podle účelu sekce/komponenty.
- CSS proměnné ve tvaru `--wm-{typ}__{identifikátor}`, např.: `--wm-color__primary`, `--wm-color__bg`, `--wm-space__lg` (nebo numericky `--wm-space__20`), `--wm-font-size__h1`, `--wm-font-family__heading`, `--wm-line-height__base`, `--wm-radius__sm`, `--wm-shadow__card`.
- Drž jeden slovník velikostí – buď `sm/md/lg`, **nebo** čísla, ne obojí.

### 3b) Komponentní přístup

#### Princip
- **Komponenta = celá sekce**, ne její dílčí části. Pracujeme v **Bricks builderu**, kde je komponenta právě jedna celá sekce – tak to drž i v HTML/CSS, ať se to dá 1:1 přenést.
- Komponenty jsou i **`header` a `footer`** – počítají se do sady.
- **Do počtu komponent se nepočítají základní prvky** – tlačítko, odkaz, nadpis, seznam, tabulka, formulářový prvek, karta, ikona. To jsou globálně nastylované prvky ze styleguide (body 12), které se uvnitř sekcí jen používají. Karta v gridu je opakující se element komponenty (`.wm-cards__item`), ne samostatná komponenta.
- Web stav z **omezené sady variabilních sekcí**, ne z desítek jednorázových.
- **Proč**: každá komponenta se v Bricks objeví v nabídce klientovi. Deset dobře pojmenovaných variabilních sekcí použije; padesát skoro stejných ho zahltí a přestane je používat správně. Sada má být tak velká, aby klient poznal na první pohled, kterou sekci chce.
- **Počet není strop, ale kontrolní ukazatel.** Orientačně: menší web se obvykle vejde do zhruba 10–15 komponent, rozsáhlejší projekt jich přirozeně potřebuje víc. Rozhoduje pokaždé opodstatněnost, ne číslo.
- Když se sada blíží ~20, **projdi ji a hledej, co jde sloučit do variant** – ne aby se přestaly zakládat potřebné sekce. Pravidlo zní: *napřed zkus variantu, novou sekci zakládej, až když varianta nestačí* (viz níže). Když sekce opravdu nová být musí, ať vznikne.
- **Kořen komponenty** = `<section>` (u navigace `<header>`/`<footer>`) přes celou šířku, nese třídu komponenty a barvu pozadí; uvnitř je kontejner, který řeší max. šířku a boční padding dle bodu 6.
- **Komponenta = struktura, ne konkrétní obsah.** Například CTA sekce má obal + volitelné části: eyebrow, nadpis, text, tlačítka, obrázek/pozadí. Když potřebuješ něco podobného, **vyjdi z existující komponenty** a uber/přidej část nebo přepni modifikátor – nezakládej novou.
- Příklad: `cta` bez tlačítka a s menším paddingem = varianta `cta--banner`. Pořád jedna komponenta, dvě varianty.

#### Kdy je to varianta a kdy nová komponenta
Nová sekce je **varianta (modifikátor)**, pokud se liší jen:
- přítomností/nepřítomností některých částí (chybí text, chybí tlačítko, přibyl obrázek),
- barevností nebo pozadím (světlá / tmavá / zvýrazněná),
- zarovnáním a rozložením (na střed vs. do dvou sloupců, obrázek vlevo/vpravo),
- velikostí a hustotou (kompaktní / prostorná).

**Novou komponentu zakládej jen tehdy**, když má sekce opravdu jinou strukturu a chování – jiný typ a počet prvků, opakující se položky, formulář, interakce. Pokud se přistihneš, že kopíruješ existující sekci a měníš v ní pár hodnot, je to modifikátor. A pokud potřebuješ jen jiné tlačítko nebo jinou kartu, není to komponenta vůbec – to řeš na úrovni globálních prvků ze styleguide.

#### Volitelné části (sloty)
- U každé komponenty měj definované, které části jsou **povinné** a které **volitelné**.
- Volitelnou část, která se nemá zobrazit, **v HTML rovnou vynech** (ne `visibility: hidden` / `opacity: 0` – prvek by zůstal v přístupnostním stromu a zabíral místo). V CMS/Bricks, kde se prvek jen vypíná, použij atribut `hidden`.
- Layout musí vypadnutí kterékoli volitelné části **unést bez díry** – mezery mezi prvky řeš přes `gap` na kontejneru, ne přes `margin-bottom` na jednotlivých prvcích.

#### Značení tříd
- Blok = název komponenty, **s prefixem `wm-`** (ať nekoliduje s třídami WordPressu a pluginů), elementy a modifikátory dle BEM:
  - `.wm-cta`, `.wm-cta__title`, `.wm-cta__text`, `.wm-cta__actions`
  - `.wm-cta--inverse`, `.wm-cta--compact`, `.wm-cta--banner`
- **Kořen každé sekce nese třídu komponenty**, i když má minimum vlastních stylů – podle třídy musí být z DOM na první pohled poznat, o jakou komponentu a variantu jde.
- **Modifikátor patří jen na kořen komponenty**; elementy se řídí kaskádou (`.wm-cta--inverse .wm-cta__title`), ne vlastními modifikátory na každém elementu.
- Max. dvě úrovně BEM – `.wm-cta__title`, nikdy `.wm-cta__header__title`.
- Volitelně navíc `data-component="cta" data-variant="banner"` na kořeni – usnadní orientaci při ladění; třídy jsou ale primární.
- **Název komponenty musí být srozumitelný klientovi**, ne jen kodérovi – pojmenovávej podle toho, k čemu sekce slouží (`wm-cta`, `wm-reference`, `wm-cenik`), ne podle vzhledu nebo pořadí (`wm-section-3`, `wm-modry-blok`). V Bricks je to jediné, podle čeho se klient rozhoduje.

#### Variabilita přes lokální proměnné
- Komponenta **nemá natvrdo zapsané barvy a velikosti** – bere je z globálních tokenů přes vlastní lokální proměnné. Modifikátor pak přepisuje jen ty proměnné, ne celé bloky pravidel:
  ```css
  .wm-cta { --cta-bg: var(--wm-color__bg); --cta-fg: var(--wm-color__text); }
  .wm-cta--inverse { --cta-bg: var(--wm-color__primary); --cta-fg: var(--wm-color__bg); }
  ```
- Díky tomu nevzniká duplicitní CSS a přidání varianty je pár řádků.

#### Poznámka k designu
Komponentní přístup **neomezuje originalitu** – tu dělá typografie, barevnost, rytmus a detaily, ne počet unikátních sekcí. Systém jen zajišťuje, že na webu nevznikne deset skoro stejných variant téhož vzoru. Návrh dělej tak, aby sekce od začátku vznikaly jako varianty společných vzorů.

### 4) Jednotky
- Používej primárně **px, %, rem, fr** (fr v gridech). Viewport jednotky (`vw`/`vh`) používej uváženě – v `clamp()` pro fluidní typografii a u sekcí tam, kde to dává smysl (např. výška hero). Neomezuj je striktně jen na `clamp()`.
- Spacing v **px**, v násobcích 5 (15, 20, 100…). Generuj jen ty hodnoty, které reálně použiješ.

### 5) Typografie
- **Písma vybírej z Google Fonts** (subset **latin-ext**). Preferuj **lokální self-hosting** – `woff2` + `@font-face` s `font-display: swap`, bez CDN i `preconnect`. Pokud v prostředí nejde binární `woff2` stáhnout a rovnou použít, **načti font jako fallback z Google Fonts CDN** (ať se web hned vykreslí), ale **`@font-face` blok stejně připrav** a doplň poznámku, kam `woff2` nahrát – fonty si pak stáhnu lokálně a CDN link odeberu.
- Celkem **3–5 řezů písma** (ideálně 3).
- Velikosti písma (a kde mají být responzivní) řeš přes `clamp(min, preferovaná, max)`, kde prostřední hodnota je `rem + vw` – plynulý růst, který přežije zoom. Příklad: `font-size: clamp(2.4rem, 1.5rem + 2vw, 3.6rem);`.
- **`line-height` zadávej bezrozměrně** (např. `1.5` = řádkování v px ÷ velikost písma v px). Díky tomu se při fluidní velikosti přes `clamp()` řádkování škáluje samo – `clamp()` na line-height nepoužívej.
- Doplň fallback font stack s podobnými metrikami, ať swap necuká layoutem.

### 6) Layout a responzivita
- Návrh dělej **desktop-first**, media queries přes `max-width`, s **co nejmenším počtem breakpointů**.
- Definuj max. šířky kontejneru a obsahu; použité breakpointy vypiš ve styleguide.
- **Boční padding kontejneru**: **40px** na desktopu, **20px** pod **760px** (`@media (max-width: 760px)`). Drž tyhle hodnoty konzistentně napříč šablonami.
- Prvky, které se drží s obrazovkou (fixní hlavička, plovoucí lišta apod.), dělej **primárně přes `position: sticky`**; `position: fixed` použij, jen když sticky nestačí.
- Respektuj `@media (prefers-reduced-motion: reduce)` – animace omez/vypni.

### 7) Přístupnost (WCAG 2.2 AA)
- **Viditelný focus** na všech interaktivních prvcích.
- Sémantické landmarky (`header`/`nav`/`main`/`footer`), jeden `<h1>`, správná hierarchie nadpisů (viz bod 8).
- **Skip-link** „Přeskočit na obsah".
- `<button>` pro akce vs. `<a>` pro přechod na URL – neprohazovat.
- Smysluplný `alt`; dekorativní obrázky `alt=""`.
- ARIA střídmě – nejdřív nativní element, ARIA až když žádný nesedí.
- **Pořadí v DOM = pořadí čtení** – nepřehazuj obsah jen přes CSS (`order`) tak, aby se vizuální a logické pořadí rozešlo.

### 8) Struktura HTML a nadpisy
- **Jeden `<h1>` na stránku** = hlavní téma. Nepřeskakuj úrovně (h1 → h2 → h3). Úroveň = význam v osnově, **ne velikost** – vizuál řeš přes CSS třídy.
- `<section>` = tematický celek (ideálně s nadpisem); `<div>` = jen stylovací obal bez významu.
- `<article>` pro samostatně dávající smysl obsah, `<aside>` pro vedlejší.
- `<figure>`/`<figcaption>`, `<time datetime="">`, `<address>`, `<dl>` pro dvojice název–hodnota, `<details>`/`<summary>` pro FAQ/akordeon.
- Seznamy reálně jako `<ul>/<ol>/<li>` (i menu je seznam).
- Tabulky: `<caption>`, `<thead>/<tbody>`, `<th scope="col|row">`.
- Navigaci dávej do `<nav>`; víc navigací (hlavní, patička…) odliš přes `aria-label`.

### 9) Obrázky
- **Všechny obrázky stahuj a ukládej lokálně do `assets/`** – žádné hotlinkování na cizí URL, žádné externí CDN ani placeholder služby (`images.unsplash.com/…`, `placehold.co`, `via.placeholder.com` apod.). V HTML odkazuj vždy relativní cestou do `assets/`.
  - fotky a grafika → `assets/img/`
  - ikony → `assets/icons/` (viz bod 9b)
  - favicon a social image → `assets/img/`
- **Pojmenování souborů**: malými písmeny, bez diakritiky, kebab-case, popisně podle obsahu (`hero-kavarna-interier.webp`), ne `IMG_2043.jpg`.
- Pokud v prostředí **nejde binární soubor stáhnout**, vlož na jeho místo **lokální placeholder** (SVG se správným poměrem stran) a doplň poznámku, jaký obrázek tam patří včetně zdrojové URL a licence. Externí URL v kódu nezůstává nikdy.
- **Zdroj fotek**: kde se hodí reálná fotografie (ne ilustrace), použij volně dostupné snímky, ideálně z Openverse (`https://openverse.org/`). Hlídej licenci – preferuj CC0 / public domain; u licencí s podmínkou (např. CC BY) doplň požadovanou atribuci.
- Ke staženým fotkám veď evidenci v `assets/img/CREDITS.md`: název souboru, autor, zdrojová URL, licence. U CC BY musí být atribuce i na stránce (např. v `<figcaption>` nebo v patičce).
- Obrázky na pozadí dělej jako **`<img>` element** (typicky absolutně pozicovaný), **ne** jako CSS `background-image` – kvůli lazy-loadu a prioritizaci. Výjimka: **opakované/dlaždicové pozadí** → `background-image` + `background-repeat`.
  - U bg-elementu: rodič `position: relative`; obrázek `position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;` + `object-position`; dekorativní → `alt=""`; `pointer-events: none`; obsah dej do vrstvy s vyšším `z-index`.
- Vždy `width` + `height` atributy (nebo `aspect-ratio` v CSS) – kvůli CLS.
- Obrázky pod foldem: `loading="lazy"` + `decoding="async"`.
- **LCP / hero obrázek**: `loading="eager"` + `fetchpriority="high"` (jako element preload nepotřebuje).
- Preferuj **WebP/AVIF**; u klíčových obrázků `srcset`/`sizes`.
- `<iframe>` (mapy, YouTube): `loading="lazy"`.

### 9b) Ikony

#### Zdroje a formát
- Ikony dělej **výhradně jako SVG**. **Žádné icon-fonty**, žádné ikonové knihovny, žádné CDN.
- Povolené zdroje jsou pouze:
  - **Google Material Symbols / Icons** – `https://fonts.google.com/icons` (hlavní sada),
  - **Boxicons** – `https://boxicons.com/` **jen pro loga sociálních sítí** (sada `bxl-*`).
- Drž **jeden vizuální styl** Material Symbols napříč celým webem (např. Outlined, weight 400, grade 0, optical size 24, fill 0) – styly nemíchej, jinak se ikony rozejdou v tloušťce tahu.
- Ikony **neukládej do spritu**. Každá ikona je **samostatný soubor** v `assets/icons/` a zároveň musí být samostatně platný SVG dokument (s `xmlns`), aby šel otevřít i použít přes `<img>`.
- **Dvě podoby téže ikony** (stejný `viewBox`, stejné tvary, liší se jen barevný atribut):
  1. **v HTML inline** – s `currentColor` (produkční použití, viz Barvy),
  2. **uložený soubor** v `assets/icons/` – s **hex barvou**, aby se korektně vykreslil i samostatně / přes `<img>`, kde `currentColor` nefunguje.

#### Ukládání a pojmenování
- Všechny ikony ukládej do **`assets/icons/`**.
- Název souboru: **prefix `icon_`** + kebab-case, malými písmeny, bez diakritiky → `icon_arrow-right.svg`, `icon_close.svg`, `icon_phone.svg`, `icon_facebook.svg`.
- Plná cesta tedy např. `assets/icons/icon_arrow-right.svg`.

#### Čtvercová mřížka a ochranná zóna
- Každá ikona sedí ve **čtvercové mřížce `viewBox="0 0 24 24"`**.
- **Ochranná zóna 2px** po obvodu → živá plocha kresby **20×20**. Do ochranné zóny kresba nezasahuje (výjimkou je jen optické dorovnání, ať ikona nepůsobí menší).
- Díky jednotné mřížce + ochranné zóně mají všechny ikony **stejnou optickou velikost** a nebude docházet k rozjetým velikostem. Velikost se pak řídí **jen v CSS**.
- Boxicons mají také mřížku 24×24. Pokud nějaký zdroj dodá jiný `viewBox` (např. `0 0 512 512`), **přepočítej / vlož ikonu do mřížky 24×24** se stejnou ochrannou zónou.
- Ve styleguide ukaž ikony **s vyznačenou mřížkou a ochrannou zónou** (viz bod 12).

#### Barvy
**Jednobarevná ikona**

- **V HTML (inline): vždy `fill="currentColor"`** (u linkových ikon `fill="none"` + `stroke="currentColor"`) – ikona dědí barvu textu a funguje ve všech stavech (`hover`, `focus`, inverzní sekce, forced-colors).
- **V uloženém souboru: stejná ikona s hex barvou** – hodnota výchozí barvy ikon z tokenů (`--wm-color__icon`, typicky shodná s `--wm-color__text`), zapsaná velkými písmeny v šestimístném tvaru, např. `fill="#1A1A1A"`. Nikdy `fill="black"` ani zkrácený `#000`.
- **Barevný atribut piš jen na kořenový `<svg>`**, ne na jednotlivé `<path>` – přepnutí mezi oběma podobami je pak výměna jedné hodnoty:
  - soubor: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#1A1A1A"><path d="…"/></svg>`
  - inline: `<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="…"/></svg>`
- Cesty tedy **nesmí nést vlastní `fill`/`stroke`** (jinak by root atribut nic nepřebil a přepnutí by nefungovalo). Výjimka jen u vícebarevných ikon.

**Vícebarevná ikona** (typicky brand logo v barvách sítě)

- Barvy zapisuj **v hex formátu přímo v atributech jednotlivých tvarů** – a to **shodně v souboru i inline** (žádná varianta s `currentColor`).
- Nikdy ne přes `<style>` uvnitř SVG (kolize při inline vložení víc ikon do jedné stránky).

**Synchronizace**

- Soubor v `assets/icons/` je **master** – při každé změně tvaru se mění soubor a inline verze se z něj přepíše. Obě podoby musí mít vždy identický `viewBox` i tvary.
- Když se změní token `--wm-color__icon`, přegeneruj hex ve všech souborech (inline verze se díky `currentColor` mění sama).
- Ve styleguide u ikonové sady uveď, **jaký hex soubory nesou**, ať je jasné, co se vykreslí při použití přes `<img>`.

#### Čistota souboru
- Ponech: `xmlns`, `viewBox`, tvary, `fill`/`stroke`.
- Odstraň: `width`/`height` atributy (velikost patří do CSS), `xmlns:xlink`, komentáře editoru, prázdné skupiny, `<defs>` bez využití, metadata.
- `id` uvnitř SVG buď zruš, nebo prefixuj (`icon_close__title`) – při inline vložení víc ikon na stránku se `id` nesmí opakovat.

#### Velikost a zarovnání v CSS
- Velikost přes tokeny, např. `--wm-icon-size__sm: 1.6rem; --wm-icon-size__md: 2rem; --wm-icon-size__lg: 2.4rem;` (16 / 20 / 24px), nebo `1em`, když má ikona růst s okolním textem.
- `flex-shrink: 0`, aby se ikona ve flexu nedeformovala; u ikon v běžícím textu zarovnej (`vertical-align: middle` nebo flex kontejner s `gap`).
- **Výchozí je inline vložení do HTML** – jen tak ikona dědí barvu textu a mění se na `hover`/`focus`. `<img src="assets/icons/icon_…svg">` použij jen tam, kde je barva fixní a odpovídá hexu uloženému v souboru (`currentColor` se přes `<img>` nedědí).
- Ikonu nikdy nevkládej přes CSS `content` ani jako `background-image` (v režimu vysokého kontrastu zmizí).

#### Přístupnost ikon
*(Vychází z cheatsheetu „SVG Icons – Sprite / Accessibility / CSS Usage" – https://codepen.io/adam-laita/full/zYvXXjd – doplněno o aktuální praxi a WCAG 2.2.)*

- **Dekorativní ikona** (vedle ní je vidět textový popisek, ikona nenese žádnou informaci navíc):
  - inline: `aria-hidden="true"` + `focusable="false"`,
  - přes `<img>`: `alt=""`.
- **Ikona nesoucí význam** (tlačítko nebo odkaz jen s ikonou): přístupný název patří **na `<button>`/`<a>`, ne na SVG**. Samotné SVG uvnitř zůstává `aria-hidden="true"`.
  - Preferovaně **vizuálně skrytý text** uvnitř tlačítka: `<span class="u-visually-hidden">Zavřít</span>` (přeloží ho strojový překlad, chová se jako běžný obsah).
  - Alternativně `aria-label="Zavřít"` na tlačítku.
  - Nikdy obojí zároveň – `aria-label` by skrytý text přebil.
- **Samostatná informační grafika, kde musí být přístupné samo SVG**: `role="img"` + `aria-label="…"`, případně `<title>` s unikátním `id` a `aria-labelledby` na `<svg>`. Samotný `<title>` bez `role="img"` nestačí a **není tooltip** (na tooltip patří `title` atribut na obalu, ale ten nenahrazuje přístupný název).
- Přes `<img>` s významem: smysluplný `alt` (`alt="Zavřít"`).
- **Barva nesmí být jediným nosičem informace**; nosné (informační) ikony a jejich stavy musí mít kontrast **min. 3:1** vůči pozadí (WCAG 1.4.11).
- **Ikonové tlačítko**: klikací plocha **min. 24×24 CSS px** (WCAG 2.2, 2.5.8 Target Size Minimum), doporučeně 44×44 – dorovnej paddingem, ne zvětšením kresby. Viditelný focus stejný jako u ostatních interaktivních prvků.
- **Forced colors / vysoký kontrast**: díky `currentColor` se ikona přebarví sama; nespoléhej na `background-image`.

#### Licence
- Material Symbols / Icons: Apache License 2.0. Boxicons: MIT (ikony).
- Loga sociálních sítí jsou **ochranné známky** – nedeformuj je, respektuj brand guidelines (buď brand barva v hexu, nebo jednobarevná verze v `currentColor`).

### 10) Rychlost vykreslení a JS
- Skripty `defer` nebo `type="module"` (případně na konec `body`).
- `content-visibility: auto` (+ `contain-intrinsic-size`) na dlouhé sekce pod foldem.
- Cíl: optimalizovat **LCP** (priorita hero obrázku/fontu), **CLS** (rozměry obrázků, stabilní fonty), **INP** (minimum deferovaného JS).

### 11) SEO a meta (vyplň natvrdo)
- `<title>`, `<meta name="description">`, `<link rel="canonical">`.
- Open Graph: `og:title`, `og:description`, `og:type`, `og:url`, `og:image` (1200×630 z assetů) + `og:image:width`/`og:image:height`, `og:image:alt`, `og:locale = cs_CZ`.
- X/Twitter: `twitter:card = summary_large_image`, `twitter:title`/`description`/`image`.
- V produkci musí být `og:image` **absolutní URL**.
- `<meta name="theme-color">`.
- **JSON-LD** vkládej inline jako `<script type="application/ld+json">`, **jen když dává smysl**: homepage → `Organization` nebo `WebSite`; `default.html` (GDPR apod.) → vynech.
- Externí odkazy s `target="_blank"`: doplň `rel="noopener"`.

### 12) Obsah `styleguide.html`
Styleguide je referenční základ pro stavbu dalších stránek. Inspiruj se strukturou z `https://www.html-typo.cz/`. Obsahuje:
- **Barvy** – i s názvem CSS proměnné a hodnotou; u gradientů vypiš celou hodnotu.
- **Písma** – názvy a všechny použité řezy.
- **Velikosti** nadpisů i běžných textů (včetně vypsaných hodnot).
- **Spacing** – použité hodnoty.
- **Tlačítka** – včetně stavů `hover`/`focus`/`active`/`disabled`.
- **Seznamy** – číslované i odrážkové.
- **Tabulka**.
- **Citace** (blockquote).
- **Ukázka odstavce** s tučným textem a odkazem v textu.
- **Odkazy** – stavy `hover`/`focus`/`active`/`visited`.
- **Formuláře** – všechny typy prvků (text, textarea, select, checkbox, radio) **včetně stavových hlášek** (chyba/úspěch).
- **Ikonová sada** – všechny použité ikony **v mřížce 24×24 s vizuálně vyznačenou ochrannou zónou** (podklad mřížky jen ve styleguide, ne v produkčních SVG). U každé ikony uveď **název souboru** (`icon_arrow-right.svg`) a **hex barvu, kterou nese uložený soubor**. Doplň ukázku **velikostních tokenů** (sm/md/lg vedle sebe), ukázku **ikony v textu**, **ikonového tlačítka** s přístupným názvem a stavy `hover`/`focus`, a ukázku **vícebarevné ikony** (logo soc. sítě).
- **Favicon** – 512×512 SVG a PNG.
- **Social meta image** – 1200×630 PNG.
- **Přehled komponent (sekcí)** – seznam všech komponent podle bodu 3b včetně headeru a footeru, u každé stručně (1–2 věty):
  - **název bloku** (`.wm-cta`) a k čemu komponenta slouží,
  - **varianty/modifikátory** (`--inverse`, `--compact`, `--banner`) a čím se liší,
  - **volitelné části** (co se dá vynechat – např. text, tlačítko, obrázek).
  U jednodušších komponent dej i malou vizuální ukázku; u velkých sekcí stačí popis a odkaz na stránku, kde jsou použité. Ať je na jednom místě vidět celá sada a nikdo nezakládá komponentu, která už existuje.
- **Layout** – šířky kontejneru a obsahu + výpis použitých breakpointů.

### 12b) Obsah `komponenty.html`
Knihovna sekcí – vedle styleguide druhý referenční soubor. Zatímco styleguide drží tokeny a základní prvky, `komponenty.html` ukazuje **celé sekce, ze kterých se skládají stránky**.

#### Pravidlo plného rozsahu
- Od každé komponenty je na stránce **jedna instance** – ne přehlídka variant.
- Ta instance je v **maximálním rozsahu**: má zapnuté **všechny volitelné části**, které se kdekoli na webu můžou objevit (eyebrow, nadpis, perex, tlačítka, obrázek, popisek, odkaz „více"…). Varianty se z ní pak odvozují ubíráním.
- **Vždy jen jedna instance na komponentu, bez výjimky.** I varianta, kterou nejde vyjádřit ubráním prvků (mění rozložení – např. obrázek vlevo/vpravo), se ukáže jen jednou a **rozdíl se popíše slovy v popisku** (viz níže). Počet sekcí na stránce = počet komponent.
- Texty piš realistické a spíš **delší** (dlouhý nadpis, dvouřádkové tlačítko, dlouhý perex) – stránka má ukázat, že layout unese i nejhorší případ.

#### Označení a popisky
**Popisek má povinně každá sekce** – je to jediné místo, kde se varianty dokumentují, protože na stránce je od každé komponenty jen jedna instance.

- Každou instanci obal blokem s vlastní třídou mimo systém komponent (např. `.sg-item`) a dej k ní popisek `.sg-label` s:
  - **názvem třídy komponenty** (`.wm-cta`),
  - **výčtem variant slovy** – co se v nich mění a jak se jmenuje modifikátor,
  - **výčtem volitelných částí**, které jde vypnout.
- Popisuj i to, co na ukázce není vidět – změny rozložení, pozadí, počtu sloupců. Příklady:
  - `.wm-cta` – *varianty: bez tlačítka; bez perexu; tmavá (`--inverse`); kompaktní jako banner (`--banner`)*
  - `.wm-media-text` – *varianty: obrázek vlevo / vpravo (`--reverse`); bez tlačítka; bez popisku pod obrázkem*
  - `.wm-cards` – *varianty: 2 / 3 / 4 sloupce (`--cols-2`…); karty bez ikony; bez odkazu „více"*
- Popisek dělej jako **sticker/štítek** vizuálně odlišený od designu webu (jiný font/barva, drž ho v `.sg-*` třídách), ať se neplete s obsahem sekce.
- Popisky **nesmí být uvnitř kořene komponenty** – markup komponenty musí zůstat čistý, aby se dal zkopírovat 1:1 do stránky nebo do Bricks.
- Nahoře dej jednoduchý obsah (kotvy na jednotlivé komponenty), ať se v tom dá orientovat.

#### Pořadí a rozsah
- Komponenty řaď v logickém pořadí, v jakém se na stránkách staví: header → hero → obsahové sekce → CTA → footer.
- **Header a footer stránky slouží zároveň jako jejich ukázka** – neduplikuj je uvnitř `<main>` (dvě `<header>` v roli landmarku by rozbily orientaci); jen je označ popiskem.
- Soubor je **živý** – jakmile vznikne nová komponenta nebo nová volitelná část, doplní se sem. `index.html` a další stránky se skládají z toho, co je tady.

#### Sémantika a meta
- **Nadpisy v sekcích nech přesně tak, jak mají být v produkci** – hero má `<h1>`, ostatní sekce `<h2>`/`<h3>`. Že bude na stránce víc `<h1>`, nevadí: `komponenty.html` je interní knihovna, nikdy nebude veřejná a markup se z ní kopíruje 1:1. Přepisování úrovní by do stránek zaneslo špatné nadpisy.
- `komponenty.html` i `styleguide.html`: `<meta name="robots" content="noindex, nofollow">`, bez JSON-LD a bez Open Graph.
- Ze styleguide odkaž na `komponenty.html` a naopak.

### 13) Assety
- Struktura: `assets/img/` (fotky a grafika, favicon, social image, `CREDITS.md` s licencemi), **`assets/icons/`** (ikony, jeden soubor na ikonu, prefix `icon_`), `assets/fonts/` (self-hostované `woff2`).
- **Nic se nenačítá z cizí domény** – všechny obrázky, ikony i fonty leží v `assets/` a odkazuje se na ně relativní cestou (jediná dočasná výjimka je fallback fontů z Google Fonts CDN dle bodu 5).
- Favicon a social image odvoď **z loga, pokud existuje**; pokud ne, vytvoř ideálně **SVG**.
- PNG (favicon PNG, social 1200×630) nemusí jít vyrenderovat jako reálný binární soubor – v tom případě dodej SVG a placeholder/poznámku pro pozdější export do PNG.

### 14) Autorský rukopis – ať to nevypadá jako AI

Cíl: výsledek má působit jako práce designéra a kodéra, ne jako vygenerovaná šablona. Nejde o efekt navíc, jde o **vynechání typických znaků**, podle kterých se AI výstup pozná na první pohled.

#### Kód
- **Žádné komentáře v HTML.** Nikdy ne `<!-- Hero Section -->`, `<!-- Footer -->` a podobné oddělovače. Strukturu nese sémantika a názvy tříd.
- V CSS komentář jen tam, kde vysvětluje **proč** je něco takhle (netriviální rozhodnutí, workaround). Žádné dekorativní bannery typu `/* ===== HEADER ===== */`, žádné komentáře opakující, co je z kódu zřejmé.
- Žádné `TODO`, `Add your content here`, zbytky lorem ipsum.
- **Žádné obalové divy navíc** – každý element musí mít důvod k existenci.
- Žádné generické názvy bez významu (`.wrapper`, `.box`, `.content`, `.inner-container`) – třídy pojmenuj podle účelu (bod 3).
- Negeneruj tokeny, třídy ani utility „do zásoby" – jen to, co se reálně používá.
- Žádné emoji v kódu ani v obsahu.

#### Design
- **Eyebrow používej výjimečně** – jen tam, kde nese informaci a sedí ke stylu webu. Není to výchozí prvek každé sekce.
- **Nestřídej pořád stejný rytmus.** Vzorec „eyebrow → nadpis na střed → perex → tři karty s ikonou" je nejtypičtější znak generovaného webu. Střídej zarovnání (na střed používej výběrově, ne jako výchozí), počet sloupců, poměr obrazu a textu.
- Vyhni se vizuálním klišé: fialovo-modré gradienty, gradientové nadpisy, glassmorphism, „glow" efekty, výchozí paleta Tailwindu (`#6366F1`, `#8B5CF6`), stejné zaoblení 16px a měkký stín na úplně všem.
- **Ne každý blok je karta.** Oddělení sekcí řeš i jinak – pozadím, linkou, změnou rytmu, prostorem.
- **Ikona nemusí být u každé položky.** Ikony dávej tam, kde pomáhají orientaci, ne jako dekoraci každé odrážky.
- Animace střídmě – žádné hromadné fade-in na scroll u všech sekcí.
- Nevymýšlej si čísla, reference ani loga klientů („10 000+ spokojených zákazníků"). Placeholder ať je jako placeholder poznat.
- **Osobitost tvoř tam, kde vzniká doopravdy**: výrazný kontrast velikostí písma, netradiční ale funkční řez, barevnost mimo výchozí paletu, rytmus a hustota sekcí, detaily (linky, přesahy obrázků, asymetrie, práce s prázdným místem).
- Jedna záměrná odchylka na webu (hero, které se chová jinak než zbytek) udělá víc než pět efektů navíc.

#### Texty
- Piš přirozenou češtinou a konkrétně. Vyhni se frázím typu „V dnešní době", „Objevte", „Vaše cesta k úspěchu", „nejen…, ale i", trojicím adjektiv za sebou a superlativům bez obsahu.
- Tlačítka: konkrétní sloveso a předmět („Chci nabídku", „Stáhnout ceník"), ne „Zjistit více" u všeho.
- Nadpisy sekcí ať říkají něco konkrétního, ne „Naše služby / Proč my / Reference" u každého projektu.
- Délky textů dělej nepravidelné – tři karty se stejně dlouhým textem na řádek přesně vypadají generovaně.

#### Kontrola před odevzdáním
Projdi výsledek a zeptej se:
1. Nejsou v HTML komentáře a zbytečné divy?
2. Nemá víc než jedna sekce stejný vzorec (eyebrow → střed → tři karty)?
3. Byl by web rozeznatelný od jiného webu ve stejném oboru, kdybych vyměnil logo?
4. Jsou texty konkrétní, nebo by seděly komukoli?
