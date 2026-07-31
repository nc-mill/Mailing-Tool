# Specifikace: open-source e-mailingový a customer engagement nástroj

Název produktu: **Mlain Mailer** (ROZHODNUTO zadavatelem 2026-07-31)
Repozitář: https://github.com/nc-mill/Mailing-Tool
Datum: 2026-07-31
Zdroje: `docs/Reference-konverzace.txt`, `docs/transcribe.txt`
Stav: návrh k připomínkám, žádný kód se zatím nepíše

**Revize 2 (2026-07-31):** zapracována rozhodnutí z připomínek. Odesílací engine je oddělený jako kompilovaná binárka (3.1, 3.3, 4.5), licence je MIT místo AGPL (kapitola 9), SES účet je vyřízen, pg-boss zůstává pro aplikační joby (3.5). Nově doplněna práce se jmény a českým vokativem (6.3).

---

## 1. Produktová pozice

Plně open-source, self-hosted platforma pro e-mail marketing, která propojuje čtyři rovnocenné části:

```
Messaging  +  Customer profiles  +  Behavioral tracking  +  Automation
```

Jednou větou: **jednoduchá jako Ecomail, otevřená a provozovatelná jako Listmonk.**

Železná pravidla produktu, se kterými se nesmlouvá:

1. Všechny funkce jsou v open-source edici. Žádné Enterprise moduly, žádný feature gate, žádný licenční klíč.
2. Instalace je `docker compose up` a do pěti minut běží použitelný nástroj.
3. Update je `docker compose pull && up -d`. Image je hotová binárka, konfigurace a data zůstávají venku.
4. Nulová povinná komunikace s naším cloudem. Ani SDK, ani ingestion, ani AI.
5. API-first. Cokoliv jde v UI, jde přes REST API.

Monetizace (později) stojí na hostingu, SLA, migracích a podpoře, ne na odemykání funkcí.

### Co nás odlišuje

- Web behavior tracking spojený s kontaktem, ne jen open/click. Bez toho je to jen modernější Sendy.
- Customer timeline, která srozumitelně ukazuje **proč** se automatizace spustila.
- AI asistent pro stavbu šablon s vlastním klíčem uživatele (bring your own key).
- Multi-projekt s odděleným API klíčem a vlastním odesílacím účtem na projekt.
- SES bez bolestivé konfigurace, včetně kontroly SPF/DKIM/DMARC přímo v UI.

---

## 2. Rozsah

### 2.1 Potvrzené požadavky z přepisu

Tyhle věci vyplynuly přímo z vaší diskuse a jsou závazné:

| Požadavek | Poznámka |
|---|---|
| Vizuální drag & drop editor | Explicitně ne "plácnu HTML" |
| AI asistent pro šablony, BYOK | OpenAI, Anthropic, Google + OpenRouter |
| Univerzální ozkoušená základní šablona | AI do ní jen vkládá data, nevymýšlí kód |
| Stažení barev a loga z webu klienta | Vstup pro AI asistenta |
| Multi-projekt, API klíč per projekt | Klíč nesmí vidět do jiného projektu |
| Vlastní SES účet na projekt | Kvůli oddělení reputace a přeúčtování |
| Amazon SES + obecné SMTP | SES jako první třída |
| Tracking otevření, kliknutí + chování na webu | Web SDK, navázání na kontakt po kliku v mailu |
| Bounce, complaint, suppression list | Není volitelné, je to podmínka SES |
| Double opt-in, unsubscribe | Základ |
| Custom fields a personalizační proměnné | Merge tagy v šablonách |
| **České vokativy v oslovení** | "Dobrý den, Jano", ne "Dobrý den Jana". Jméno a příjmení jako samostatné sloupce |
| Dynamické segmenty, štítky | Query builder |
| CSV import/export | Klasika |
| Embedovatelné formuláře | Ano |
| Landing pages | **Ne** |
| Předpřipravené čištění databáze + reaktivační kampaň | Inspirace Sendy, jako hotový preset |
| Webhooky dovnitř i ven | Objednávka v e-shopu založí a přihlásí kontakt |
| Docker image, volitelně vlastní nebo externí Postgres | Klíčové pro update story |
| Zálohování a upgrade mechanismus | MVP: dump do složky, později Dropbox/S3 |
| Čeština a angličtina, připraveno na lokalizace | i18n od prvního dne |
| Plně reaktivní UI | Živé počty, průběh odesílání |

### 2.2 Vědomé ne-cíle

Nestavíme (ani později, pokud nezmění zadání): landing pages, session replay, heatmapy, kompletní DOM autocapture, fingerprinting, pravděpodobnostní cross-device spojování, cross-site reklamní atribuce.

Nestavíme jako fork Mauticu ani Listmonku. Mautic je funkční reference, Listmonk je reference provozní jednoduchosti. Importér z obou přijde později.

---

## 3. Technologický stack a proč

Rozhodnuto: **aplikační vrstva v TypeScriptu, odesílací engine jako samostatná kompilovaná binárka.**

### 3.1 Rozdělení odpovědnosti

Hranice mezi oběma světy je záměrně vedena tam, kde se mění charakter práce:

| | Aplikace (TypeScript) | Sender (kompilovaná binárka) |
|---|---|---|
| Charakter práce | bohatá doména, časté změny, UI | úzká horká cesta, málo změn |
| Vlastní | UI, API, editor, AI, importy, segmenty, eventy | render per příjemce, MIME, dispatch, throttling, retry |
| Optimalizuje na | rychlost vývoje | propustnost, paměť, předvídatelnost |
| Nasazení | Next.js standalone | statická binárka, image v jednotkách MB |

Klíčový důsledek pro návrh šablon: **render je dvoufázový.**

1. **Kompilace šablony (TypeScript, jednou na kampaň).** Blokový JSON → HTML a plain text, ve kterých zůstanou Liquid placeholdery nedotčené. Uloží se na kampaň.
2. **Interpolace (sender, jednou na příjemce).** Doplnění dat kontaktu, přepis odkazů, vložení pixelu. Jde o čisté řetězcové šablonování, které je triviálně přenositelné.

Tohle není kompromis kvůli rozdělení jazyků, je to lepší architektura sama o sobě. Blokový renderer nikdy nemá běžet milionkrát za kampaň.

### 3.2 Aplikační vrstva

| Vrstva | Volba | Proč |
|---|---|---|
| Frontend | Next.js 16, App Router, React 19, TypeScript | Reaktivní UI, standalone build do image |
| UI kit | Tailwind + shadcn/ui | Rychlost, konzistence, žádný design od nuly |
| API | Route Handlers v Next.js + Hono router pro veřejné API | Jeden proces, sdílené typy |
| Databáze | PostgreSQL, vždy poslední produkční verze (dnes 18) + Drizzle ORM | Typové migrace, partitioning pro eventy, vestavěná `uuidv7()` |
| Fronta aplikačních jobů | **pg-boss** nad Postgresem | Nula dalších kontejnerů, viz 3.4 |
| Šablony a render | Vlastní blokový JSON + `@react-email/components` a `@react-email/render` (MIT) | Hotový renderer včetně hlavičky dokumentu, Outlook konstrukcí a textové varianty; editor vlastní, tenký nad naším JSON modelem |
| Personalizace | LiquidJS | Známý marketérům, bezpečná podmnožina |
| AI | Vercel AI SDK (balíček `ai`) | Jednotné rozhraní pro 4 providery, structured output |
| Tracking SDK | Vanilla TS, < 5 kB gzip | Musí jít vložit kamkoliv |
| i18n | next-intl | Katalogy zpráv, cs + en od začátku |
| Testy | Vitest + Playwright | Rychlé jednotky, E2E na golden path |

**Verze PostgreSQL je pravidlo, ne číslo. ROZHODNUTO.** Projekt cílí na **poslední produkční (stabilní) verzi PostgreSQL**. K 2026-07-31 je to **18**, a to je hodnota, která stojí v Docker image, v testcontainers i v CI. Až vyjde 19 jako produkční, cílem se stává 19 a čísla v dokumentaci se přepíšou. Závazné je pravidlo, konkrétní číslo je jen jeho dnešní hodnota. Dřívější znění téhle tabulky uvádělo 17, což pravidlu neodpovídalo. Vedlejší přínos verze 18: vestavěná funkce `uuidv7()`, na které stojí primární klíče (podrobně v části 1, kapitola 2.1).

### 3.3 Sender: Go. ROZHODNUTO

Volba byla mezi Go a Rustem. Python byl mimo hru, protože chcete kompilovanou binárku, a to je správný požadavek: sender má být jedna statická binárka bez runtime závislostí.

**Zadavatel rozhodl pro Go.** Tři důvody, které rozhodly:

- **Kompilace v jednotkách sekund místo minut.** Na hackathonu je to rozdíl hodin mrtvého času v tom tracku, který má nejvíc integračních nejistot.
- **Výrazně větší základna přispěvatelů.** Stavíme open-source projekt, který má žít z komunity, a lidí schopných poslat PR do Go infrastrukturní služby je řádově víc než u Rustu.
- **Výkonová výhoda Rustu se nemá o co opřít.** Strop určuje kvóta Amazonu, ne jazyk. Zátěž je IO-bound a limitovaná zvenku.

Původní argumentace, která k tomuhle rozhodnutí vedla, zůstává níž pro doložení:

1. **Iterace na hackathonu.** Go se kompiluje v jednotkách sekund, Rust v desítkách sekund až minutách. Za dva až tři dny je to hodiny mrtvého času přesně v tom tracku, který má nejvíc integračních nejistot (SES, SMTP, MIME, throttling).
2. **Přispěvatelé.** Stavíme open-source projekt pod MIT, který má žít z komunity. Základna lidí schopných poslat PR do Go infrastrukturní služby je výrazně větší než u Rustu. U OSS projektu tohle váží víc než syrový výkon.
3. **Zátěž je IO-bound a limitovaná zvenku.** Strop určuje kvóta SES, ne jazyk. Výhody Rustu (paměť, absence GC, předvídatelná latence) se tady nemají o co opřít. Goroutine plus token bucket je přesně tvar téhle úlohy.
4. **AWS SDK for Go v2** je Apache-2.0, udržovaný přímo AWS a SES část je kompletní. AWS SDK for Rust je použitelný, ale ekosystém kolem MIME a SMTP je menší.

**Kdy by vyhrál Rust:** pokud tým Rust denně píše (pak argument o kompilaci padá), nebo pokud by stejná binárka měla později polykat i event ingestion v řádu statisíců eventů za sekundu. To je ale jiná služba a jiné rozhodnutí. Ani jeden z těch případů nenastal, proto Go.

**Volba je vratná.** Kontrakt senderu je outbox tabulka a formát trackovacích tokenů, obojí jazykově neutrální. Když se ukáže, že Rust je lepší, přepíše se sender, aniž se sáhne na cokoliv jiného. Právě proto to rozdělení stojí za to.

Knihovny pro Go sender, všechny ověřené jako permisivní:

| Účel | Knihovna | Licence |
|---|---|---|
| SES | `aws/aws-sdk-go-v2` | Apache-2.0 |
| SMTP a MIME | `wneessen/go-mail` | MIT |
| Liquid | `osteele/liquid` | MIT |
| Postgres | `jackc/pgx` | MIT |

### 3.4 Proč se stack neslučuje do jednoho jazyka

Celý ekosystém e-mailových šablon je v JavaScriptu: MJML, react-email, EmailBuilder.js, Maily. Kdyby byl v kompilovaném jazyce i editor a kompilace šablon, musely by se tyhle knihovny volat přes vedlejší Node proces nebo přepisovat. To je největší časový žrout projektu a přesně proto zůstává aplikační vrstva v TypeScriptu.

Naopak sender žádnou z těch knihoven nepotřebuje. Dostane hotové HTML s placeholdery a dělá z něj zprávy. Dělicí čára je tedy přirozená, ne vynucená.

### 3.5 Fronty: pg-boss pro aplikaci, outbox pro sender

Referenční architektura počítá s Redisem nebo Valkey. Pro MVP to znamená třetí kontejner a další věc, kterou musí uživatel provozovat a zálohovat. pg-boss dává fronty, plánování, retry a dead letter přímo v Postgresu. Docker compose tím spadne na dvě služby a je stále konzistentní záloha jedním `pg_dump`.

**Sender ale pg-boss používat nebude, a to je důležité.** pg-boss je Node knihovna s vlastním interním schématem, které se mezi verzemi mění. Konzumovat ho z Go by znamenalo svázat sender s neveřejnými implementačními detaily cizí knihovny. To je křehké přesně na tom místě, kde si to nemůžeme dovolit.

Dělba práce:

- **pg-boss (TypeScript)** obsluhuje aplikační joby: importy, exporty, přepočty segmentů, doručování odchozích webhooků, zpracování eventů, plánovač kampaní.
- **Sender (Go)** si bere práci z vlastní outbox tabulky `messages` přes `SELECT ... FOR UPDATE SKIP LOCKED`. Je to standardní, dobře pochopený a triviálně implementovatelný vzor v jakémkoliv jazyce.

Aplikace tedy nezařazuje jednotlivé zprávy do fronty. Materializuje publikum do `messages` a sender si je sám rozebere. Žádná fronta mezi nimi navíc být nemusí.

Redis nebo Valkey přidáme, až to bude potřeba: rate limiting ingestion, deduplikace eventů, cache segmentů. Do té doby je to zbytečná zátěž pro self-hoster.

### 3.6 Jméno produktu a tři koše. ROZHODNUTO

Produkt se jmenuje **Mlain Mailer**. Rozhodl zadavatel 2026-07-31.

Jméno se objevuje na místech, která vypadají stejně, ale chovají se při přejmenování úplně jinak. Kdyby se ze všech udělala jedna konstanta, jak zněl původní návrh, přejmenování by tiše rozbilo věci, které rozbít nejde. Proto se výskyty dělí do tří košů a **pravidlo je závazné pro všechny části**.

| Koš | Co tam patří | Dnešní tvar | Co se stane při přejmenování |
|---|---|---|---|
| **A. Zmrazeno navždy** | Domain separator řetězce: HKDF `salt` a `info`, purposes odvození klíčů, prefix vstupu do MAC | `mailer/v1`, `mailer/v1/tracking-token`, `mailer/v1/suppression-fingerprint`, `mailer/v1/credential-encryption`, `mailer/token/v1`, `mailer/cred/v1` | **Nic. Nesahá se na ně.** Neobsahují jméno produktu právě proto, aby k tomu nikdo neměl důvod |
| **B. Zmrazí se prvním vydáním** | Předpony API klíčů, parametr identity tokenu, názvy DB rolí, GUC namespace, message tagy pro providera, značky kontraktu 5, hlavičky webhooků, cookie, CSS prefix, jméno CLI, trackovací doména, jmenný prostor balíčků | `ml_live_`, `ml_pub_`, `ml_token`, `mlain_app`, `mlain.workspace_id`, `ml_msg`, `ML_OPEN_PIXEL`, `ML-Signature`, `ml_session`, `ml-`, `mlain`, `track.mlain.invalid`, `@mlain/*` | Volně se mění **do prvního veřejného vydání**, potom už nikdy. Změna po vydání zneplatní vydané API klíče, rozbije odkazy v už odeslaných kampaních a initdb u běžících instalací |
| **C. Volné** | Texty v rozhraní, dokumentace, název Docker image, marketing | Mlain Mailer | Jedna konstanta, mění se kdykoliv |

**Proč koš A nesmí nést jméno produktu.** Řetězec `mailer/v1/suppression-fingerprint` je součástí receptu, kterým se počítá otisk smazané adresy. Otisky mají podle rozhodnutí zadavatele platit navždy a **nejdou přepočítat**, protože původní adresa je po výmazu pryč. Kdyby někdo při přejmenování produktu poctivě aktualizoval i tenhle řetězec, otisky spočítané před přejmenováním by se přestaly shodovat. Nic by neselhalo, nic by se nezalogovalo, jen by se smazaní lidé vrátili prvním dalším importem. Stejná logika platí pro `mailer/token/v1`: jeho změna rozbije každý pixel a proklik v už odeslaných kampaních.

**Praktický důsledek.** Přejmenování produktu je díky tomuhle rozdělení opravdu levné a hlavně **bezpečné i pro toho, kdo o téhle pasti neví**. Testovací vektory kryptografie se při přejmenování nepřepočítávají vůbec, protože v nich žádné jméno není.

---

## 4. Architektura

### 4.1 Modulární monolit plus sender, tři procesy

```
Docker image (jedna, obsahuje obě binárky)
├── MODE=web      Next.js standalone: UI + REST API + tracking endpointy
├── MODE=worker   pg-boss consumer: importy, segmenty, eventy, webhooky
├── MODE=sender   Go binárka: render per příjemce, MIME, SES/SMTP dispatch
└── MODE=all      všechny tři v jednom kontejneru, pro malá nasazení
```

**Proč jedna image a ne dvě.** Aplikace i sender sdílejí schéma databáze. Dvě samostatně verzované image znamenají, že si někdo dřív nebo později nasadí sender v4 proti aplikaci v3 a bude to ladit celý den. Jedna image ten problém odstraňuje z definice a zároveň drží slib "jeden `docker compose pull` a je hotovo". Cena je asi 20 MB navíc kvůli Go binárce, což je proti hodnotě té záruky nic.

Multi-stage build: Go builder, Node builder, výsledná image s oběma artefakty a jedním entrypointem.

Rozdělení do dvou image dává smysl teprve u nasazení, kde se sender škáluje nezávisle na aplikaci. Do té doby ne.

```
apps/
├── web        Next.js: UI, API, tracking, webhook příjem
├── worker     pg-boss workery (TypeScript)
└── sender     Go: outbox consumer, render, dispatch
packages/
├── core       doménová logika, nezávislá na HTTP
│   ├── identity      uživatelé, projekty, role, API klíče
│   ├── contacts      kontakty, atributy, seznamy, štítky, souhlasy
│   ├── segments      AST, kompilace do SQL, náhled počtu
│   ├── templates     blokový model, kompilace do HTML a textu
│   ├── campaigns     kampaně, publikum, plánování, materializace outboxu
│   ├── providers     konfigurace SES a SMTP, ověření domén, kvóty
│   ├── tracking      open, click, web eventy, identity resolution
│   ├── events        jednotný event model, zpracování
│   └── integrations  webhooky dovnitř i ven
├── db         Drizzle schéma a migrace (jediný vlastník schématu)
├── emails     základní šablona, bloky, renderer
├── contracts  sdílené kontrakty TS ↔ Go + golden fixtures
├── sdk-web    tracking SDK do prohlížeče
├── sdk-node   API klient
└── ui         design systém
```

Jeden repozitář, jedna databáze, jedna image. **Vlastníkem schématu je `packages/db`**, migrace pouští aplikace, sender schéma nikdy nemění.

### 4.2 Tok odeslání kampaně

```
APLIKACE (TypeScript)
Kampaň "Odeslat"
  → kompilace šablony: blokový JSON → HTML + text, Liquid placeholdery zůstávají
  → materializace publika do messages (outbox), status = pending
      (seznamy ∪ segmenty) − vyloučení − suppression − duplicity
  → campaign.status = sending
                                  │
                                  ▼
SENDER (Go)                   messages
  → claim dávky 500 přes SELECT ... FOR UPDATE SKIP LOCKED
  → per příjemce: Liquid interpolace → přepis odkazů → open pixel
                  → unsubscribe hlavičky (List-Unsubscribe, One-Click)
  → throttle podle kvóty provideru
  → SES SendEmail s ConfigurationSet, nebo SMTP
  → zápis provider_message_id a status = sent
                                  │
                                  ▼
APLIKACE (TypeScript)
  → SES → SNS → /webhooks/ses → normalizace do message_events
  → aktualizace stavu zprávy, kontaktu a suppression listu
  → tvrdý bounce a complaint → okamžitá suppression
```

Sender je tedy jediný proces, který sahá na SES kvůli odesílání. Příjem událostí zůstává v aplikaci, protože jde o běžný HTTP endpoint a patří k doméně reportů.

### 4.3 Tok web trackingu

```
Web SDK (na doméně zákazníka)
  → POST /e/track (ověření public key, rate limit, bot filtr, privacy filtr)
  → job "event.process"
      ├── identity resolution (anonymous_id → contact_id)
      ├── zápis do customer timeline
      ├── přepočet dotčených segmentů
      └── (fáze 4) trigger automatizací
  → PostgreSQL, tabulka eventů partitionovaná po měsících
```

Ingestion endpoint musí odpovědět do desítek milisekund. Všechno ostatní je asynchronní.

### 4.4 Napojení kliku v mailu na chování na webu

Toto je jádro diferenciátoru a stojí za to ho udělat správně hned:

1. Odkaz v mailu vede na `/t/c/<signed-token>`. Token je HMAC podepsaný, obsahuje message_id a link_id, neobsahuje e-mail.
2. Endpoint zaznamená klik, vygeneruje krátkodobý identifikační token a přesměruje na cíl s parametrem `?ml_token=...`.
3. Web SDK na cílovém webu token převezme, ověří proti ingestion API, spojí `anonymous_id` s `contact_id` a odstraní parametr z URL přes `history.replaceState()`.
4. Celá předchozí anonymní historie se přiřadí ke kontaktu.

Identifikační token: krátkodobý (minuty), jednorázový, podepsaný, vázaný na projekt a kampaň, bez čitelného e-mailu.

### 4.5 Kontrakty mezi TypeScriptem a Go

Rozdělení na dva jazyky má přesně jednu cenu: čtyři věci musí obě strany chápat identicky. Domluví se v prvních dvou hodinách hackathonu, zapíšou se do `packages/contracts` a **pak se nemění**. Každý kontrakt má sadu golden fixtures, kterou musí projít implementace na obou stranách.

**1. Outbox protokol.** Schéma tabulky `messages`, povolené přechody stavů, claim dotaz, timeout na uvolnění zaseknuté dávky, chování při restartu senderu uprostřed dávky. Sender nikdy nemaže řádky, jen mění stav.

**2. Liquid subset.** LiquidJS (náhled v UI) a `osteele/liquid` (skutečné odeslání) nejsou stoprocentně shodné dialekty. Kdyby se lišily, uživatel uvidí v náhledu něco jiného, než co se odešle, a to je ta nejhorší možná chyba v mailingovém nástroji.

Řešení: povolíme jen dokumentovanou podmnožinu, kterou obě implementace zaručeně sdílejí.

```
proměnné     {{ contact.first_name }}, {{ unsubscribe_url }}
filtry       default, upcase, downcase, date, escape
podmínky     if / elsif / else / unless
cykly        for (jen nad polem, bez vnořování)
```

Cokoliv nad rámec tohohle validátor odmítne už v editoru. Sada asi 40 golden fixtures (šablona + data + očekávaný výstup) běží v CI proti oběma implementacím. Rozchod dialektů tím přestává být riziko a stává se z něj červený test.

**3. Formát trackovacích tokenů.** Sender tokeny **vyrábí**, aplikace je **ověřuje**. Musí sedět bajt na bajt: kanonické pořadí polí, kódování (base64url bez paddingu), HMAC-SHA256, odvození klíče ze `SECRET_KEY`, verze v prefixu tokenu kvůli budoucí rotaci.

**4. Šifrování credentials.** Aplikace ukládá SES a SMTP přístupy zašifrované, sender je musí umět dešifrovat. AES-256-GCM, dokumentovaný formát obálky (verze, nonce, ciphertext, tag), klíč odvozený ze `SECRET_KEY` přes HKDF. Obojí implementovatelné ze standardní knihovny v obou jazycích.

Nic z toho není složité. Podstatné je, že to musí být napsané dřív, než začnou tracky B a C pracovat paralelně.

---

## 5. Datový model (jádro)

Zkráceně, sloupce jsou orientační.

```
users(id, email, password_hash, name, locale, created_at)
workspaces(id, name, slug, settings jsonb, created_at)          -- "projekt"
memberships(user_id, workspace_id, role)                        -- owner|admin|editor|viewer
api_keys(id, workspace_id, name, prefix, hash, scopes, last_used_at, revoked_at)

sending_providers(id, workspace_id, type, config_encrypted, is_default, verified_at)
sender_domains(id, workspace_id, domain, dkim_tokens, spf_ok, dkim_ok, dmarc_ok, checked_at)

contact_fields(id, workspace_id, key, label, type, options jsonb)
contacts(id, workspace_id, email citext, status,
         first_name, last_name, title, gender,          -- první třída, ne jsonb
         first_name_vocative, last_name_vocative,        -- viz 6.3
         vocative_locked, vocative_confidence,
         attributes jsonb,                               -- vše ostatní vlastní
         source, created_at, last_activity_at)
  -- unique(workspace_id, email)
lists(id, workspace_id, name, opt_in)                           -- single|double
list_subscriptions(contact_id, list_id, status, subscribed_at, confirmed_at, unsubscribed_at)
tags(id, workspace_id, name)  contact_tags(contact_id, tag_id)
consents(id, contact_id, purpose, status, source, ip, ts)       -- append only
suppressions(workspace_id, email, reason, source, created_at)

segments(id, workspace_id, name, definition jsonb, cached_count, cached_at)

templates(id, workspace_id, name, kind, design jsonb, html_cache, text_cache, version)
campaigns(id, workspace_id, name, subject, preheader, from_name, from_email, reply_to,
          design jsonb, compiled_html, compiled_text,             -- výstup fáze 1 renderu
          audience jsonb, provider_id, status, scheduled_at,
          track_opens, track_clicks, created_at, sent_at)
campaign_links(id, campaign_id, url, position)

-- outbox, jediné rozhraní mezi aplikací a senderem
messages(id, workspace_id, campaign_id, contact_id, email,
         render_data jsonb,   -- snapshot jen těch polí, která šablona opravdu používá
         status,              -- pending → claimed → sent | failed | skipped
         claimed_by, claimed_at,          -- identita senderu + timeout na zaseknutí
         attempts, next_attempt_at,
         provider_message_id, sent_at, error)                     -- partition by month
  -- index (status, next_attempt_at) WHERE status IN ('pending','claimed')
message_events(id, message_id, type, ts, metadata jsonb)         -- partition by month, append only

identities(workspace_id, anonymous_id, contact_id, first_seen, last_seen)
web_events(id, workspace_id, name, anonymous_id, contact_id, session_id,
           page jsonb, properties jsonb, context jsonb, ts)       -- partition by month, append only

webhook_endpoints(id, workspace_id, url, events, secret, active)
webhook_deliveries(id, endpoint_id, event_id, status, attempts, last_error)

forms(id, workspace_id, name, fields jsonb, list_id, design jsonb)
audit_log(id, workspace_id, actor, action, target, metadata, ts)
```

Zásady:

- **Každá tabulka nese `workspace_id`** a repository vrstva ho vynucuje. Žádný dotaz bez něj neprojde review.
- **Eventy jsou neměnné.** Nikdy se nepřepisují, jen se agregují.
- **Souhlas je prvotřídní datový objekt** s vlastní historií, ne příznak na kontaktu.
- Šablony se ukládají jako **strukturovaný JSON**, ne jako HTML. HTML a plain text se generují. Díky tomu jde editor později vyměnit, aniž se rozbijí existující šablony.
- **`messages` je jediné místo, kde se aplikace a sender potkávají.** Žádné sdílené HTTP API, žádná společná knihovna, žádná fronta navíc. Když se sender vypne, kampaň se zastaví a po zapnutí plynule pokračuje.
- **Sender nečte tabulku kontaktů.** Při materializaci se do `render_data` uloží snapshot jen těch polí, na která se kompilovaná šablona skutečně odkazuje (kompilace je zná, protože merge tagy parsuje). Typicky jde o dvě až pět hodnot na příjemce.

  Tři výhody najednou: příjemce dostane data platná k okamžiku odeslání a ne k okamžiku, kdy na něj dojde řada, odpadá join na kontakty u každé zprávy, a sender může běžet s **databázovým uživatelem, který má práva jen na `messages`, `campaigns` a `sending_providers`**. Chyba v senderu se nemůže dotknout kontaktů ani eventů.

---

## 6. Klíčové domény detailně

### 6.1 Projekty, klíče a bezpečnost

Přímá reakce na problém popsaný v přepisu ("u Sendy je jeden API klíč do všech projektů"):

- API klíč patří **vždy právě jednomu projektu**. Formát `ml_live_<prefix>_<secret>`, v DB jen SHA-256 hash, tajemství se zobrazí jednou.
- Klíč má scopes (`contacts:read`, `contacts:write`, `campaigns:send`, `events:write`, ...).
- Veřejný klíč pro web SDK je oddělený, jen `events:write`, bezpečný pro vložení do stránky.
- Serverová identifikace kontaktu podepsaným tokenem. Web SDK **nesmí** podvrhnout cizí e-mail.
- Každý projekt má vlastní `sending_provider`. Odesílací reputace se mezi projekty nemíchá.
- Audit log každé citlivé akce.

### 6.2 Kontakty a segmenty

Segment je JSON AST kompilovaný do SQL. MVP operátory:

```
pole:      atribut kontaktu | vlastní pole | štítek | členství v seznamu | stav
porovnání: =, ≠, >, <, obsahuje, začíná, je prázdné, za posledních N dní
engagement: otevřel / neotevřel / klikl / neklikl (kampaň X | libovolnou | posledních N)
aktivita:  poslední aktivita, datum přihlášení, zdroj
spojky:    AND, OR, NOT, vnořené skupiny
```

UI ukazuje živý náhled počtu kontaktů před uložením. Publikum kampaně se v okamžiku odeslání **materializuje**, aby se seznam příjemců uprostřed rozesílky neměnil.

**Presety pro čištění databáze** (přímo z přepisu, silný prodejní argument):

- "Nikdy neotevřel" / "Nikdy neklikl"
- "Neaktivní 90+ dní"
- "Neotevřel posledních N kampaní"
- Hotová reaktivační kampaň: potvrď zájem, jinak tě po X dnech odhlásíme, plus následné hromadné pročištění na jedno kliknutí.

### 6.3 Jména a oslovení, vokativ

Toto je pro český trh podmínka důvěryhodnosti, ne kosmetika. "Dobrý den Jana" okamžitě označí nástroj za amatérský, "Dobrý den, Jano" je samozřejmost, kterou Ecomail i Mailchimp umí.

**Jméno a příjmení jsou samostatné sloupce**, ne položky v `attributes jsonb`. Bez toho vokativ nejde spočítat, protože se křestní jméno a příjmení skloňují jinak.

```
contacts(
  ...
  first_name, last_name,
  title,                      -- Ing., Mgr., MUDr., odděleno při importu
  gender,                     -- female | male | unknown
  first_name_vocative,        -- vypočítané, uživatelem přepsatelné
  last_name_vocative,
  vocative_locked bool,       -- ruční oprava, nikdy nepřepočítávat
  vocative_confidence         -- high | low, řídí frontu ke kontrole
)
```

#### Kdy se vokativ počítá

**Při zápisu kontaktu, ne při odesílání.** Tedy při vytvoření, úpravě a importu, v TypeScriptu. Uloží se do sloupce.

Tři důvody, proč zrovna takhle:

1. Sender zůstává hloupý. Žádná česká morfologie v Go, žádný další sdílený kontrakt, který by se mohl rozejít.
2. Co uživatel vidí v náhledu, to se skutečně odešle. Kdyby se vokativ počítal až při odeslání dvěma různými implementacemi, byl by to přesně ten typ chyby, kterou nikdo nenajde včas.
3. Uživatel může výsledek zkontrolovat a opravit **předtím**, než se rozešle deset tisíc mailů.

Do `messages.render_data` se pak snapshotuje hotový řetězec. Sender jen dosadí.

#### Jak se počítá

Základ: **`czech-vocative`** (MIT, verze 2.1.0, aktualizováno v březnu 2026, zhruba 7 500 stažení týdně). Ověřeno k 2026-07-31.

Pozor na alternativu `czech-inflection`: je pod **LGPL v2.1** a do MIT projektu nepatří. Je to první konkrétní úlovek pro licenční bránu z kapitoly 9.

Určení rodu, protože bez něj vokativ nesedí:

1. Explicitní hodnota z importu nebo z API má vždy přednost.
2. Příjmení na `-ová` nebo `-á` znamená v češtině prakticky jistě ženu.
3. Křestní jméno proti seznamu známých jmen.
4. Když ani jedno nezabere, rod je `unknown` a použije se neutrální oslovení.

Nikdy nehádáme naslepo. Neurčitý výsledek se označí jako `low` a putuje do fronty ke kontrole.

#### Kontrola před odesláním

Po importu se zobrazí: **"U 143 kontaktů si nejsme jistí oslovením."** Tabulka s návrhem, hromadné potvrzení, ruční oprava jednotlivců. Opravená hodnota se zamkne (`vocative_locked`) a už se nikdy nepřepíše.

Je to levné na implementaci a je to přesně ten typ detailu, kvůli kterému si lidé nástroj oblíbí.

#### Merge tagy

```
{{ contact.first_name }}             Jana
{{ contact.first_name_vocative }}    Jano
{{ contact.last_name }}              Nováková
{{ contact.greeting }}               Dobrý den, Jano
```

`contact.greeting` je hotové oslovení včetně fallbacku. Když je vokativ neznámý, sesype se na "Dobrý den" bez jména, nikdy na "Dobrý den, " s visící čárkou. Tón se nastavuje na úrovni projektu (vykání nebo tykání), takže totéž pole umí vrátit i "Ahoj Jano".

Výchozí šablona používá `{{ contact.greeting }}`, aby uživatel nemusel na nic myslet.

**Filtr `| vocative` vědomě nezavádíme.** Vypadal by přirozeně, ale znamenal by českou morfologii v senderu, a tím ztrátu všech tří výhod popsaných výše. Výběr merge tagů v editoru nabízí položku "Jméno v 5. pádu" a validátor zachytí `{{ contact.first_name | vocative }}` s nápovědou na správný tag.

#### Import

Mapování sloupců umí `first_name` a `last_name` samostatně. Když zdroj obsahuje jedno pole se jménem, nabídne se automatické rozdělení s náhledem: oddělení titulů, volba pořadí (Jana Nováková versus Nováková Jana), detekce rodu.

Náhled importu ukazuje výsledný vokativ ještě před potvrzením. Tady se chyby chytají nejlevněji.

#### Lokalizace

Vokativ má i slovenština a polština. Architektura počítá s modulem pro odvození tvarů jména podle jazyka, v MVP 0 je implementovaná pouze čeština. Pro jazyky bez vokativu modul vrací nominativ a `contact.greeting` funguje dál beze změny.

### 6.4 Šablony a editor

- Blokový model: sekce, sloupce (1, 2, 3), text, nadpis, obrázek, tlačítko, oddělovač, mezera, HTML, produktový blok (později), sociální ikony, patička.
- **Renderer: `@react-email/components` + `@react-email/render` (MIT). Editor: vlastní, tenký, nad naším blokovým JSON modelem. ROZHODNUTO 2026-07-31.**

  **`@usewaypoint/email-builder` se nepoužije.** Dřívější znění téhle kapitoly ho uvádělo jako základ editoru, to je tímto zrušeno. Balíček byl nainstalován a spuštěn, nejen přečten, a ověřený stav je tenhle:

  - balíček z npm **neobsahuje editor**, exportuje jen `Reader` a `renderToStaticMarkup`
  - **negeneruje hlavičku dokumentu**: žádná media query, žádný `viewport`, žádný tmavý režim, ani deklarace kódování, přestože výstup obsahuje česká písmena
  - **neumí textovou variantu vůbec**, přitom ji specifikace vyžaduje
  - odsazení řeší `padding` na `<div>`, což Word engine v Outlooku ignoruje
  - chybí patička s odhlášením a sociální ikony
  - `peerDependencies` připouštějí jen React 16 až 18, projekt jede na React 19

  Proč react-email: MIT, **3,1 milionu stažení týdně proti 58 tisícům**, oficiální podpora React 19, generuje hlavičku dokumentu, preheader, tabulkový layout, MSO konstrukce pro Outlook **i textovou variantu**. Že ta kombinace funguje v praxi není teorie, přesně na ní stojí knihovna Maily.

  Ověřené verze k 2026-07-31: `react-email` 6.9.1 (MIT), `@react-email/components` 1.0.12 (MIT), `@react-email/render` 2.1.0 (MIT).

  **Zamítnuté alternativy:**

  - **Maily** (`@maily-to/*`): pole `license` v `package.json` je prázdné a **v balíčku není žádný soubor LICENSE**, přestože repozitář je MIT. Autor v roce 2025 licenci vědomě změnil pryč od MIT, protože mu produkt přebalovali a přeprodávali, později napsal, že je to „stoprocentně MIT", ale za patnáct měsíců to do balíčku nedoplnil. Náš projekt je přesně ten scénář, kvůli kterému tehdy licenci měnil.
  - **GrapesJS** (BSD-3): funkční, newsletterový preset generuje skutečné tabulky a Liquid nepoškozuje. Zamítnuto jako druhá volba kvůli 400 kB v prohlížeči a nutnosti zamykat obecný stavitel webu, aby uživatel nepostavil něco, co se v Outlooku rozpadne. **Zůstává jako dokumentovaná náhradní cesta.**

  **Rozsah vlastního editoru je změřený, ne odhadnutý:** zhruba 3 000 řádků při 6 až 8 typech bloků. Rozpad: blokový model a stav 300 až 500, přetahování 300 až 600, panel vlastností 1 200 až 1 800, náhled 150 až 300. Polovina objemu je panel vlastností, tedy mechanická formulářová práce.
- Renderer, fáze 1: JSON → HTML (table based, testované v klientech) + automatický plain text. Běží v aplikaci, jednou na kampaň.
- Součástí kompilace je **extrakce použitých merge tagů**. Z ní plyne, která pole kontaktu se snapshotují do `messages.render_data`, a zároveň validace, že šablona nepoužívá pole, které neexistuje.
- **Univerzální základní šablona** je součástí produktu, ne jen příklad. Ozkoušená v Outlooku, Gmailu, Apple Mail, Seznam Email. AI do ní vkládá jen data.
- Personalizace: Liquid, `{{ contact.first_name }}`, `{{ unsubscribe_url }}`, `{{ webview_url }}`. **Uvozovky v šabloně nejsou povolené**, náhradní hodnota filtru `default` a formátovací řetězec filtru `date` se zadávají v panelu vlastností bloku a kompilace je doplní. Důvod: každý React renderer escapuje uvozovky a špičaté závorky, takže `{{ x | default: "y" }}` by v HTML skončilo jako entity a přestalo být platným Liquidem. Podrobně v části 1, kapitola 4.10.2.
- Náhled na desktop/mobil, testovací odeslání, kontrola chybějících merge tagů před odesláním.

### 6.5 AI asistent (bring your own key)

- Klíč se zadává v nastavení projektu, ukládá se šifrovaně, nikdy neopouští instalaci uživatele.
- Providery: Anthropic, OpenAI, Google, OpenRouter. Přes Vercel AI SDK jde přidat další.
- **Asistent nikdy negeneruje surové HTML.** Generuje strukturovaný JSON validovaný proti našemu blokovému schématu. Tím nemůže rozbít zobrazení v poštovních klientech.
- Nástroje asistenta:
  - `extract_brand(url)`: stáhne web, vytáhne logo, paletu barev, fonty, tón
  - `compose_template(brief, brand, kind)`: newsletter | oznámení | transakční | reaktivační
  - `write_copy(section, tone, language)`: texty česky nebo anglicky
  - `suggest_subject(campaign)`: varianty předmětu a preheaderu
- Typický vstup uživatele: "Chci newsletter, tady je můj web, stáhni si barvy a logo, napiš mi pozvánku na letní výprodej."

### 6.6 Odesílání a doručitelnost

Rozdělení odpovědnosti: **sender (Go)** odesílá, **aplikace (TypeScript)** konfiguruje, přijímá události a reportuje.

- **Amazon SES**: `SendEmail` s Configuration Set (sender), události přes SNS na náš endpoint (aplikace). Ošetřit `SubscriptionConfirmation` a ověřit podpis SNS.
- **SMTP**: obecný fallback, události jen z bounce mailboxu (fáze 2) nebo z webhooku providera.
- Průvodce nastavením domény: vygeneruje DKIM záznamy, ukáže co vložit do DNS, kontroluje SPF, DKIM, DMARC a hlásí zeleně/červeně.
- Detekce SES sandboxu a zobrazení kvót (`GetSendQuota`). Sandbox znamená 200 příjemců za 24 hodin a 1 zpráva za sekundu, uživatel to musí vidět dřív, než spustí kampaň na 10 000 lidí.
- Throttling odesílání podle kvóty providera, exponenciální backoff, pauza a obnovení kampaně.
- Automatické zpracování: tvrdý bounce a stížnost → okamžitý zápis do suppression listu. Bez toho AWS účet zablokuje.
- Dashboard doručitelnosti: bounce rate, complaint rate, varování při překročení prahů (bounce > 4 %, complaints > 0,1 %), automatická pauza při 8 % a 0,3 %; prahy vlastní část 4a, 3.15.2.

### 6.7 Tracking

- **Otevření**: 1×1 pixel na `/t/o/<token>`, respektuje nastavení kampaně.
- **Kliknutí**: přepis odkazů na `/t/c/<token>`, 302 na cíl.
- **Web SDK**: automaticky `page_view`, `session_started`. Ručně přes API:
  ```js
  Mlain.track("product_viewed", { product_id: "SKU-123", price: 2490, currency: "CZK" });
  Mlain.identify("customer_8472", { email: "...", first_name: "Jan" });
  Mlain.consent({ analytics: true, personalization: true, emailMarketing: true });
  ```
- **SDK se nespustí bez souhlasu.** Souhlas je vstupní podmínka, ne dodatečný filtr.
- SDK i ingestion musí být provozovatelné na subdoméně zákazníka (`https://events.shop.cz`), kvůli adblockerům a kvůli tomu, že jde o self-hosted produkt.
- **Customer timeline**: sjednocená časová osa kontaktu (otevřel, klikl, navštívil, přidal do košíku, vstoupil do automatizace). Musí být čitelná pro netechnického marketéra a musí vysvětlit, proč se co spustilo.

### 6.8 API a integrace

REST, OpenAPI 3.1 generované ze schémat, cursor stránkování, idempotency keys u zápisů.

```
POST   /api/v1/contacts                   vytvoření nebo upsert
GET    /api/v1/contacts?query=...
POST   /api/v1/contacts/import            CSV nebo JSON dávka
POST   /api/v1/lists/{id}/subscribe       respektuje double opt-in
DELETE /api/v1/lists/{id}/subscribe
GET    /api/v1/segments/{id}/preview      počet a vzorek
POST   /api/v1/campaigns
POST   /api/v1/campaigns/{id}/send
GET    /api/v1/campaigns/{id}/stats
POST   /api/v1/transactional              transakční mail přes šablonu (fáze 2)
POST   /api/v1/events                     server-side event
GET    /api/v1/contacts/{id}/timeline
```

Odchozí webhooky: `contact.created`, `contact.subscribed`, `contact.unsubscribed`, `message.delivered`, `message.opened`, `message.clicked`, `message.bounced`, `message.complained`, `campaign.sent`. Podepsané HMAC, retry s backoffem, viditelný log doručení.

Příchozí webhooky: generický endpoint s mapováním payloadu, aby objednávka z e-shopu založila a přihlásila kontakt bez psaní kódu.

---

## 7. Fázový plán

### MVP 0: hackathon, "golden path"

Cíl je jediný ucelený tok, provedený výborně:

```
instalace → připojení SES → import kontaktů → vytvoření šablony
→ vytvoření segmentu → odeslání kampaně → kvalitní report
```

Když tenhle tok bude výborný, získáme uživatele dřív, než budou hotové automatizace. Detailní rozpis v kapitole 8.

### MVP 1: skutečná alternativa k Sendy

Double opt-in a potvrzovací maily, embedovatelné formuláře, plánované odesílání, presety čištění databáze a reaktivační kampaň, kompletní REST API a odchozí webhooky, kontrola SPF/DKIM/DMARC v UI, zálohování a upgrade mechanismus, i18n cs + en kompletně, role a oprávnění.

### MVP 2: alternativa k Ecomailu

Vizuální automation builder (React Flow, MIT), časové prodlevy, větvení podle podmínek, eventové triggery, A/B testování předmětu a obsahu, transakční e-maily přes API, znovupoužitelné bloky obsahu, detailní reporty, lead scoring, audit log.

### MVP 3: e-commerce a platforma

WooCommerce a Shopify konektory, produktové feedy, opuštěný košík, purchase a product-view eventy, doporučení produktů, plugin SDK, vlastní automation nodes, vlastní sending providery, multi-workspace na úrovni organizace, white-labeling, Helm a Terraform, importér z Listmonku a Mauticu.

### Nejtěžší části, na které se musíme připravit

1. **Automatizační engine** (MVP 2). Workflow není obrázek v React Flow. Server musí umět čekat měsíce, bezpečně pokračovat po restartu, zabránit duplicitnímu spuštění a vysvětlit, proč kontakt prošel danou větví. Každé publikování vytvoří **neměnnou verzi**. Kontakt, který vstoupil do verze 3, nesmí uprostřed scénáře přeskočit na verzi 4.
2. **Segmentační engine**. Náhled počtu, indexace, stabilní chování při odesílání.
3. **Doručitelnost**. Nejde jen odeslat, jde o to nedostat zablokovaný SES účet.

---

## 8. Hackathonový plán

Předpoklad: 2 až 3 dny, tým rozdělený do paralelních tracků. Tracky jsou schválně řezané tak, aby se minimálně blokovaly. Kontrakty mezi nimi (DB schéma a typy) se domluví v prvních dvou hodinách a pak se nemění.

### Hodina 0 až 2: společný start (celý tým)

Monorepo, Docker compose, Drizzle schéma jádra, auth, přepínač projektů, layout a design systém, i18n kostra.

**A navíc čtyři kontrakty z kapitoly 4.5**, protože bez nich nemůžou tracky B1 a B2 běžet paralelně: outbox protokol, Liquid subset s golden fixtures, formát trackovacích tokenů, formát šifrování credentials. Zapsat do `packages/contracts` a od té chvíle nesahat.

Tohle je jediná daň za rozdělení jazyků. Zaplatit ji hned na začátku je levné, doplácet na ni druhý den odpoledne drahé.

### Track A: kontakty a data

- CRUD kontaktů, vlastní pole, štítky, seznamy
- CSV import s mapováním sloupců a náhledem, export
- **Jméno, příjmení, rod, vokativ včetně fronty ke kontrole** (6.3)
- Suppression list
- Segment builder s živým náhledem počtu

Hotovo, když: naimportuju 10 000 kontaktů z CSV se sloupcem "Jana Nováková", nástroj ho rozdělí, určí rod, nabídne "Jano", u nejistých případů mě nechá rozhodnout, a segment vrátí správný počet.

### Track B1: kampaně, aplikační strana (TypeScript)

- Nastavení provideru (SES + SMTP), test připojení, zobrazení kvót a sandboxu
- Model kampaně, kompilace šablony, materializace publika do outboxu
- SES webhook: SNS ověření, normalizace událostí, bounce a complaint do suppression
- Ovládání kampaně: pauza, obnovení, zrušení

Hotovo, když: kliknutím na "Odeslat" se naplní outbox správnými příjemci a `render_data`, a příchozí bounce se propíše do suppression listu.

### Track B2: sender (Go)

- Claim dávek z outboxu přes `FOR UPDATE SKIP LOCKED`, obnova po restartu
- Liquid interpolace, přepis odkazů, open pixel, unsubscribe hlavičky
- Throttling podle kvóty provideru, backoff, retry
- SES i SMTP dispatch, zápis `provider_message_id`

Hotovo, když: kampaň na 1 000 příjemců doběhne, sender se dá v půlce zabít a po nastartování plynule pokračuje bez duplicit.

**B1 a B2 se potkávají jen na kontraktech z hodiny 0 až 2.** Do té doby, než bude sender hotový, může B1 testovat proti triviálnímu skriptu, který outbox jen odbaví do logu.

### Track C: editor a šablony

- Vlastní blokový JSON model, vlastní tenký editor nad ním, renderer přes `@react-email/components`
- Univerzální základní šablona
- Renderer JSON → HTML + plain text
- Liquid merge tagy včetně `{{ contact.greeting }}`, náhled desktop/mobil, testovací odeslání

Hotovo, když: postavím šablonu myší, vložím oslovení a testovací mail dorazí s "Dobrý den, Jano", ne "Dobrý den Jana".

### Track D: tracking a reporty

- Open pixel, click redirect, podepsané tokeny
- Web SDK v základní verzi (page_view, identify, consent)
- Napojení kliku v mailu na profil (`ml_token`)
- Report kampaně, dashboard, SSE pro živý průběh odesílání

Hotovo, když: v reportu vidím doručeno / otevřeno / prokliknuto a v timeline kontaktu je návštěva webu po kliknutí v mailu.

### Track E: AI asistent a API

- Nastavení BYOK, čtyři providery
- `extract_brand` ze zadané URL
- `compose_template` se structured output proti blokovému schématu
- API klíče per projekt, základní REST endpointy, příchozí webhook pro subscribe

Hotovo, když: řeknu "newsletter podle mého webu, pozvánka na výprodej" a dostanu použitelnou šablonu ve firemních barvách.

### Definition of done pro hackathon: demo skript

Jedno souvislé demo, bez střihu, na čisté instalaci:

1. `docker compose up`, průvodce vytvoří admina a první projekt.
2. Připojím SES, průvodce ukáže DNS záznamy a ověří doménu.
3. Naimportuji CSV s 5 000 kontakty, namapuji vlastní pole. Nástroj rozdělí jméno a příjmení, určí rod a navrhne vokativ. U hrstky nejistých případů si vyžádá potvrzení.
4. Řeknu AI: "Newsletter podle webu example.cz, pozvánka na letní výprodej." Dostanu šablonu.
5. Doladím ji myší v editoru, pošlu si test.
6. Vytvořím segment "aktivní za posledních 90 dní", vidím počet.
7. Odešlu kampaň, sleduji živý průběh.
8. Otevřu mail, kliknu, přejdu na web. V timeline kontaktu vidím otevření, klik i návštěvu stránky.
9. Ukážu report kampaně a dashboard doručitelnosti.

Když tohle projde od začátku do konce, hackathon je úspěšný a produkt má co ukazovat.

### Co na hackathonu vědomě odkládáme

Automatizace, A/B testy, formuláře, transakční maily, role a oprávnění, e-commerce konektory, plugin systém. Nic z toho není v demo skriptu.

---

## 9. Nefunkční požadavky

### Instalace a provoz

```yaml
services:
  app:
    image: ghcr.io/nc-mill/mlain:latest
    environment:
      DATABASE_URL: postgres://...
      APP_URL: https://marketing.example.com
      SECRET_KEY: ...
    volumes: [ "./data:/data" ]
  postgres:
    image: postgres:18-alpine   # vždy poslední produkční verze, pravidlo viz 3.2
    profiles: [ "bundled" ]     # vypnutelné, když už Postgres máte
```

- Migrace se pouštějí při startu, idempotentně.
- Konfigurace přes proměnné prostředí, žádné soubory uvnitř image.
- `docker compose pull && docker compose up -d` je kompletní update.
- Zálohování: příkaz uvnitř image udělá `pg_dump` plus uploady do zvoleného adresáře. Externí cíle (S3, Dropbox) až později.

### Bezpečnost

- Argon2id pro hesla, sessions v httpOnly cookies, CSRF ochrana.
- Šifrování credentials providerů a AI klíčů klíčem z `SECRET_KEY`.
- Rate limiting na ingestion, auth a veřejné endpointy.
- Izolace projektů vynucená v repository vrstvě, pokrytá testy.
- Bot filtr na trackingu (známí crawleři, Apple Mail Privacy Protection u otevření).

### Soukromí a GDPR

Toto není právní posouzení, finální návrh je nutné zkontrolovat s odborníkem na GDPR a ePrivacy. Produkt ale musí technicky umožnit:

- souhlasy jako datový objekt s historií (`analytics`, `personalization`, `email_marketing`),
- odvolání souhlasu kdykoliv a okamžité zastavení trackingu,
- export dat subjektu a smazání nebo anonymizaci historie,
- retention policy na eventech,
- automatické odstraňování citlivých URL parametrů,
- zákaz ukládání hesel, tokenů a obsahu formulářů,
- maskování vybraných vlastností událostí.

### Licence: MIT

Rozhodnuto: **celý projekt pod MIT.** Jednotně, bez výjimek, včetně serveru, senderu, SDK, integrací i dokumentace. Jedna licence na celý repozitář znamená nulové právní tření pro přispěvatele i pro firmy, které to budou nasazovat.

Referenční konverzace doporučovala AGPLv3. Uvádím to jen kvůli úplnosti: MIT znamená, že kdokoliv může projekt vzít, uzavřít a prodávat jako SaaS, aniž by cokoliv vracel zpět. To je vědomá cena za maximální adopci a je to vaše rozhodnutí. Obrana proti tomu pak nestojí na licenci, ale na tempu vývoje, značce a kvalitě hostované verze.

**Důsledek, který je teď tvrdý požadavek:** do projektu nesmí vstoupit žádná GPL ani AGPL závislost. Nejde o preferenci, MIT distribuce s GPL knihovnou je licenční konflikt.

Ověřeno k 2026-07-31 přímo z registru:

| Závislost | Verze | Licence |
|---|---|---|
| `next` | 16.2.12 | MIT |
| `next-intl` | 4.13.4 | MIT |
| `drizzle-orm` | 0.45.2 | Apache-2.0 |
| `pg-boss` | 12.26.3 | MIT |
| `liquidjs` | 10.27.2 | MIT |
| `czech-vocative` | 2.1.0 | MIT |
| `react-email` (nástroje a náhled) | 6.9.1 | MIT |
| `@react-email/components` | 1.0.12 | MIT |
| `@react-email/render` | 2.1.0 | MIT |
| `mjml` (náhradní cesta) | 5.4.0 | MIT |
| `ai` (Vercel AI SDK) | 7.0.44 | Apache-2.0 |
| `@xyflow/react` (fáze MVP 2) | 12.11.2 | MIT |
| `aws/aws-sdk-go-v2` | | Apache-2.0 |
| `wneessen/go-mail` | | MIT |
| `osteele/liquid` | | MIT |

Všechno permisivní, žádný konflikt. Apache-2.0 je s MIT distribucí slučitelná.

**Na co si dát pozor při dalších volbách:**

- **`czech-inflection`** je pod **LGPL v2.1**. Nabízí se jako alternativa pro vokativ, ale do MIT projektu nepatří. V JavaScriptu se knihovna bundluje, takže argument o dynamickém linkování neobstojí. Toto je první konkrétní případ, který by licenční brána zachytila.
- **n8n** je fair-code pod Sustainable Use License, není to OSI open source. Nesmí být závislostí.
- **TinyMCE** a podobné editory jsou duálně GPL nebo komerční. Nepoužívat.
- **Unlayer** (`react-email-editor`) je klient k proprietární hostované službě. Přímý rozpor se slibem nulové komunikace s cizím cloudem.
- **Maily** (`@maily-to/*`) má v `package.json` prázdné pole `license` a v balíčku není žádný soubor LICENSE, přestože repozitář je MIT. Bez licence v distribuovaném balíčku ho licenční brána nesmí pustit dovnitř. Podrobně v 6.4.
- **`@usewaypoint/email-builder`** je zamítnutý z věcných, ne licenčních důvodů (chybí editor, hlavička dokumentu i textová varianta, React 16 až 18). Podrobně v 6.4.
- **Listmonk** je AGPL. Můžeme se jím inspirovat a psát pro něj importér, ale nesmíme z něj převzít kód.

**CI brána:** kontrola licencí běží v pipeline a build padá na jakékoliv copyleft závislosti. Na straně Node přes `license-checker` s whitelistem (MIT, Apache-2.0, BSD, ISC), na straně Go přes `go-licenses`. Jednou nastavit, pak už to hlídá samo. Zavést v hodině 0 až 2, ne později, protože vyhazovat zabudovanou závislost je mnohem dražší než ji rovnou nepustit dovnitř.

---

## 10. Rizika

| Riziko | Dopad | Opatření |
|---|---|---|
| Editor sežere celý hackathon | Střední | Renderer je hotový (`@react-email/components`), staví se jen tenký editor nad vlastním blokovým JSON. Rozsah je změřený: zhruba 3 000 řádků při 6 až 8 typech bloků, z toho 1 200 až 1 800 je panel vlastností, tedy mechanická formulářová práce. Náhradní cesta GrapesJS (BSD-3) je dokumentovaná (6.4) |
| **Rozjetí Liquid dialektů TS a Go** | **Vysoký** | Dokumentovaná podmnožina, golden fixtures v CI proti oběma implementacím (4.5) |
| **Kontrakty TS ↔ Go se domluví pozdě** | **Vysoký** | Hodina 0 až 2, jinak se B1 a B2 zablokují navzájem |
| Závislost na cizím rendereru | Nízký | react-email má 3,1 milionu stažení týdně a je MIT. Blokový JSON je v našem jmenném prostoru a renderer sedí za rozhraním, náhradní cesty jsou MJML a GrapesJS |
| **Uvozovky v šabloně rozbijí Liquid po escapování v React rendereru** | **Vysoký, ale vyřešený** | Řetězcové literály jsou z Liquid subsetu vyřazené, náhradní hodnota `default` a formát `date` se berou z atributů bloku (viz část 1, 4.10.2) |
| Zanesení GPL závislosti do MIT projektu | Vysoký | CI brána na licence hned v hodině 0 až 2 |
| Doručitelnost a DNS setup | Střední | Průvodce s kontrolou SPF/DKIM/DMARC hned v MVP 0 |
| Automatizační engine podceněný | Vysoký, ale později | Neverzované workflow nedělat vůbec, verzování od prvního dne |
| Únik dat mezi projekty | Kritický | Izolace v repository vrstvě + testy, nikoliv jen filtr v UI |
| Rozsah MVP 0 nabobtná | Vysoký | Demo skript je jediné kritérium hotovosti, ostatní se řeže |
| ~~SES sandbox zabije demo~~ | Vyřešeno | Účet je k dispozici. Před hackathonem jen ověřit, že je mimo sandbox a jaká je kvóta |

---

## 11. Stav rozhodnutí

### Rozhodnuto

| | Rozhodnutí |
|---|---|
| Aplikační vrstva | TypeScript, Next.js 16 |
| Odesílací engine | Samostatná kompilovaná binárka, ne Node |
| Fronty | pg-boss pro aplikační joby, outbox se `SKIP LOCKED` pro sender |
| Licence | MIT, jednotně, bez copyleft závislostí |
| SES účet | K dispozici, riziko sandboxu odpadá |
| Web tracking | Součást MVP 0, je to hlavní diferenciátor |

### Zbývá rozhodnout

1. ~~**Go, nebo Rust pro sender.**~~ **ROZHODNUTO: Go.** Rozhodl zadavatel. Důvody: kompilace v jednotkách sekund místo minut, výrazně větší základna přispěvatelů pro open-source projekt, a výkonová výhoda Rustu se nemá o co opřít, protože strop určuje kvóta Amazonu, ne jazyk. Odůvodnění v 3.3. Track B2 tím není blokovaný.
2. ~~**Název produktu.**~~ **ROZHODNUTO: Mlain Mailer.** Rozhodl zadavatel 2026-07-31. Výskyty jsou rozdělené do tří košů podle toho, co se s nimi při případném dalším přejmenování stane, viz 3.6. Repozitář zůstává Mailing-Tool.
3. **Délka hackathonu a velikost týmu.** Plán v kapitole 8 počítá s 2 až 3 dny a šesti paralelními tracky. Při menším týmu se řeže rozsah, nikdy ne demo skript.

### K ověření před hackathonem, ne rozhodnutí

- SES účet je mimo sandbox a jaká je denní kvóta a rychlost za sekundu.
- Doména pro demo má nastavené DKIM a SPF.
