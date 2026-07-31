# Část 1: Platforma, identita a provoz

Vlastník: subagent part1-platforma
Datum: 2026-07-31
Rozvíjí kapitoly hlavní specifikace: 3, 4.1, 4.5, 6.1, 9
Stav: koncept

---

## 0. Pro netechnického recenzenta

Tuhle sekci si přečtěte, i když zbytek dokumentu přeskočíte. Je napsaná tak, aby se na ni dalo reagovat bez znalosti programování. Odborné pojmy vysvětluju v závorce vždy, když se poprvé objeví.

### 0.1 Co tahle část produktu je

Celý nástroj se píše po pěti částech. Tahle první je **základ domu**: základy, rozvody vody a elektřiny, vstupní dveře se zámky a pojistková skříň. Ostatní čtyři části jsou pokoje: kontakty, e-mailové šablony, rozesílání, statistiky. Kdo bydlí, vidí pokoje. Ale když jsou špatně základy, nepomůže sebelepší kuchyň.

Konkrétní příklad, na kterém si to lze představit:

> Marketingová agentura spravuje e-maily pro dvanáct klientů. Nainstaluje si nástroj na vlastní server. Každý klient je v nástroji jeden **projekt**. Agentura potřebuje tři jistoty: že se klienti navzájem nikdy neuvidí do dat, že když vývojář jednoho klienta dostane přístup k propojení s e-shopem, nedostane se tím k ostatním, a že když se server rozbije, dají se data obnovit.

Tahle část produktu je odpovědí přesně na tyhle tři jistoty, plus na to, jak se nástroj instaluje a aktualizuje.

### 0.2 Klíčová rozhodnutí a co znamenají pro uživatele

| Rozhodl jsem | Co to znamená pro uživatele |
|---|---|
| Oddělení projektů hlídají **dvě nezávislé pojistky** místo jedné | I kdyby se programátor spletl, data z cizího projektu se neukážou. Druhá pojistka je přímo v databázi a nedá se obejít omylem. |
| API klíč patří **vždy právě jednomu projektu** a projekt se z klíče odvozuje, ne zadává | Klíč pro klienta A fyzicky nemá jak sáhnout na data klienta B. Nejde to ani omylem, ani schválně. |
| Kdo není členem projektu, dostane odpověď „nic takového neexistuje", ne „nemáte přístup" | Cizí člověk se z nástroje nedozví ani to, kolik projektů v něm je a jak se jmenují. |
| Hesla se ukládají moderním způsobem (Argon2id) a účet se po deseti špatných pokusech na čtvrt hodiny zamkne | Uhádnout heslo hrubou silou je prakticky nemožné. Cena: kdo si heslo nepamatuje, chvíli počká. |
| Zálohy se **samy pravidelně zkoušejí obnovit** | Nefunkční záloha se pozná dopředu, ne v okamžiku havárie. To je nejčastější důvod, proč lidé o data přijdou. |
| Aktualizace databáze jde jen dopředu, nikdy zpět | Aktualizace je bezpečná a otestovaná. Cena: návrat ke starší verzi nástroje jde jen obnovením ze zálohy. |
| Nástroj nikam nevolá, nikdy | Žádná licenční kontrola, žádná statistika o používání, žádné písmo stahované z Googlu. Instalace funguje i na serveru zcela odříznutém od internetu (kromě posílání e-mailů). |
| Šifrovací klíč instalace si drží provozovatel | Přístupy k rozesílání e-mailů (Amazon SES) jsou v databázi zašifrované. Kdo ukradne databázi, nezíská je. Cena: kdo ztratí klíč, musí je zadat znovu. |

### 0.3 Oddělení projektů a API klíčů, vysvětleno bez žargonu

**Co je API klíč.** Je to dlouhé heslo, které si vloží programátor do e-shopu, aby si e-shop mohl s mailingovým nástrojem povídat sám (například „zákazník právě nakoupil, přidej ho do seznamu"). Na rozdíl od hesla ho nezadává člověk, leží zapsané v konfiguraci e-shopu.

**V čem je problém u Sendy**, na který hlavní specifikace reaguje: v Sendy má jeden API klíč přístup do všech projektů najednou. Když tedy agentura dá klíč vývojáři e-shopu klienta A, dala mu tím zároveň přístup ke kontaktům všech ostatních jedenácti klientů. Vývojář o tom třeba ani neví. Když se klíč objeví v nějakém veřejném repozitáři kódu (což se stává běžně), uniknou data všech.

**Jak to řeším.** Klíč patří jednomu projektu a je to zapsané v samotném klíči, ne v požadavku. Rozdíl je zásadní a stojí za jednu větu navíc:

- Špatné řešení: e-shop pošle „jsem klíč XY a chci kontakty projektu 7". Nástroj musí ověřovat, jestli klíč na projekt 7 smí. Když se to na jednom místě zapomene, data uniknou.
- Moje řešení: e-shop pošle „jsem klíč XY a chci kontakty". Nástroj se podívá, ke kterému projektu klíč patří, a jiný projekt do odpovědi nedostane, protože se ho ani nemá jak zeptat. Není co zapomenout.

K tomu se přidává **druhá, nezávislá pojistka přímo v databázi.** Databáze má vlastní pravidlo: „ukazuj jen řádky projektu, ve kterém právě pracuješ". Když programátor někde zapomene projekt uvést, databáze nevrátí cizí data, vrátí prázdno. Chyba se tak projeví jako „nic tu není" a rychle se najde, místo aby se projevila jako tichý únik, kterého si nikdo nevšimne.

**Co uživatel reálně uvidí.** V nastavení projektu si vytvoří klíč, zaškrtne, co smí (například jen zakládat kontakty, ale ne odesílat kampaně), a klíč se mu zobrazí **jedenkrát**. Potom už nikdy, ani nám. Kdyby ho ztratil, vytvoří nový a starý zruší. V přehledu vidí, kdy byl každý klíč naposledy použit, takže pozná nepoužívané klíče a může je zrušit.

**Co to nechrání.** Kdo získá přístup přímo k serveru nebo k databázi, získá vše. Proti tomu nepomáhá oddělení projektů, ale zabezpečení serveru a zálohy. Je poctivé to říct nahlas.

### 0.4 Instalace a aktualizace, vysvětleno bez žargonu

**Slib produktu:** „`docker compose up` a za pět minut to běží."

**Co to znamená.** Docker je způsob, jak dodat hotový program včetně všeho, co potřebuje, v jednom balíku. Provozovatel nemusí nic instalovat ani nastavovat verze knihoven. Stáhne si jeden textový soubor s popisem (`docker-compose.yml`), spustí jeden příkaz a nástroj běží.

**Co musí uživatel umět.** Nemusí být programátor, ale musí zvládnout tohle:

1. Mít server s Linuxem a nainstalovaným Dockerem (u běžného hostingu je to jedno zaškrtnutí, u VPS asi deset minut podle návodu).
2. Vygenerovat si jeden bezpečnostní klíč. Bude na to připravený příkaz, výsledek se zkopíruje do konfigurace.
3. Vyplnit adresu, na které nástroj poběží.
4. Nasměrovat na server doménu a nastavit certifikát pro https. Tohle je z celé instalace nejpracnější část a je stejná jako u jakéhokoliv jiného self-hosted nástroje.

**Co ho může potkat.** Nejčastější potíže jsem se snažil ošetřit tak, aby nástroj poradil, ne aby jen spadl:

| Situace | Co uživatel uvidí |
|---|---|
| Zapomene bezpečnostní klíč | Nástroj se nespustí a vypíše, která hodnota chybí a jak si ji vygenerovat. Vypíše **všechny** chybějící hodnoty najednou, ne jednu po druhé. |
| Špatně vyplní víc hodnot | Totéž, všechny problémy naráz. |
| Nemá dost paměti | Doporučená konfigurace je v dokumentaci. Návrh počítá s tím, že nástroj poběží na serveru s 2 GB paměti. |
| Databáze ještě nenaběhla | Nástroj počká, nepadá v cyklu. |
| Aktualizace databáze se nezdaří | Nástroj se přepne do omezeného režimu, zobrazí vysvětlení a nezkouší se donekonečna restartovat. Data zůstanou nedotčená. |

**Je pět minut realistických?** Samotné spuštění ano, cíl je do 60 sekund od příkazu po funkční nástroj. Pět minut je realistických, když už má uživatel Docker a doménu připravené. Kompletní start od prázdného serveru včetně domény a certifikátu je spíš půl hodiny až hodina. Doporučuju v marketingu slibovat „do pěti minut běží", ne „do pěti minut máte hotovo", a v dokumentaci mít i tu delší cestu poctivě popsanou.

**Aktualizace:** `docker compose pull && docker compose up -d`. Stáhne se nová verze a nahradí starou. Data zůstávají mimo balík, takže se jich to nedotkne. Úpravy databáze si nástroj udělá sám při startu. Když běží víc kopií nástroje najednou, úpravu provede právě jedna a ostatní počkají, takže se databáze nepoškodí.

**Před aktualizací záloha.** Je připravený i opatrnější příkaz, který nejdřív udělá zálohu, pak teprve aktualizuje. Doporučuju ho v dokumentaci uvádět jako výchozí postup pro kohokoliv s reálnými daty, a jednoduchou variantu nechat pro zkoušení.

**Co v záloze je a co ne.** V záloze jsou všechna data a nahrané obrázky. **Není v ní bezpečnostní klíč**, a je to schválně: kdo ukradne zálohu, nezíská přístupy k rozesílání. Cena je, že provozovatel si musí klíč uložit sám, jinak mu záloha bude z části k ničemu. Záloha to sama pozná a upozorní na to. Tenhle kompromis je jedno z míst, kde chci potvrzení, že je zvolený správně.

### 0.5 Co uživatel získá a co ztratí

| Získá | Ztratí |
|---|---|
| Jistotu, že se klienti navzájem neuvidí, ověřenou automatickými testy | Nic |
| Jeden příkaz na instalaci a jeden na aktualizaci | Musí umět zacházet se serverem a doménou |
| Zálohy, které se samy zkoušejí obnovit | Zálohy zabírají místo na disku |
| Nulovou komunikaci s naším ani cizím cloudem | Nemáme od uživatelů žádnou zpětnou vazbu o chybách; podpora se bude opírat o to, co uživatel pošle sám |
| Zašifrované přístupy k rozesílání | Kdo ztratí klíč, musí je zadat znovu |
| Kompletní záznam o tom, kdo co v projektu udělal | Záznam obsahuje IP adresy, takže se ho týká GDPR; drží se dva roky a jde to zkrátit |
| Přístup k celému nástroji přes rozhraní pro programátory | Nic, je to navíc |
| Aktualizace, které se nedají pokazit polovičním provedením | Návrat na starší verzi jen obnovením ze zálohy |

### 0.6 Co to znamená pro provoz a náklady

- **Server.** Doporučená minimální konfigurace: 2 jádra, 2 GB paměti, 20 GB disku plus místo na zálohy. To je nejlevnější kategorie VPS, řádově stovky korun měsíčně. Nástroj běží ve výchozím nastavení jako jeden balík se třemi vnitřními částmi; větší nasazení je může rozdělit, ale do začátku to není potřeba.
- **Databáze.** Buď ji nástroj přinese s sebou (nic se nenastavuje), nebo se připojí k té, kterou už provozovatel má. Obojí je podporované jedním přepínačem.
- **Zálohy.** Denně ve 3 ráno, drží se čtrnáct dní, vždy ale zůstanou aspoň tři poslední. Místo na disku závisí na počtu kontaktů; u sta tisíc kontaktů jde o jednotky gigabajtů celkem.
- **Žádné další služby.** Nepotřebujeme Redis ani jinou pomocnou databázi, což je jeden kontejner navíc, který by musel někdo provozovat a zálohovat. Bude potřeba, teprve až se nástroj bude provozovat ve víc kopiích naráz.
- **Provozní práce.** Realisticky: aktualizace jednou za čas, občas kouknout na e-mail o výsledku zálohy. Nic denního.

### 0.7 Otázky pro recenzenta

Na všechny jde odpovědět bez znalosti kódu.

1. **Zálohy neobsahují bezpečnostní klíč.** Chrání to zálohu při krádeži, ale znamená to, že provozovatel si klíč musí uložit zvlášť, jinak po havárii bude muset znovu zadat přístupy k rozesílání. Je to správný kompromis, nebo má být klíč v záloze a bezpečnost řešit šifrováním celé zálohy?
2. **Editor smí odeslat kampaň**, ale nesmí měnit nastavení rozesílání ani exportovat kontakty. Sedí to na to, jak budou nástroj lidé používat, nebo má odeslání vyžadovat schválení od správce?
3. **Prohlížeč kontaktů (role „viewer") nesmí exportovat kontakty**, protože export je jednorázový odnos celé databáze. Je to příliš přísné?
4. **Návrat na starší verzi nástroje jde jen obnovením ze zálohy.** Je to přijatelné, nebo je potřeba investovat do plnohodnotného návratu zpět, což je výrazně dražší a v praxi stejně málokdy funguje?
5. **Registrace je ve výchozím stavu zavřená** a účty zakládá vlastník projektu pozvánkou. Souhlasíte, nebo má být nástroj po instalaci otevřený registracím?
6. **Záznam o činnosti v projektu se drží dva roky.** Obsahuje IP adresy, takže je to osobní údaj. Je dva roky rozumné, nebo raději kratší?
7. **Slib „do pěti minut" v marketingu.** Souhlasíte s formulací „do pěti minut běží" místo „do pěti minut máte hotovo", vzhledem k tomu, že doména a certifikát zaberou déle?
8. **Název produktu.** Pracovně používám OpenEngage. Název je zapečený v identifikátorech klíčů, v adresách i v bezpečnostních podpisech, a jeho pozdější změna znamená přepis podepsaných formátů. Je potřeba ho rozhodnout dřív, než se začne psát kód. Kdy to půjde?

---

## 0.8 Jak číst tento dokument (od sem dál je to technické)

Tenhle dokument je základ, na kterém staví části 2 až 5. Všechno, co je tady označené jako **konvence** nebo **kontrakt**, je závazné a ostatní části to nesmí předefinovat. Když jiná část potřebuje výjimku, patří to do její sekce "Rozpory", ne do vlastního odlišného řešení.

Tři úrovně závaznosti:

| Značka | Význam |
|---|---|
| **KONTRAKT** | Zmrazeno po hodině 2 hackathonu. Změna jen společným rozhodnutím a s novou verzí formátu. Platí pro čtyři kontrakty TS ↔ Go v sekci 4.10. |
| **KONVENCE** | Závazné pro všechny části. Změna přes synchronizaci, ne jednostranně. |
| **DOPORUČENÍ** | Výchozí volba, od které se lze odchýlit se zdůvodněním v dané části. |

### Mapa kontrolních otázek ze zadání

| # | Otázka | Sekce |
|---|---|---|
| 1 | Vynucení izolace projektů, test na cizí projekt | 3.6 |
| 2 | Formát API klíče, časově konstantní ověření, scopes | 3.5 |
| 3 | Matice rolí a oprávnění | 3.4 |
| 4 | Session model | 3.2 |
| 5 | Formát chybové odpovědi, katalog kódů | 4.2 |
| 6 | Rate limiting | 4.5 |
| 7 | Verzování API, definice breaking change | 4.6 |
| 8 | Zdroj pravdy pro OpenAPI | 4.7 |
| 9 | Definice čtyř kontraktů, golden fixtures, CI | 4.10 |
| 10 | Multi-stage Dockerfile, healthcheck, graceful shutdown | 3.12 |
| 11 | Migrace při startu s víc replikami (advisory lock) | 3.13 |
| 12 | Úplný seznam konfiguračních proměnných | 4.9 |
| 13 | Zálohování, obnova, ověření obnovy | 3.14 |
| 14 | Politika migrací, selhání uprostřed, downgrade | 3.13 |
| 15 | Rotace `SECRET_KEY` | 3.10 |
| 16 | i18n: katalogy, pluralizace, formátování, fallback | 3.9 |
| 17 | Doručování odchozích webhooků | 3.8 |
| 18 | CI: blokující joby, limity, testy senderu | 3.15 |

---

## 1. Rozsah

### 1.1 Co tato část vlastní

- Struktura monorepa, build, sdílené konfigurace, konvence pojmenování (3.11)
- Konvence databáze jako celku: pojmenování, typy, časová razítka, měkké mazání, partitioning, migrace, verzování schématu (2.1 až 2.3, 3.13)
- Autentizace, uživatelé, hesla, sessions (3.1, 3.2)
- Workspaces, členství, pozvánky, role a oprávnění (3.3, 3.4)
- API klíče, veřejné klíče, scopes, ověřování (3.5)
- Model izolace workspace a jeho vynucení na dvou vrstvách (3.6)
- Audit log (3.7)
- Framework veřejného API: routing, validace, chyby, stránkování, idempotence, rate limiting, verzování, OpenAPI (4.1 až 4.8)
- Infrastruktura odchozích webhooků: doručování, retry, podpisy, deaktivace, log (3.8)
- i18n infrastruktura (3.9)
- Design systém a layout aplikace (5)
- Docker image, compose, konfigurace, healthchecky, graceful shutdown (3.12, 4.9)
- Zálohování, obnova, upgrade (3.14)
- CI, testovací strategie, licenční brána (3.15)
- **Čtyři kontrakty TS ↔ Go** (4.10)

### 1.2 Co tato část vědomě nevlastní

| Oblast | Vlastník |
|---|---|
| Doménová data kontaktů, seznamů, souhlasů, segmentů | část 2 |
| Šablony, blokový model, renderer, AI, assety | část 3 |
| Kampaně, outbox operační parametry, provideri, doručitelnost | část 4 |
| Tracking, timeline, reporty, web SDK | část 5 |
| Konkrétní endpointy jednotlivých domén | příslušná část, podle konvencí ze 4.1 |
| Obsah a payload konkrétních webhookových událostí | část, které událost patří |
| Vokativ, česká morfologie | část 2 |

Dvě záměrné výjimky, kde tato část zasahuje do cizího území, protože jde o zmrazený kontrakt:

1. **Kontraktní sloupce tabulky `messages`** (4.10.1). Část 4 vlastní tabulku jako celek, ale sloupce a stavy uvedené v kontraktu nesmí měnit. Část 4 smí přidávat sloupce a indexy.
2. **Formát trackovacích tokenů** (4.10.3). Část 5 vlastní sémantiku a použití tokenů, tato část vlastní bajtový formát, protože ho vyrábí Go a ověřuje TypeScript.

### 1.3 Slovník

| Pojem | Význam |
|---|---|
| workspace | Projekt v terminologii uživatele. Jednotka izolace dat, fakturace a odesílací reputace. |
| aktér (actor) | Uživatel se session, API klíč, nebo systém (job, migrace). |
| MODE | Provozní režim procesu: `web`, `worker`, `sender`, `all`. |
| sender | Kompilovaná Go binárka, konzument outboxu. |
| SECRET_KEY | Kořenový tajný klíč instalace, ze kterého se HKDF odvozují všechny ostatní klíče. |
| kontraktní sloupec | Sloupec, na který se spoléhá druhý jazyk. Nesmí změnit název, typ ani sémantiku bez nové verze kontraktu. |

---

## 2. Datový model

### 2.1 Konvence databáze (KONVENCE)

Platí pro všechny tabulky ve všech částech.

**Verze PostgreSQL: pravidlo, ne číslo. ROZHODNUTO.** Zadavatel rozhodl, že projekt cílí na **poslední produkční (stabilní) verzi PostgreSQL**. K 2026-07-31 je to **18** a to je hodnota, se kterou se pracuje všude v téhle části: Docker image `postgres:18-alpine`, testcontainers, CI. Až se produkční verzí stane 19, cílem je 19 a čísla se v dokumentaci přepíšou. Závazné je pravidlo, číslo je jen jeho dnešní hodnota. Pravidlo shodou okolností vyřešilo i rozpor R1 (viz sekce 11): 18 má vestavěnou funkci `uuidv7()`, kterou 17 nemá, takže `DEFAULT uuidv7()` v DDL drží. Rozšíření: `citext` (jen pro e-maily). `pgcrypto` není potřeba, `gen_random_uuid()` i `uuidv7()` jsou v jádře.

**Pojmenování**

| Objekt | Pravidlo | Příklad |
|---|---|---|
| Tabulka | `snake_case`, množné číslo | `api_keys`, `webhook_deliveries` |
| Sloupec | `snake_case`, jednotné číslo | `workspace_id`, `created_at` |
| Cizí klíč | `<jednotné_číslo_cílové_tabulky>_id` | `workspace_id`, `user_id` |
| Boolean | bez prefixu `is_`, kladná formulace | `active`, `verified`, ne `is_not_disabled` |
| Časové razítko | sufix `_at` | `created_at`, `revoked_at` |
| Index | `idx_<tabulka>__<sloupce>` | `idx_api_keys__workspace_id` |
| Unikátní index | `uq_<tabulka>__<sloupce>` | `uq_contacts__workspace_email` |
| Cizí klíč (constraint) | `fk_<tabulka>__<cílová_tabulka>` | `fk_memberships__workspaces` |
| Check | `ck_<tabulka>__<popis>` | `ck_messages__status` |
| Partition | `<tabulka>_yYYYYmMM` | `web_events_y2026m08` |
| Enum | **nepoužíváme nativní `CREATE TYPE`** | viz níže |

**Enumy: `text` + `CHECK`, ne nativní typ.** Nativní enum v Postgresu nejde bezpečně měnit v transakci ve všech verzích a jeho úprava je zámek nad tabulkou. `text NOT NULL CHECK (status IN (...))` se mění jedním `ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT NOT VALID` a je čitelný ve všech klientech i v Go. Drizzle stranu typuje přes `text().$type<Status>()`.

**Primární klíče: `uuid` s hodnotou UUIDv7.** Ne `bigserial`, protože ID cestují mezi službami, do URL, do tokenů a do webhooků a nesmí prozrazovat objemy. Ne UUIDv4, protože náhodné klíče roztrhají B-tree při zápisu. Zdroj hodnoty:

- Sloupec má `DEFAULT uuidv7()` pro řádky vkládané SQL.
- TypeScript generuje ID v aplikaci přes `uuid` balíček (`v7()`), aby bylo ID známé před `INSERT` (potřeba pro idempotenci a logování).
- Go generuje přes `github.com/google/uuid` (`uuid.NewV7()`).

Výjimka: spojovací tabulky bez vlastní identity (`contact_tags`) mají složený primární klíč.

**Časová razítka**

- Vždy `timestamptz`, nikdy `timestamp`. Databáze běží v `UTC` (`ALTER DATABASE ... SET timezone = 'UTC'`), převod do lokální zóny dělá aplikace.
- Každá tabulka má `created_at timestamptz NOT NULL DEFAULT now()`.
- Tabulka, jejíž řádky se mění, má i `updated_at timestamptz NOT NULL DEFAULT now()`. Aktualizuje ho **aplikace explicitně**, ne trigger. Důvod: trigger je neviditelná magie, kterou Go strana nezná, a u `messages` by běžel milionkrát za kampaň.
- Append-only tabulky (`audit_log`, `consents`, `message_events`, `web_events`) `updated_at` nemají a mají `REVOKE UPDATE, DELETE` pro aplikační roli.

**Měkké mazání**

Měkké mazání používáme **jen tam, kde je vyjmenované**, ne plošně. Plošné `deleted_at` je zdroj chyb, protože se na něj zapomene ve `WHERE`.

Tabulky s měkkým mazáním: `workspaces`, `users`, `contacts`, `lists`, `segments`, `templates`, `campaigns`, `webhook_endpoints`, `api_keys` (jako `revoked_at`).

Pravidla:
- Sloupec `deleted_at timestamptz` (NULL = živý záznam).
- Unikátní indexy nad měkce mazanými tabulkami jsou **částečné**: `... WHERE deleted_at IS NULL`. Bez toho nejde znovu použít stejný e-mail nebo slug po smazání.
- Repository vrstva přidává `deleted_at IS NULL` automaticky. Čtení smazaných záznamů vyžaduje explicitní `includeDeleted: true`, které je povolené jen pro audit a GDPR export.
- Tvrdé smazání dělá jen retenční job (část 2) a GDPR výmaz.

**Cizí klíče a mazání**

| Vztah | Pravidlo |
|---|---|
| Cokoliv → `workspaces` | `ON DELETE CASCADE` |
| Cokoliv → `users` | `ON DELETE RESTRICT`, pokud jde o vlastnictví; `ON DELETE SET NULL` u auditních odkazů |
| Řádek → nadřazená doména ve stejném workspace | `ON DELETE CASCADE` |
| Odkaz do jiné domény, který smí zůstat viset | `ON DELETE SET NULL` + sloupec je nullable |

Smazání workspace je jediná operace, která maže data kaskádou. Je nevratná, vyžaduje roli owner a potvrzení opsáním názvu workspace.

**Peníze a čísla**: `numeric(18,6)` pro částky, nikdy `float`. Počty `integer`, objemy nad 2 miliardy `bigint`.

**Textová pole**: `text` bez limitu délky v DB. Limit vynucuje validace v aplikaci (zod), protože chybová hláška z `varchar(255)` je pro uživatele nepoužitelná. Výjimka: sloupce s indexem, kde limit chrání velikost indexu, mají `CHECK (length(col) <= N)`.

**JSONB**: `jsonb`, ne `json`. Vždy `NOT NULL DEFAULT '{}'::jsonb` u konfiguračních sloupců, aby aplikace nemusela řešit NULL. GIN index jen tam, kde se v jsonb skutečně vyhledává, protože GIN index zdraží zápis.

**Partitioning (KONVENCE)**

**Úplný seznam partitionovaných tabulek.** Kdo přidá partitionovanou tabulku a nezapíše ji sem, dostane selhání zápisu od první minuty provozu, protože výchozí partition je zakázaná.

| Tabulka | Vlastník | Partitioning sloupec |
|---|---|---|
| `messages` | část 4a | `created_at` |
| `message_events` | část 4a | `received_at` |
| `provider_event_receipts` | část 4a | `received_at` |
| `web_events` | část 5 | `received_at` |
| `webhook_events` | část 1 | `created_at` |
| `webhook_deliveries` | část 1 | `created_at` |
| `audit_log` | část 1 | `created_at` |

- Vždy `PARTITION BY RANGE (<sloupec z tabulky výše>)`, měsíční okna, hranice v UTC.
- Primární klíč partitionované tabulky musí obsahovat partitioning key: `PRIMARY KEY (id, <sloupec>)`. Cizí klíče do partitionované tabulky proto nejsou možné, což je záměrné, tyhle tabulky jsou koncové.

**Partitioning sloupec musí být čas, který generujeme my (KONVENCE).**

`message_events` a `provider_event_receipts` nesou dva časy: `ts` (kdy událost nastala u providera) a `received_at` (kdy dorazila k nám). Partitionovat se smí **jen podle `received_at`**.

Důvod je provozní, ne estetický. `ts` je hodnota dodaná třetí stranou a nemáme nad ní kontrolu. SES pošle zpožděný bounce s časovou značkou mimo existující okno, nebo přijde událost s časem posunutým kvůli špatně nastaveným hodinám, a protože výchozí partition zakazujeme, **zápis tvrdě selže a událost o doručení se ztratí**. `received_at` je vždy `now()`, tedy monotónní a vždy uvnitř existujícího okna. `ts` zůstává běžným indexovaným sloupcem a řadí se podle něj timeline.

Stejné pravidlo platí pro jakoukoliv budoucí tabulku, do které zapisujeme data z cizího systému.
- Partition se zakládá **dopředu**: job `platform.maintain_partitions` běží denně ve 02:00 UTC a zajistí existenci partition pro aktuální a následující **tři** měsíce. Tři měsíce dopředu proto, aby výpadek workeru na týden neshodil zápis.
- Při startu aplikace se stejná logika pustí synchronně jednou, aby čerstvá instalace měla partition ihned.
- Výchozí partition (`DEFAULT`) **nezakládáme**. Zápis mimo existující partition má selhat hlasitě, ne skončit v koši, ze kterého se pak nedá odpojit rozsah.

**Kdo zakládá a kdo odpojuje (KONVENCE, rozdělení odpovědnosti)**

Tohle rozdělení existuje proto, aby se dva joby nepraly o stejnou partition.

| Operace | Kdo | Poznámka |
|---|---|---|
| `CREATE PARTITION` | **jen** `platform.maintain_partitions` (část 1) | jednotně pro všechny tabulky, tři měsíce dopředu |
| `DETACH` a `DROP PARTITION` | **jen retenční job vlastníka tabulky** | část 1 to nedělá za nikoho, protože jen vlastník ví, kdy jsou data zbytná |

Retenční job vlastníka **musí** před odpojením ověřit, že v rozsahu partition neleží nic rozpracovaného. U `messages` to plyne z invariantu I1 v 4.10.1: celá kampaň leží v jedné partition vybrané při materializaci, takže dlouho pozastavená kampaň by si jinak přišla o outbox pod rukama a po obnovení by se tvářila jako doběhlá, přestože neodeslala nic.

Minimální veto, které musí retenční job implementovat:

```sql
-- 1. neleží v rozsahu partition kampaň, která ještě žije?
SELECT 1 FROM campaigns
 WHERE audience_built_at >= $from AND audience_built_at < $to
   AND status IN ('queueing','sending','paused') LIMIT 1;

-- 2. neleží v ní zpráva, která ještě neodešla?
SELECT 1 FROM messages
 WHERE created_at >= $from AND created_at < $to
   AND status IN ('pending','claimed') LIMIT 1;
```

Když kterákoliv vrátí řádek, partition se neodpojí a zkusí se to při dalším běhu.

**Sdílené utility**

`packages/db` exportuje `createMonthlyPartitions(table, column, from, months, storageOptions?)` a `dropPartitionsBefore(table, column, date, veto?)`. Jsou jediným místem, kde se DDL partition generuje.

Parametr `column` je povinný, protože ne všechny tabulky partitionují podle `created_at`, viz tabulka výše. `storageOptions` slouží k nastavení `fillfactor` a autovacuum prahů, které nejdou nastavit na partitionované tabulce jako celku (viz `messages` v 4.10.1). `veto` je predikát dodaný vlastníkem, bez kterého `dropPartitionsBefore` odmítne cokoliv odpojit.

**Odkaz na řádek partitionované tabulky nese obě složky klíče (KONVENCE)**

> Každý odkaz na řádek partitionované tabulky, ať už z jiné tabulky, z API odpovědi, z payloadu webhooku, z trackovacího tokenu, z jobu nebo z logu, **musí nést obě složky primárního klíče**. Dotaz na jeden řádek bez druhé složky je chyba, kterou musí zachytit review.

Sloupec s druhou složkou se jmenuje `<entita>_<partitioning_sloupec>`, tedy `message_created_at`, `web_event_received_at`. Bez téhle konvence vypadá `WHERE id = $1` jako správný dotaz, přitom prohledá všechny partition, a projeví se to až na objemu dat, kdy je pozdě. Cizí klíče to nevynutí, protože do partitionované tabulky nejdou.

### 2.2 Konvence Drizzle schématu (KONVENCE)

- Jediný vlastník schématu je `packages/db`. Žádná jiná složka nesmí definovat tabulku.
- Soubor na doménu: `packages/db/src/schema/identity.ts`, `contacts.ts`, `campaigns.ts`, `tracking.ts`, `platform.ts`. Reexport z `schema/index.ts`.
- Každá tabulka exportuje i odvozené typy: `export type ApiKey = typeof apiKeys.$inferSelect;` a `ApiKeyInsert = typeof apiKeys.$inferInsert;`.
- Migrace se generují `drizzle-kit generate` do `packages/db/migrations`. Soubory se **commitují** a už se needitují.
- `breakpoints: true` v `drizzle.config.ts`, aby šlo poznat hranice příkazů.
- Ruční migrace (backfill, partitioning DDL, RLS politiky, GRANTy) se zakládají přes `drizzle-kit generate --custom --name=<popis>`.
- Sender **nemá** Drizzle. Go strana má ručně psané SQL v `apps/sender/internal/store` a v CI se ověřuje testem proti čerstvě zmigrované databázi, že očekávané sloupce existují a mají očekávaný typ (viz 3.15, job `contracts-schema`).

### 2.3 DDL tabulek platformy a identity

Všechny tabulky v této sekci vlastní část 1.

```sql
-- ---------------------------------------------------------------------------
-- users: účet člověka, globální napříč workspaces
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  email               citext NOT NULL,
  email_verified_at   timestamptz,
  password_hash       text NOT NULL,              -- PHC řetězec argon2id, viz 3.1
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  name                text NOT NULL DEFAULT '',
  locale              text NOT NULL DEFAULT 'cs',
  timezone            text NOT NULL DEFAULT 'Europe/Prague',
  status              text NOT NULL DEFAULT 'active',
  failed_login_count  integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT ck_users__status CHECK (status IN ('active','suspended')),
  CONSTRAINT ck_users__locale CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$')
);
-- Přihlášení hledá podle e-mailu. Částečný, aby šlo znovu založit účet po smazání.
CREATE UNIQUE INDEX uq_users__email ON users (email) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- sessions: přihlášení do UI. Token se ukládá jen jako SHA-256.
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash     bytea NOT NULL,                  -- SHA-256 z tokenu, 32 B
  csrf_secret    bytea NOT NULL,                  -- 32 B, viz 4.1 CSRF
  user_agent     text NOT NULL DEFAULT '',
  ip             inet,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason text
);
-- Ověření session na každém requestu: jediný lookup podle hashe.
CREATE UNIQUE INDEX uq_sessions__token_hash ON sessions (token_hash);
-- "Odhlásit ze všech zařízení" a výpis relací uživatele.
CREATE INDEX idx_sessions__user_id ON sessions (user_id) WHERE revoked_at IS NULL;
-- Úklidový job maže expirované relace.
CREATE INDEX idx_sessions__absolute_expires_at ON sessions (absolute_expires_at);

-- ---------------------------------------------------------------------------
-- workspaces: projekt
-- ---------------------------------------------------------------------------
CREATE TABLE workspaces (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  name          text NOT NULL,
  slug          text NOT NULL,
  locale        text NOT NULL DEFAULT 'cs',
  timezone      text NOT NULL DEFAULT 'Europe/Prague',
  address_form  text NOT NULL DEFAULT 'formal',   -- formal | informal, viz 6.3 hlavní spec
  settings      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT ck_workspaces__slug CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  CONSTRAINT ck_workspaces__address_form CHECK (address_form IN ('formal','informal'))
);
-- Slug je v URL, musí být unikátní mezi živými workspaces.
CREATE UNIQUE INDEX uq_workspaces__slug ON workspaces (slug) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- memberships: kdo má do workspace přístup a v jaké roli
-- ---------------------------------------------------------------------------
CREATE TABLE memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT ck_memberships__role CHECK (role IN ('owner','admin','editor','viewer'))
);
-- Přepínač projektů: "které workspaces vidí tento uživatel".
CREATE INDEX idx_memberships__user_id ON memberships (user_id);
-- Nejvýš jeden owner na workspace není vynuceno indexem, vynucuje ho 3.3.

-- ---------------------------------------------------------------------------
-- invitations: pozvánka do workspace
-- ---------------------------------------------------------------------------
CREATE TABLE invitations (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        citext NOT NULL,
  role         text NOT NULL,
  token_hash   bytea NOT NULL,
  invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  accepted_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_invitations__role CHECK (role IN ('owner','admin','editor','viewer'))
);
-- Přijetí pozvánky jde přes token z odkazu v e-mailu.
CREATE UNIQUE INDEX uq_invitations__token_hash ON invitations (token_hash);
-- Jedna aktivní pozvánka na e-mail a workspace, jinak se nedá poznat, která platí.
CREATE UNIQUE INDEX uq_invitations__ws_email_pending ON invitations (workspace_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- api_keys: serverový klíč, vždy právě k jednomu workspace
-- ---------------------------------------------------------------------------
CREATE TABLE api_keys (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  kind          text NOT NULL DEFAULT 'secret',   -- secret | public
  prefix        text NOT NULL,                    -- 8 znaků base32, viz 3.5
  secret_hash   bytea,                            -- SHA-256, NULL pro kind='public'
  scopes        text[] NOT NULL DEFAULT '{}',
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_api_keys__kind CHECK (kind IN ('secret','public')),
  CONSTRAINT ck_api_keys__secret_hash CHECK (
    (kind = 'secret' AND secret_hash IS NOT NULL) OR
    (kind = 'public' AND secret_hash IS NULL)
  )
);
-- Ověření klíče: jediný lookup podle prefixu, pak časově konstantní porovnání hashe.
CREATE UNIQUE INDEX uq_api_keys__prefix ON api_keys (prefix);
-- Výpis klíčů v nastavení projektu.
CREATE INDEX idx_api_keys__workspace_id ON api_keys (workspace_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- idempotency_keys: ochrana zápisových endpointů proti opakování
-- ---------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key              text NOT NULL,
  fingerprint      bytea NOT NULL,       -- SHA-256(method|path|canonical body)
  status           text NOT NULL,        -- in_progress | completed
  response_status  integer,
  response_body    jsonb,
  locked_at        timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  expires_at       timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, key),
  CONSTRAINT ck_idempotency_keys__status CHECK (status IN ('in_progress','completed')),
  CONSTRAINT ck_idempotency_keys__key_len CHECK (length(key) BETWEEN 8 AND 255)
);
-- Úklid po expiraci.
CREATE INDEX idx_idempotency_keys__expires_at ON idempotency_keys (expires_at);

-- ---------------------------------------------------------------------------
-- audit_log: append only, partitionovaný po měsících
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id            uuid NOT NULL DEFAULT uuidv7(),
  workspace_id  uuid,                   -- NULL u globálních akcí (např. změna hesla)
  actor_type    text NOT NULL,          -- user | api_key | system
  actor_id      uuid,
  actor_label   text NOT NULL DEFAULT '',  -- e-mail nebo název klíče v okamžiku akce
  action        text NOT NULL,          -- např. api_key.created
  target_type   text,
  target_id     uuid,
  ip            inet,
  user_agent    text,
  request_id    text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_audit_log__actor_type CHECK (actor_type IN ('user','api_key','system'))
) PARTITION BY RANGE (created_at);
-- Hlavní pohled: audit jednoho projektu v čase, nejnovější první.
CREATE INDEX idx_audit_log__ws_created ON audit_log (workspace_id, created_at DESC);
-- Dohledání "co dělal tenhle aktér".
CREATE INDEX idx_audit_log__actor ON audit_log (actor_type, actor_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- webhook_endpoints a doručování
-- ---------------------------------------------------------------------------
CREATE TABLE webhook_endpoints (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url                  text NOT NULL,
  description          text NOT NULL DEFAULT '',
  event_types          text[] NOT NULL,
  secret_encrypted     text NOT NULL,          -- obálka podle 4.10.4, context 'webhook_secret'
  status               text NOT NULL DEFAULT 'active',
  disabled_reason      text,
  disabled_at          timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  CONSTRAINT ck_webhook_endpoints__status CHECK (status IN ('active','disabled')),
  CONSTRAINT ck_webhook_endpoints__event_types CHECK (cardinality(event_types) BETWEEN 1 AND 50)
);
-- Fan-out události: "které aktivní endpointy v tomto workspace chtějí tento typ".
CREATE INDEX idx_webhook_endpoints__ws_active ON webhook_endpoints (workspace_id)
  WHERE deleted_at IS NULL AND status = 'active';
-- Vyhledání podle typu události přes pole.
CREATE INDEX idx_webhook_endpoints__event_types ON webhook_endpoints USING gin (event_types);

CREATE TABLE webhook_events (
  id           uuid NOT NULL DEFAULT uuidv7(),
  workspace_id uuid NOT NULL,
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  occurred_at  timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
-- Log událostí projektu v UI.
CREATE INDEX idx_webhook_events__ws_created ON webhook_events (workspace_id, created_at DESC);

CREATE TABLE webhook_deliveries (
  id                    uuid NOT NULL DEFAULT uuidv7(),
  workspace_id          uuid NOT NULL,
  endpoint_id           uuid NOT NULL,
  event_id              uuid NOT NULL,
  event_type            text NOT NULL,
  status                text NOT NULL DEFAULT 'pending',
  attempt               integer NOT NULL DEFAULT 0,
  next_attempt_at       timestamptz,
  response_status       integer,
  response_body_snippet text,               -- max 2 kB, viz 3.8
  duration_ms           integer,
  error_code            text,
  delivered_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_webhook_deliveries__status
    CHECK (status IN ('pending','delivering','succeeded','failed','abandoned'))
) PARTITION BY RANGE (created_at);
-- Detail endpointu v UI: poslední pokusy o doručení, nejnovější první.
CREATE INDEX idx_webhook_deliveries__endpoint ON webhook_deliveries (endpoint_id, created_at DESC);
-- Dohledání všech doručení jedné události (fan-out na víc endpointů).
CREATE INDEX idx_webhook_deliveries__event ON webhook_deliveries (event_id);

-- Idempotence fan-outu. POZOR, stejný případ jako uq_messages__campaign_contact:
-- unikátní index na partitionované tabulce MUSÍ obsahovat partition key, takže
-- (event_id, endpoint_id) samo o sobě neexistuje a nedá se vytvořit.
CREATE UNIQUE INDEX uq_webhook_deliveries__event_endpoint
  ON webhook_deliveries (event_id, endpoint_id, created_at);

-- ---------------------------------------------------------------------------
-- system_settings: jeden řádek, stav instalace
-- ---------------------------------------------------------------------------
CREATE TABLE system_settings (
  id                     boolean PRIMARY KEY DEFAULT true,
  installation_id        uuid NOT NULL DEFAULT uuidv7(),
  schema_version         integer NOT NULL,
  secret_key_fingerprint text NOT NULL,
  setup_completed_at     timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_system_settings__singleton CHECK (id = true)
);
```

Poznámka k `system_settings.id boolean PRIMARY KEY CHECK (id = true)`: je to standardní trik na tabulku s právě jedním řádkem. Bez něj se dřív nebo později objeví dva řádky konfigurace a nikdo nebude vědět, který platí.

### 2.4 Kompilované SQL nesmí volat `now()` (KONVENCE)

Platí pro každý dotaz generovaný z uživatelské definice, tedy pro kompilaci segmentů (část 2) i pro sestavení publika kampaně (část 4a).

> Kompilace dostává **povinný parametr `asOf: Date`** a všechny časové výrazy v relativních podmínkách (`za posledních N dní`, `poslední aktivita před`) se vyhodnocují proti němu. **`now()`, `current_timestamp` ani `CURRENT_DATE` se ve vygenerovaném SQL nesmí objevit.** Kontroluje to test kompilátoru a lint nad generovaným SQL.

Bez toho vrátí náhled počtu jiné číslo než materializace o dvě minuty později, materializace po dávkách dostane v každé dávce jiné publikum a dva dotazy nad stejným segmentem se nedají porovnat. U kampaně je `asOf` totožné s `campaigns.audience_built_at`, tedy s hodnotou, kterou vyžaduje invariant I1 v 4.10.1.

### 2.5 Rozšíření tabulky napříč částmi

Když jiná část potřebuje sloupec v tabulce, kterou vlastní část 1 (typicky `workspaces.settings`), platí:

- Doménové nastavení jde do `workspaces.settings` pod vlastní klíč jmenného prostoru: `settings.contacts`, `settings.sending`, `settings.tracking`, `settings.ai`.
- Tvar každého jmenného prostoru validuje zod schéma exportované z `packages/core/<domena>`, sloučené v `packages/db` do jednoho `WorkspaceSettingsSchema`.
- Nové sloupce v `workspaces` se nezavádějí, dokud podle nich není potřeba filtrovat nebo indexovat.
---

## 3. Doménová logika

### 3.1 Hesla a autentizace

**Hashování: Argon2id.** Knihovna `@node-rs/argon2` 2.0.2 (MIT), prebuilt binárky včetně `linux-x64-musl` a `linux-arm64-musl`, takže Alpine image funguje bez kompilátoru.

Parametry podle OWASP Password Storage Cheat Sheet (ověřeno 2026-07-31, varianta s nejvyšší pamětí z uvedeného seznamu):

| Parametr | Hodnota |
|---|---|
| algoritmus | Argon2id |
| memoryCost | 19456 KiB (19 MiB) |
| timeCost | 2 |
| parallelism | 1 |
| salt | 16 B, generuje knihovna |
| výstup | 32 B |
| formát v DB | PHC řetězec `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` |

Varianta `m=19456, t=2, p=1` je zvolená proto, že `m=47104` (46 MiB) při deseti souběžných přihlášeních znamená skoro půl gigabajtu špičkově, což je na self-hosted instalaci s 1 GB RAM nepříjemné.

**Rehash při přihlášení:** po úspěšném ověření se z PHC řetězce přečtou parametry. Když neodpovídají aktuálním, heslo se přehashuje a uloží. Tím se instalace samy posunou, až parametry zpřísníme.

**Pepper nepoužíváme.** Pepper by musel být odvozený ze `SECRET_KEY` a při jeho rotaci by se všechna hesla stala neověřitelnými, protože z hashe se heslo zpětně nezíská. Sekce 3.10 popisuje rotaci `SECRET_KEY` jako běžnou operaci, a to je s pepperem neslučitelné.

**Pravidla hesla**

| Pravidlo | Hodnota |
|---|---|
| minimální délka | 12 znaků |
| maximální délka | 256 znaků (nad limit odmítnout, ne ořezat) |
| složitost | žádné povinné třídy znaků |
| blocklist | prvních 10 000 nejčastějších hesel, seznam v repozitáři, porovnání po normalizaci na malá písmena |
| normalizace | Unicode NFKC před hashováním |
| shoda s e-mailem | zakázáno heslo obsahující lokální část e-mailu |

**Ochrana přihlašování**

| Vrstva | Limit | Chování při překročení |
|---|---|---|
| per účet | 10 neúspěchů | `users.locked_until = now() + 15 min`, chyba `account_locked` (423) |
| per IP | 20 pokusů / 5 min | `rate_limited` (429) |
| per IP a e-mail | 5 pokusů / 5 min | `rate_limited` (429) |

Neúspěšné přihlášení vrací vždy `invalid_credentials` (401) se stejnou latencí bez ohledu na to, jestli účet existuje. Když účet neexistuje, provede se hash nad dummy PHC řetězcem, aby se nedal měřit rozdíl.

Čítač `failed_login_count` se nuluje při úspěšném přihlášení a po vypršení `locked_until`.

**Reset hesla**

1. `POST /auth/password-reset` vrací vždy 202 bez ohledu na existenci účtu.
2. Token: 32 náhodných bajtů, base64url, v DB jen SHA-256, platnost 60 minut, jednorázový.
3. Tabulka `password_reset_tokens(id, user_id, token_hash, expires_at, used_at, created_at)` s `UNIQUE (token_hash)` a indexem na `user_id` pro invalidaci starých tokenů.
4. Nové vyžádání invaliduje předchozí nepoužité tokeny téhož uživatele.
5. Po úspěšné změně: `password_changed_at = now()`, revokace všech sessions uživatele, revokace všech nepoužitých reset tokenů, zápis do `audit_log`, informační e-mail.

**První spuštění**

Instalace bez jediného uživatele zobrazí průvodce na `/setup`. Endpoint `POST /api/v1/setup` je dostupný jen dokud `system_settings.setup_completed_at IS NULL` a `users` je prázdná; jinak vrací 409 `setup_already_completed`. Vytvoří prvního uživatele, první workspace, členství `owner` a nastaví `setup_completed_at`. Celé v jedné transakci.

**Registrace**

`SIGNUP_MODE` (4.9) řídí, kdo si smí založit účet:

| Hodnota | Chování |
|---|---|
| `closed` (výchozí) | registrace zakázaná, účty zakládá owner pozvánkou |
| `invite` | registrace jen s platným tokenem pozvánky |
| `open` | veřejná registrace, vyžaduje ověření e-mailu před prvním přihlášením |

### 3.2 Sessions (otázka 4)

**Model: opaque token v databázi, ne JWT.** Důvod: okamžitá revokace. JWT by znamenal buď krátkou platnost s refresh tokenem (složitější), nebo denylist v databázi (stejný počet dotazů jako opaque token, ale navíc kryptografie). Ověření session je jeden indexovaný lookup.

| Vlastnost | Hodnota |
|---|---|
| token | 32 náhodných bajtů z CSPRNG, base64url bez paddingu, 43 znaků |
| uložení | `sessions.token_hash` = SHA-256 z ASCII reprezentace tokenu |
| cookie | název `oe_session` |
| atributy | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` když `APP_URL` začíná `https://` |
| doména | atribut `Domain` se nenastavuje (host-only cookie) |
| absolutní platnost | 30 dní (`SESSION_ABSOLUTE_TTL_DAYS`) |
| nečinnost | 14 dní (`SESSION_IDLE_TTL_DAYS`) |
| obnova | `last_used_at` se zapisuje nejvýš jednou za 5 minut, aby se nezapisovalo při každém requestu |
| prodloužení absolutní platnosti | ne, po 30 dnech je nutné přihlášení |

Testovací vektor (SHA-256 z tokenu, závazný pro test):

```
token   = AQQHCg0QExYZHB8iJSgrLjE0Nzo9QENGSUxPUlVYW14
sha256  = 0a7edca7df64fa7710681987f4f809f6f72b37a34602c7472673009382665ecd
```

**Stavy session**

| Z | Do | Kdy |
|---|---|---|
| active | active | běžný request, aktualizace `last_used_at` |
| active | expired | `now() > absolute_expires_at` nebo `now() - last_used_at > idle TTL` |
| active | revoked | odhlášení, odhlášení všech, změna hesla, smazání uživatele, admin akce |
| expired / revoked | (nic) | žádný přechod zpět, nová session se zakládá znovu |

Expirovaná ani revokovaná session se z databáze nemaže hned, protože výpis "aktivní relace" má ukázat i to, kdy relace skončila. Maže je job `platform.cleanup_sessions` denně, mazání starších než 30 dní od skončení.

**Rotace tokenu:** token se rotuje při přihlášení (nová session) a při změně hesla. Při běžném requestu se nerotuje, protože rotace při každém requestu rozbije souběžné requesty z jedné karty.

**Odhlášení**

| Akce | Endpoint | Efekt |
|---|---|---|
| odhlásit | `POST /api/v1/auth/logout` | revokace aktuální session, smazání cookie |
| odhlásit všude | `POST /api/v1/auth/logout-all` | revokace všech sessions uživatele včetně aktuální |
| výpis relací | `GET /api/v1/auth/sessions` | seznam s IP, user agentem, `last_used_at`, příznakem `current` |
| revokace jedné | `DELETE /api/v1/auth/sessions/{id}` | jen vlastní relace |

**Změna hesla:** revokují se všechny sessions uživatele **kromě aktuální**, aby se uživatel nevyhodil sám. Do `revoked_reason` se zapíše `password_changed`.

**CSRF**

- Primární obrana: `SameSite=Lax` a kontrola hlavičky `Origin` u všech metod mimo `GET`, `HEAD`, `OPTIONS`. `Origin` musí odpovídat `APP_URL`. Chybějící `Origin` u non-GET requestu z prohlížeče je odmítnutý (`origin_not_allowed`, 403).
- Sekundární obrana pro formuláře a Server Actions: double submit token. `sessions.csrf_secret` (32 B) plus hlavička `X-CSRF-Token` s hodnotou `base64url(HMAC-SHA256(csrf_secret, "csrf"))`. Porovnání časově konstantní.
- Requesty ověřené API klíčem CSRF ochranu nemají a mít nemají, protože nepocházejí z prohlížeče a klíč se neposílá automaticky.

### 3.3 Workspaces, členství a pozvánky

**Invarianty**

1. Každý workspace má **právě jednoho** ownera. Vynuceno v aplikační transakci: změna role posledního ownera nebo jeho odebrání selže s `last_owner_cannot_be_removed` (409).
2. Uživatel bez jediného členství se po přihlášení dostane na obrazovku "nemáte přístup k žádnému projektu" s možností vytvořit nový, pokud to `SIGNUP_MODE` a jeho oprávnění dovolí.
3. Slug se generuje z názvu, při kolizi se přidá `-2`, `-3`. Uživatel ho může přepsat.

**Předání vlastnictví:** `POST /api/v1/workspaces/{id}/transfer-ownership` s `{ "user_id": "..." }`. Cílový uživatel musí být členem. V jedné transakci: cílový dostane `owner`, původní `admin`. Vyžaduje re-autentizaci heslem (hlavička `X-Reauth-Password`, platnost potvrzení 5 minut).

**Pozvánky**

| Vlastnost | Hodnota |
|---|---|
| token | 32 B, base64url, v DB jen SHA-256 |
| platnost | 7 dní |
| jednorázovost | ano, `accepted_at` |
| opakované pozvání téhož e-mailu | revokuje předchozí čekající pozvánku a vytvoří novou |
| pozvání již existujícího člena | 409 `already_member` |
| přijetí přihlášeným uživatelem s jiným e-mailem | povoleno, pozvánka váže roli, ne identitu; do auditu se zapíše obojí |
| maximum čekajících pozvánek | 100 na workspace |

Stavy pozvánky: `pending → accepted | revoked | expired`. `expired` není sloupec, počítá se z `expires_at`.

**Smazání workspace:** měkké (`deleted_at`), pak po 30 dnech tvrdé smazání retenčním jobem `platform.purge_workspaces`. Během 30 dnů jde obnovit (`POST /api/v1/workspaces/{id}/restore`, jen owner). Odesílání se zastaví okamžitě: materializace kampaní se přeruší, sender kampaně smazaného workspace ignoruje (kontrola `workspaces.deleted_at IS NULL` v claim dotazu, viz 4.10.1).

### 3.4 Role a oprávnění (otázka 3)

**Model:** role → množina oprávnění. Oprávnění je řetězec `resource:action`. API klíč nese scopes ze **stejného** jmenného prostoru, takže efektivní oprávnění je průnik role aktéra a scopes klíče (u klíče se role neuplatňuje, klíč má vlastní množinu, viz 3.5).

Kontrola v kódu je jediná funkce `assertPermission(ctx, 'campaigns:send')`, která hodí `ForbiddenError` s kódem `forbidden` nebo `insufficient_scope`.

**Úplná matice** (o = ano, prázdné = ne)

| Oprávnění | owner | admin | editor | viewer |
|---|---|---|---|---|
| `workspace:read` | o | o | o | o |
| `workspace:update` | o | o | | |
| `workspace:delete` | o | | | |
| `workspace:transfer` | o | | | |
| `members:read` | o | o | o | |
| `members:invite` | o | o | | |
| `members:update_role` | o | o | | |
| `members:remove` | o | o | | |
| `api_keys:read` | o | o | | |
| `api_keys:write` | o | o | | |
| `providers:read` | o | o | o | |
| `providers:write` | o | o | | |
| `domains:read` | o | o | o | o |
| `domains:write` | o | o | | |
| `contacts:read` | o | o | o | o |
| `contacts:write` | o | o | o | |
| `contacts:delete` | o | o | o | |
| `contacts:export` | o | o | | |
| `contacts:import` | o | o | o | |
| `lists:read` | o | o | o | o |
| `lists:write` | o | o | o | |
| `segments:read` | o | o | o | o |
| `segments:write` | o | o | o | |
| `suppressions:read` | o | o | o | o |
| `suppressions:write` | o | o | | |
| `templates:read` | o | o | o | o |
| `templates:write` | o | o | o | |
| `assets:read` | o | o | o | o |
| `assets:write` | o | o | o | |
| `campaigns:read` | o | o | o | o |
| `campaigns:write` | o | o | o | |
| `campaigns:send` | o | o | o | |
| `campaigns:control` | o | o | o | |
| `campaigns:delete` | o | o | | |
| `forms:read` | o | o | o | o |
| `forms:write` | o | o | o | |
| `events:write` | o | o | o | |
| `reports:read` | o | o | o | o |
| `timeline:read` | o | o | o | o |
| `webhooks:read` | o | o | o | |
| `webhooks:write` | o | o | | |
| `ai:use` | o | o | o | |
| `ai:configure` | o | o | | |
| `audit:read` | o | o | | |
| `backups:read` | o | | | |
| `backups:run` | o | | | |
| `gdpr:export` | o | o | | |
| `gdpr:erase` | o | | | |

Zdůvodnění tří netriviálních řádků:

- **`contacts:export` a `gdpr:*` nemá editor.** Export je jednorázový odnos celé databáze kontaktů. Editor má tvořit obsah a kampaně, ne odnášet PII.
- **`campaigns:send` má editor.** Bez toho by musel u každé kampaně čekat na admina a nástroj by byl nepoužitelný. Riziko se mitiguje tím, že editor nemůže měnit odesílací provider a kampaň jde zastavit.
- **`backups:*` má jen owner.** Záloha obsahuje data všech kontaktů projektu a metadata instalace.

**Chování při chybějícím oprávnění**

| Situace | Kód | HTTP |
|---|---|---|
| Aktér je členem, ale role nemá oprávnění | `forbidden` | 403 |
| API klíč nemá scope | `insufficient_scope` | 403 |
| Aktér není členem workspace | `not_found` | 404 |

Poslední řádek je záměrný. Kdyby neexistující členství vracelo 403, dalo by se z toho zjistit, které workspace ID existují. Pro aktéra bez členství workspace prostě neexistuje.

### 3.5 API klíče (otázka 2)

**Formát (KONVENCE)**

```
oe_<env>_<prefix>_<secret>
```

| Část | Obsah |
|---|---|
| `oe` | pevná značka produktu |
| `env` | `live` (jediná hodnota v MVP 0; `test` rezervováno) |
| `prefix` | 8 znaků, base32 malými písmeny (RFC 4648 abeceda `a-z2-7`, bez paddingu) z 5 náhodných bajtů |
| `secret` | 43 znaků, base64url bez paddingu z 32 náhodných bajtů |

Prefix je base32, ne base64url, **schválně**: base64url obsahuje `_`, což by rozbilo parsování podle oddělovače. Sekret může `_` a `-` obsahovat, protože je poslední.

Testovací vektor:

```
prefix (z bajtů a1b2c3d4e5)  = ugzmhvhf
secret (z bajtů ff fe ... e0) = __79_Pv6-fj39vX08_Lx8O_u7ezr6uno5-bl5OPi4eA
klíč                          = oe_live_ugzmhvhf___79_Pv6-fj39vX08_Lx8O_u7ezr6uno5-bl5OPi4eA
délka                         = 60 znaků
sha256(secret jako ASCII)     = 7ac21015d6000ce73d6f61c420ff4d5f0f3cc816da25b10726b74e8961cd925c
```

**Veřejný klíč pro web SDK**

```
oe_pub_<16 znaků base32 z 10 náhodných bajtů>     například  oe_pub_aebagbafaydqqcik
```

Veřejný klíč se ukládá **v otevřené podobě** (`secret_hash IS NULL`), protože je z definice veřejný, je v HTML stránky zákazníka a jeho jediná role je identifikovat workspace pro ingestion. Má pevně scope `['events:write']` a nic jiného mu nejde přidat (validace při vytvoření).

**Ověření (časově konstantní)**

1. Parsuj klíč regulárním výrazem `^oe_(live|test)_([a-z2-7]{8})_([A-Za-z0-9_-]{43})$`. Neshoda → `unauthenticated` (401), bez dotazu do databáze.
2. `SELECT ... FROM api_keys WHERE prefix = $1` (unikátní index). Nenalezeno → provede se **dummy porovnání** proti konstantnímu hashi, aby doba odpovědi nezávisela na existenci klíče, pak `unauthenticated`.
3. `crypto.timingSafeEqual(sha256(secret), row.secret_hash)`. `timingSafeEqual` vyhodí výjimku při rozdílné délce, proto se délka kontroluje předem regulárním výrazem.
4. Kontroly: `revoked_at IS NULL`, `expires_at IS NULL OR expires_at > now()`, `workspaces.deleted_at IS NULL`.
5. `last_used_at` se zapisuje **nejvýš jednou za 60 sekund** na klíč, mimo hlavní transakci (fire and forget). Bez toho by každý request na API znamenal zápis a `api_keys` by se stala nejzatíženější tabulkou v systému.

**Proč SHA-256 a ne Argon2:** sekret má 256 bitů entropie z CSPRNG. Slovníkový ani hrubý útok na takový vstup nedává smysl ani s nekonečným výpočetním výkonem, takže pomalý hash by jen přidal desítky milisekund na každý API request. U hesel je to naopak, protože entropie je nízká.

**Zobrazení sekretu:** jednou, hned po vytvoření, v odpovědi `POST /api/v1/api-keys`. Nikde jinde už nikdy. V seznamu se ukazuje `oe_live_ugzmhvhf_...`.

**Scopes**

- Množina je stejná jako oprávnění z 3.4. Klíč nemůže mít scope, který neexistuje (validace proti seznamu).
- Klíč nemá roli. Jeho oprávnění jsou přesně jeho scopes.
- Wildcard `*` **nepovolujeme**. Klíč s `*` je klíč, o kterém nikdo neví, co smí.
- Vyhodnocení: `assertPermission` u aktéra typu `api_key` kontroluje jen přítomnost řetězce v `scopes`.
- Klíč platí vždy jen pro `api_keys.workspace_id`. Neexistuje způsob, jak s ním sáhnout do jiného workspace, protože workspace se **nebere z requestu**, ale z klíče (viz 3.6).

**Rotace a revokace**

- `POST /api/v1/api-keys/{id}/rotate` vytvoří nový sekret a vrátí ho jednou. Starý přestane platit okamžitě. Volitelný parametr `grace_seconds` (0 až 86400, výchozí 0) nechá starý hash platit ještě uvedenou dobu; k tomu slouží sloupec `previous_secret_hash bytea` a `previous_expires_at timestamptz` (doplněk k DDL v 2.3).
- Revokace je okamžitá, `revoked_at = now()`. Revokovaný klíč se nemaže, aby audit dával smysl.

### 3.6 Izolace workspace (otázka 1)

**Odpověď: obojí, ve dvou nezávislých vrstvách.** Repository vrstva je primární obrana a jediná, na které závisí funkčnost. Row-level security je druhá vrstva, která zachytí chybu v první. Kdyby existovala jen RLS, každá chyba v nastavení session proměnné by tiše vrátila prázdné výsledky a nikdo by si nevšiml. Kdyby existovala jen repository vrstva, jeden zapomenutý `WHERE` by tiše vrátil cizí data.

**Vrstva 1: repository**

- Datový přístup jde výhradně přes `packages/db/src/repo/*`. Přímý import `db` mimo `packages/db` zakazuje ESLint pravidlo `no-restricted-imports` a CI job `lint`.
- Každá repository funkce bere jako první argument `WorkspaceContext`, ne `workspace_id: string`. Je to branded typ, který nejde vyrobit z řetězce:

```ts
declare const brand: unique symbol;
export type WorkspaceContext = {
  readonly [brand]: 'WorkspaceContext';
  readonly workspaceId: string;
  readonly actor: Actor;
};

export type Actor =
  | { type: 'user'; userId: string; role: Role }
  | { type: 'api_key'; apiKeyId: string; scopes: readonly Permission[] }
  | { type: 'system'; job: string };

// Jediná továrna, žije v packages/core/identity a ověřuje členství nebo klíč.
export function createWorkspaceContext(input: AuthenticatedRequest): Promise<WorkspaceContext>;
```

- Odkud se bere `workspaceId`:
  - Aktér `api_key`: z `api_keys.workspace_id`. **Nikdy z URL ani z těla requestu.** Kdyby v cestě byl jiný workspace, request skončí 404.
  - Aktér `user`: ze segmentu cesty `/w/{slug}` v UI, nebo z hlavičky `X-Workspace-Id` u API se session. Ověří se existence členství, jinak 404.
- Repository funkce sestavuje `WHERE workspace_id = $ctx` vždy. Testem se hlídá, že žádná funkce nemá volitelný workspace.

**Vrstva 2: PostgreSQL RLS**

- Migrace běží pod rolí `openengage_migrator`, která **vlastní** schéma.
- Aplikace se připojuje pod rolí `openengage_app`, která schéma **nevlastní**, takže se na ni RLS vztahuje bez potřeby `FORCE ROW LEVEL SECURITY`.
- Na začátku každé transakce repository vrstva provede `SELECT set_config('openengage.workspace_id', $1, true)` (`true` = `SET LOCAL`, platí do konce transakce). Bez transakce se dotaz nespustí; repository vrstva vždy otevírá transakci.
- Politika na každé tabulce s `workspace_id`:

```sql
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON contacts
  USING       (workspace_id = current_setting('openengage.workspace_id', true)::uuid)
  WITH CHECK  (workspace_id = current_setting('openengage.workspace_id', true)::uuid);
```

- `current_setting(..., true)` vrací NULL, když proměnná není nastavená; porovnání s NULL je NULL, tedy nepravda, tedy **žádné řádky**. Zapomenuté nastavení kontextu tedy vede k prázdnému výsledku, ne k úniku.
- Tabulky bez `workspace_id` (`users`, `sessions`, `system_settings`, `password_reset_tokens`, `pgboss.*`, `drizzle.__drizzle_migrations`) RLS nemají. Seznam je explicitní whitelist v `packages/db/src/rls.ts`.
- Role `openengage_sender` je popsaná v 4.10.1.

**Testy izolace (povinné, blokující v CI)**

```ts
// packages/db/test/isolation.test.ts
describe('workspace isolation', () => {
  it('každá tabulka mimo whitelist má sloupec workspace_id', ...);
  it('každá tabulka se sloupcem workspace_id má zapnuté RLS a politiku ws_isolation', ...);
  it('žádná exportovaná repo funkce nepřijímá workspaceId jako string', ...); // typový test přes tsd
});

describe('cross-workspace access', () => {
  // Fixture: workspace A s kontaktem, workspace B prázdný.
  it('čtení kontaktu z A pod kontextem B vrátí null', ...);
  it('update kontaktu z A pod kontextem B ovlivní 0 řádků', ...);
  it('insert do A s workspace_id A pod kontextem B selže na WITH CHECK', ...);
  it('API klíč workspace B na GET /api/v1/contacts/{id_z_A} vrátí 404 problem+json', ...);
  it('surové SQL bez set_config vrátí 0 řádků', ...);
});
```

Poslední test je ten důležitý: dokazuje, že RLS není jen deklarovaná, ale opravdu blokuje. Spouští se proti reálnému Postgresu v testcontainers, ne proti mocku.

**Generický test napříč doménami** (`isolation.matrix.test.ts`): pro každý zaregistrovaný repository modul se z metadat vezme seznam čtecích funkcí a všechny se zavolají pod cizím kontextem. Nová doménová funkce se do testu přidá automaticky tím, že se zaregistruje. Části 2 až 5 tedy nemusí psát vlastní izolační testy, jen registrovat repository.

### 3.7 Audit log

**Co se loguje (povinně):** vše, co mění identitu, přístup, konfiguraci odesílání, nebo hromadně sahá na data.

| Kategorie | Akce |
|---|---|
| identita | `user.login`, `user.login_failed`, `user.logout`, `user.password_changed`, `user.password_reset_requested`, `user.password_reset_completed` |
| workspace | `workspace.created`, `workspace.updated`, `workspace.deleted`, `workspace.restored`, `workspace.ownership_transferred` |
| členství | `member.invited`, `member.invitation_revoked`, `member.joined`, `member.role_changed`, `member.removed` |
| klíče | `api_key.created`, `api_key.rotated`, `api_key.revoked` |
| providers | `provider.created`, `provider.updated`, `provider.deleted`, `provider.test_sent` (deklaruje část 4) |
| data | `contacts.imported`, `contacts.exported`, `contacts.bulk_deleted`, `gdpr.exported`, `gdpr.erased` (deklaruje část 2) |
| kampaně | `campaign.sent`, `campaign.paused`, `campaign.cancelled` (deklaruje část 4) |
| webhooky | `webhook_endpoint.created`, `webhook_endpoint.updated`, `webhook_endpoint.deleted`, `webhook_endpoint.disabled` |
| provoz | `backup.created`, `backup.restored`, `settings.updated` |

**Konvence:** název akce je `<entita>.<sloveso v minulém čase>`, entita v jednotném čísle malými písmeny. Každá část si vlastní názvy svých akcí a zapisuje je do `packages/core/<domena>/audit.ts`, odkud se skládá typovaný union `AuditAction`.

**Co se do `metadata` nesmí dostat:** hesla, tokeny, sekrety klíčů, obsah e-mailů, celé seznamy kontaktů. Zapisují se **rozdíly** u konfiguračních změn (`{ "changed": ["name","locale"], "before": {...}, "after": {...} }`) s redakcí podle seznamu citlivých klíčů.

**Retence:** 24 měsíců, pak odpojení a smazání partition. Konfigurovatelné `AUDIT_RETENTION_MONTHS`.

**Zápis:** synchronně ve stejné transakci jako auditovaná změna. Když se transakce rollbackne, audit záznam zmizí s ní, což je správně. Výjimka: `user.login_failed` se zapisuje mimo transakci, protože k žádné změně nedochází.

**Čtení:** `GET /api/v1/audit-log` se scope `audit:read`, cursor stránkování, filtry `action`, `actor_id`, `target_id`, `from`, `to`. Nikdy nejde mazat ani editovat, tabulka má pro `openengage_app` odebrané `UPDATE` a `DELETE`.

### 3.8 Odchozí webhooky (otázka 17)

**Model:** událost vzniká jednou (`webhook_events`), doručení je fan-out na každý aktivní endpoint, který ji odebírá (`webhook_deliveries`). Doručování obsluhuje pg-boss fronta `platform.webhook_deliver`.

**Payload (KONVENCE)**

```json
{
  "id": "0192f3a0-1c2d-7e50-9a1b-2c3d4e5f6071",
  "type": "contact.created",
  "api_version": "v1",
  "occurred_at": "2026-08-01T12:40:00.000Z",
  "workspace_id": "0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071",
  "data": { }
}
```

Obsah `data` deklaruje ta část, které událost patří. Tato část vlastní obálku a garantuje, že se `id`, `type`, `api_version`, `occurred_at` a `workspace_id` nezmění.

**Hlavičky**

| Hlavička | Hodnota |
|---|---|
| `Content-Type` | `application/json; charset=utf-8` |
| `User-Agent` | `OpenEngage-Webhooks/1.0` |
| `OE-Event-Id` | UUID události, stabilní přes všechny pokusy |
| `OE-Event-Type` | typ události |
| `OE-Delivery-Id` | UUID doručení (jiné pro každý endpoint) |
| `OE-Attempt` | číslo pokusu, od 1 |
| `OE-Signature` | `t=<unix>,v1=<hex>` |

**Podpis**

```
signed_payload = "<unix_timestamp>" + "." + <syrové tělo requestu, bajt za bajtem>
v1             = hex(HMAC-SHA256(secret_bytes, signed_payload))
secret         = "whsec_" + base64url_nopad(32 náhodných bajtů)
secret_bytes   = base64url_decode(secret bez prefixu "whsec_")
```

Testovací vektor (závazný pro test a pro dokumentaci pro integrátory):

```
secret = whsec_AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qhqK-2vcTL0tk
t      = 1785000000
body   = {"id":"0192f3a0-1c2d-7e50-9a1b-2c3d4e5f6071","type":"contact.created","occurred_at":"2026-08-01T12:40:00.000Z","workspace_id":"0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071","data":{"contact_id":"0192f3a0-1c2d-7e43-8d4e-5f60718293a4"}}
OE-Signature: t=1785000000,v1=0fcffb78d4c57dc7112263cf00aaeadb56569562be16ced54e74d11eba996e2b
```

Formát `t=...,v1=...` je zvolený proto, že jde přidat `v2=` vedle `v1=` a rotovat algoritmus bez rozbití příjemců, kteří umí jen v1.

**Ochrana proti replay:** timestamp je součástí podepisovaných dat, takže ho útočník nemůže změnit. V dokumentaci pro integrátory je závazný pokyn odmítnout požadavek starší než **5 minut** a deduplikovat podle `OE-Event-Id`. Na naší straně nic víc udělat nejde, protože replay se odehrává u příjemce.

**Retry politika**

| Pokus | Zpoždění od předchozího | Kumulativně |
|---|---|---|
| 1 | 0 s | 0 |
| 2 | 15 s | 15 s |
| 3 | 60 s | ~1 min |
| 4 | 5 min | ~6 min |
| 5 | 30 min | ~36 min |
| 6 | 2 h | ~2,6 h |
| 7 | 6 h | ~8,6 h |
| 8 | 12 h | ~20,6 h |

Po osmém neúspěchu je doručení `abandoned`. Ke každému zpoždění se přičítá jitter `±20 %`, aby se po výpadku endpointu nevracely všechny retry naráz.

**Klasifikace odpovědi**

| Odpověď | Výsledek |
|---|---|
| 2xx | `succeeded`, `consecutive_failures = 0` |
| 3xx | `failed` (přesměrování nenásledujeme, viz níže) |
| 408, 429, 5xx | `failed`, retry podle tabulky |
| 410 Gone | `abandoned` okamžitě + endpoint `disabled` s důvodem `endpoint_gone` |
| ostatní 4xx | `failed`, retry podle tabulky (endpoint může být dočasně špatně nasazený) |
| timeout, DNS, TLS chyba | `failed`, retry |

**Přesměrování nenásledujeme.** Webhook s podpisem, který se přepošle jinam, je bezpečnostní problém, a `307` na interní adresu je klasický SSRF vektor.

**Limity**

| Limit | Hodnota |
|---|---|
| connect timeout | 5 s |
| celkový timeout | 10 s |
| max velikost odpovědi, kterou čteme | 8 kB (zbytek zahodíme) |
| `response_body_snippet` v DB | prvních 2 kB |
| max souběžných doručení na workspace | 5 |
| max endpointů na workspace | 20 |
| max typů událostí na endpoint | 50 |

**Deaktivace endpointu:** `consecutive_failures >= 20` **nebo** žádné úspěšné doručení posledních 72 hodin při alespoň 10 pokusech. Endpoint přejde na `disabled`, e-mail všem uživatelům s rolí owner a admin, v UI červený stav s tlačítkem "Znovu aktivovat", které vynuluje čítač a nabídne přehrání posledních 24 hodin událostí.

**Ochrana proti SSRF: jedna sdílená utilita, oddělené politiky (KONVENCE)**

V produktu jsou dva odchozí kanály na adresu zadanou uživatelem: doručování webhooků (tato část) a stahování značky z webu při extrakci barev a loga (část 3). Míchají se u nich dvě různé věci a je nutné je rozdělit:

| Věc | Kde žije |
|---|---|
| **Seznam privátních a nesměrovatelných rozsahů** | **jeden sdílený**, `packages/core/net/ssrf.ts`, vlastní část 1. Je to fakt o IP adresách, ne rozhodnutí produktu |
| **Politika, jak se seznam použije** | oddělená per volající, protože jde o legitimně různá rozhodnutí |

Dva seznamy proti téže hrozbě jsou způsob, jak jeden z nich zastará.

Sdílený blocklist: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16` (včetně metadat cloudu `169.254.169.254`), `172.16.0.0/12`, `192.0.0.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `224.0.0.0/4`, `240.0.0.0/4`, `::1/128`, `fc00::/7`, `fe80::/10`, `::ffff:0:0/96` (mapované IPv4).

```ts
type SsrfPolicy = {
  allowPrivateNetworks: boolean;   // webhooky false, brand fetch podle konfigurace
  allowHttp: boolean;              // webhooky false, brand fetch true
  extraBlockedHosts: string[];     // brand fetch přidává metadata.google.internal a spol.
  allowedHosts: string[];          // prázdné = bez allowlistu
  maxRedirects: 0 | number;        // webhooky 0, brand fetch podle konfigurace
};
```

**Jedno pravidlo je nepodmíněné a nejde vypnout ani jednomu volajícímu:** DNS se rozřeší, výsledné adresy se zkontrolují proti blocklistu a **spojení se naváže na ověřenou IP adresu**, a to při **každém** požadavku, ne jen při ukládání. Bez toho existuje DNS rebinding: jméno projde validací a při doručení se přeloží na `169.254.169.254`.

Politiky obou volajících se liší a je to v pořádku, jen to musí být napsané nahlas:

| | Odchozí webhooky | Stahování značky (část 3) |
|---|---|---|
| Schéma | jen `https` | i `http`, viz níže |
| Privátní rozsahy | zakázané, ledaže `WEBHOOK_ALLOW_PRIVATE_TARGETS=true` | zakázané, ledaže `BRAND_FETCH_ALLOW_PRIVATE_NETWORKS=true` |
| Přesměrování | **nenásledujeme vůbec** | podle konfigurace |
| Proč ten rozdíl | přenáší se podepsané tajemství na adresu zvolenou uživatelem | čte se veřejná stránka, žádné tajemství se nepřenáší, a weby zákazníků na `http` reálně existují |

Blokovaná adresa u webhooku → `failed` s `error_code = 'blocked_target'`, bez retry, protože je to trvalá chyba konfigurace.

**Idempotence a pořadí**

- Doručení negarantuje pořadí. Payload nese `occurred_at`, příjemce si má řadit podle něj.
- Doručení je **nejméně jednou**. Při restartu workeru uprostřed HTTP requestu neexistuje způsob, jak zjistit, jestli protistrana request přijala. Job se proto zopakuje a příjemce musí deduplikovat podle `OE-Event-Id`. Je to napsané v dokumentaci a v UI u vytváření endpointu.
- pg-boss job má `singletonKey = delivery_id`, takže dva workery neposílají totéž současně. **Pozor na to, co `singletonKey` negarantuje**, viz 9.1.
- Fan-out je idempotentní přes `uq_webhook_deliveries__event_endpoint`. Protože je tabulka partitionovaná, index musí obsahovat i `created_at`, a fan-out proto musí použít **jednu hodnotu `created_at` pro všechna doručení jedné události** (obdoba invariantu I1 u `messages`) a `ON CONFLICT (event_id, endpoint_id, created_at) DO NOTHING` nad všemi třemi sloupci.

**Fronta a joby**

| Fronta | Účel | Politika | retryLimit | Poznámka |
|---|---|---|---|---|
| `platform.webhook_fanout` | z události vyrobí doručení | `standard` | 5 | idempotentní, viz níže |
| `platform.webhook_deliver` | jedno HTTP doručení | `standard` | 0 | retry řídíme sami přes `next_attempt_at`, ne přes pg-boss, protože potřebujeme vlastní backoff tabulku |

### 3.9 i18n (otázka 16)

**Knihovna:** `next-intl` 4.13.4 (MIT). V Next.js 16 se soubor `middleware.ts` jmenuje `proxy.ts` a exportovaná funkce `proxy`; runtime je vždy Node.js, edge není podporovaný. Nastavení `next-intl` na to musí být napsané rovnou, ne migrované.

**Katalogy**

- Umístění: `packages/i18n/messages/{locale}.json`, jeden soubor na jazyk.
- Formát: vnořený JSON, klíče `camelCase`, jmenné prostory podle domény.

```json
{
  "common": { "save": "Uložit", "cancel": "Zrušit" },
  "auth": { "signIn": { "title": "Přihlášení", "submit": "Přihlásit se" } },
  "contacts": { "count": "{count, plural, =0 {Žádné kontakty} one {# kontakt} few {# kontakty} many {# kontaktu} other {# kontaktů}}" }
}
```

- Klíč se v kódu píše plnou cestou: `t('auth.signIn.title')`. Dynamicky skládané klíče jsou zakázané, protože je nejde staticky ověřit ani extrahovat.
- **Zdroj pravdy je `en.json`.** `cs.json` musí mít stejnou množinu klíčů. CI job `i18n-check` porovná klíče a spadne na chybějící nebo přebývající. Typová kontrola přes `next-intl` deklaraci `Messages` z `en.json`.

**Pluralizace:** ICU MessageFormat. Čeština má kategorie `one`, `few`, `many`, `other`; `many` je pro desetinná čísla (1,5 kontaktu) a musí být vyplněná, jinak text u desetinných hodnot vypadne na `other`. Kategorie `=0` používáme pro prázdné stavy, protože "0 kontaktů" a "Žádné kontakty" nejsou totéž.

**Formátování dat a čísel:** výhradně přes `Intl` API zprostředkované `next-intl` (`useFormatter`). Nikdy ruční `toLocaleString` s natvrdo zadaným locale. Časová zóna:

| Kontext | Zóna |
|---|---|
| UI přihlášeného uživatele | `users.timezone` |
| Reporty a exporty vázané k projektu | `workspaces.timezone` |
| Hodnoty v `render_data` pro sender | `workspaces.timezone`, převedeno už při materializaci |
| Databáze a API odpovědi | vždy UTC, ISO 8601 s `Z` |

**Fallback**

1. Klíč v aktuálním jazyce.
2. Klíč v `en`.
3. V produkci: vypíše se poslední segment klíče a zaloguje se `warn` s `i18n_missing_key`. V dev a v testech: výjimka, takže chybějící klíč spadne v CI.

**Výběr jazyka**

UI: `users.locale` → `Accept-Language` (jen při registraci) → `DEFAULT_LOCALE`.
Routing: prefix v cestě `/{locale}/...` s `localePrefix: 'as-needed'`, takže výchozí jazyk je bez prefixu.

**E-mailové šablony versus UI**

Toto je bod, kde se dvě řešení nesmí splést:

| | UI | Systémové e-maily | Kampaně |
|---|---|---|---|
| Kdo je adresát | uživatel nástroje | uživatel nebo kontakt | kontakt |
| Zdroj jazyka | `users.locale` | podle adresáta, viz níže | jazyk kampaně |
| Technologie | `next-intl` katalogy | blokové šablony seedované v migraci, jedna verze na jazyk | blokové šablony uživatele |
| Kdo překládá | přispěvatelé, katalogy v repozitáři | přispěvatelé, seed data | uživatel |

Systémové e-maily (pozvánka, reset hesla, ověření e-mailu, potvrzení double opt-in, upozornění na deaktivovaný webhook, výsledek zálohy) jsou uložené jako blokové šablony s klíčem `system.<name>` a `locale`. Jazyk se volí: `contacts.locale` nebo `users.locale` → `workspaces.locale` → `DEFAULT_LOCALE` → `en`. Když šablona v jazyce neexistuje, použije se `en`.

**Požadavek na část 3:** systémové šablony musí být v blokovém JSON formátu a musí existovat mechanismus jejich seedování a upgradu (viz 10, požadavek P3-1).

**Nové jazyky:** přidání souboru `messages/xx.json` a záznamu do `SUPPORTED_LOCALES`. Žádná změna kódu. Jazyky bez vokativu řeší část 2.

### 3.10 Rotace `SECRET_KEY` (otázka 15)

**Odvození klíčů (KONTRAKT, sdílené s 4.10.3 a 4.10.4)**

```
SECRET_KEY  = base64url bez paddingu, dekóduje se na přesně 32 bajtů
MASTER      = base64url_decode(SECRET_KEY)
K_<purpose> = HKDF(SHA-256, ikm = MASTER, salt = ASCII "openengage/v1", info = <purpose>, L = 32)
```

HKDF je Extract a Expand v jednom kroku, tedy `crypto.hkdfSync('sha256', MASTER, salt, info, 32)` v Node a `hkdf.Key(sha256.New, MASTER, salt, info, 32)` v Go (`crypto/hkdf` je ve standardní knihovně od Go 1.24).

| purpose (ASCII, přesně) | Použití |
|---|---|
| `openengage/v1/tracking-token` | HMAC trackovacích tokenů (4.10.3) |
| `openengage/v1/credential-encryption` | AES-GCM klíč pro credentials (4.10.4) |
| `openengage/v1/secret-key-fingerprint` | otisk klíče v `system_settings` a v manifestu zálohy |
| `openengage/v1/form-token` | podpis tokenů embedovaných formulářů (část 2) |
| `openengage/v1/confirm-token` | podpis potvrzovacích odkazů double opt-in (část 2) |
| `openengage/v1/asset-url` | podpis adres obrázků při `ASSET_REQUIRE_SIGNED_URL=true` (část 3), **bez expirace** |
| `openengage/v1/suppression-fingerprint` | otisky adres v suppression listu (část 2), viz níže |

**`openengage/v1/asset-url` nemá expiraci schválně**, protože e-mail leží ve schránce roky a obrázek se musí zobrazit i za tři roky. Důsledek, který musí být napsaný v UI u přepínače: **podepsaná adresa assetu je trvale platný odkaz**, zneplatnitelný jen rotací `SECRET_KEY`, což zneplatní všechny naráz. Podpis chrání proti enumeraci, ne proti sdílení odkazu.

**Otisky v suppression listu: rotovatelné, s `key_id` u záznamu**

Po výmazu podle GDPR se e-mail smaže a zůstane jen klíčovaný otisk, který nese informaci „tuhle adresu už nikdy nepřidávej". Vzniká tím zvláštní požadavek: otisk musí zůstat porovnatelný **navždy**, protože plaintext je nenávratně pryč a přepočítat ho nejde. Kdyby se klíč rotoval a starý zahodil, suppression se rozpadne a **smazaný člověk se vzkřísí prvním dalším importem**, tedy výmaz se fakticky zneplatní.

Zvažovaná odpověď byla samostatný klíč, který se z návrhu nikdy nerotuje. Zamítnutá, protože rotace `SECRET_KEY` je reakce na podezření na únik a klíč, který po incidentu nejde vyměnit, znamená navždy kompromitovanou část systému.

**Řešení používá mechanismus, který v kontraktu už je pro trackovací tokeny**, jen se rozšiřuje i sem.

1. Purpose `openengage/v1/suppression-fingerprint`, odvozený běžně přes HKDF a **rotovatelný jako všechno ostatní**.
2. Otisk se ukládá spolu s `key_id`, stejně jako token a šifrová obálka: `suppressions.fingerprint bytea` plus `suppressions.fingerprint_key_id smallint`. Přesné DDL vlastní část 2.
3. Kontrola, jestli je adresa na suppression listu, spočítá otisk **pro všechna známá pokolení klíče, bez horního omezení**, a hledá `WHERE fingerprint = ANY($1)`. Je to **jeden indexovaný dotaz s polem tolika hodnot, kolik je pokolení**, ne dotaz na pokolení.
4. Nové záznamy se zapisují vždy s aktuálním `key_id`. Přepočítat staré nejde a nemusí, protože se ověřují svým pokolením.

> **Strop na počet pokolení neexistuje (KONTRAKT, ROZHODNUTO).** Dřívější znění mluvilo o „nejvýš šesti pokoleních" (aktuální plus pět předchozích). Ten strop se **ruší** a nesmí se vrátit, ani jako validace `SECRET_KEY_PREVIOUS`.
>
> Otisk starého záznamu **nelze nikdy přepočítat**, protože původní adresa je po výmazu podle GDPR pryč. Po překročení stropu by se tedy nejstarší záznamy přestaly dát ověřit a **smazaný člověk by se vrátil prvním dalším importem, aniž by cokoliv selhalo nebo se zalogovalo**. Je to nejtišší možná porucha: žádná chyba, žádný záznam v logu, jen zmizelá ochrana.
>
> Cena za zrušení stropu je zanedbatelná. Jedna operace otisku trvá řádově mikrosekundu, takže při deseti pokoleních a importu sto tisíc kontaktů jde zhruba o sekundu navíc. Přirozeným stropem je počet rotací za životnost instalace, což jsou jednotky za roky, ne stovky.

Cena je jeden HMAC na pokolení a adresu. Při šesti pokoleních a importu pěti milionů kontaktů je to třicet milionů HMAC, tedy jednotky desítek sekund jednovláknově a v dávkovaném importu se to ztratí v šumu. Proti tomu stojí zachovaná schopnost rotovat klíč po bezpečnostním incidentu.

**Záloha a keyring.** Bezpečnostní klíč v záloze schválně není, takže obnova stojí na tom, co si provozovatel uložil zvlášť. Ten **recovery bundle musí nést celý keyring**, tedy aktuální `SECRET_KEY` **i všechna předchozí pokolení** ze `SECRET_KEY_PREVIOUS`. Kdyby nesl jen aktuální klíč, obnova ze zálohy by rozbila přesně totéž co strop na pokolení: suppression list by zůstal, ale nejstarší otisky by se přestaly dát ověřit a smazaní lidé by se vrátili. Dokumentace k záloze to musí říkat stejně hlasitě jako to, že klíč v záloze není.

**Kontrola zdraví instalace.** `oe doctor` porovná pokolení použitá v datech (`SELECT DISTINCT fingerprint_key_id FROM suppressions`, totéž pro trackovací tokeny) se seznamem klíčů, které instalace zná. Každé chybějící pokolení hlásí jako **kritickou chybu**, ne jako doporučení. Chybějící starý klíč není kosmetický nedostatek, je to už nastalá tichá ztráta ochrany.

> **Tvrdé pravidlo, které kontroluje `oe doctor`: `SECRET_KEY_PREVIOUS` se nikdy nevyprazdňuje.** Ani po `oe rotate-credentials`. Credentials jsou jediné, co se dá přešifrovat; trackovací tokeny ve starých e-mailech a suppression otisky po výmazu se přešifrovat nedají nikdy. `oe rotate-credentials` proto po doběhnutí **nesmí** hlásit, že staré klíče jdou odebrat, a `oe doctor` hlásí prázdné `SECRET_KEY_PREVIOUS` při neprázdném suppression listu jako kritický nález.

**Co tím není vyřešené, a je poctivé to říct:** e-mailové adresy jsou vyčíslitelná množina. Kdo získá databázi **i** klíč, prolomí otisky hrubou silou bez ohledu na zvolené schéma. Otisk chrání proti úniku samotné databáze, ne proti úniku obojího. Patří to do dokumentace ke GDPR, ne do volby klíče.

Testovací vektory (závazné, ověřeno spuštěním):

```
SECRET_KEY = AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8
MASTER hex = 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f

K_tracking-token       = 4a60b23f5ad33af512e8a70f9f09b43a37ef1909894df07295067f24d05bf6ca
K_credential-encryption= 99d7e191906061a6b21d63fb792449c93ca147dc7324862c2963b0b6c70bdc6f
K_secret-key-fingerprint= 2ca5cdfbdd8380aa5d9f621d6aec612d6e24035ba100a07ead8c776289532481
```

**Otisk klíče:** `base64url(HMAC-SHA256(K_secret-key-fingerprint, "fingerprint")[0..8])`. Pro klíč výše je to `4FoOTudf7gk`. Ukládá se do `system_settings.secret_key_fingerprint` a do manifestu zálohy. Při startu se porovná; neshoda znamená, že někdo změnil `SECRET_KEY` bez rotace, a aplikace **nastartuje s varováním**, ne s pádem, protože pád by uživateli znemožnil situaci vůbec opravit. V UI se zobrazí červený banner s návodem.

**Verzování klíčů**

`SECRET_KEY` má implicitně `key_id = 1`. Rotace zavádí explicitní podobu:

| Proměnná | Formát | Význam |
|---|---|---|
| `SECRET_KEY` | `<base64url>` nebo `<key_id>:<base64url>` | aktuální klíč, používá se pro nové podpisy a šifrování |
| `SECRET_KEY_PREVIOUS` | `<key_id>:<base64url>[,<key_id>:<base64url>]` | staré klíče, jen pro ověřování a dešifrování |

`key_id` je celé číslo 1 až 255 a je uložené v každém tokenu i v každé šifrové obálce, takže ověřovatel ví, který klíč použít.

**Postup rotace**

```
0. oe genkey --id 2                     vypíše nový klíč
1. SECRET_KEY_PREVIOUS=1:<starý>        do prostředí VŠECH procesů
   SECRET_KEY=2:<nový>
2. docker compose up -d                 restart VŠECH procesů, ověřit /readyz u každého
   >>> TEPRVE TEĎ smí přijít krok 3 <<<
3. oe rotate-credentials                přešifruje všechna uložená tajemství na key_id 2
4. Počkat na expiraci identity tokenů (15 minut)
5. SECRET_KEY_PREVIOUS SE NEODEBÍRÁ, viz níže
```

**Pořadí kroků 2 a 3 je kritické a nesmí se prohodit.** V `compose.scale.yml` je sender samostatný kontejner. Kdyby operátor pustil přešifrování dřív, než restartuje sender, běžel by sender pořád se starým klíčem, konfigurace providera by byla zašifrovaná novým a **každé dešifrování by selhalo**. U běžící kampaně na milion příjemců je rozdíl mezi správným a špatným pořadím milion zpráv označených jako neúspěšné.

Proto je navíc normativní tohle:

> **Selhání dešifrování konfigurace provideru je opakovatelná chyba, ne trvalá.** Sender ji zapíše jako `error_code = 'credentials_undecryptable'`, vrátí zprávu na `pending` s exponenciálním backoffem a **nesmí** ji označit jako `failed`. Je to skoro vždy přechodný stav během rotace klíče nebo restartu, a rozdíl mezi tímto rozhodnutím a opačným je milion trvale zkažených zpráv proti minutě zpoždění. Po `SENDER_CREDENTIALS_MAX_RETRIES` (výchozí 10) sender kampaň pozastaví a upozorní, místo aby zprávy zahazoval.

**Co se s čím stane**

| Artefakt | Chování při rotaci |
|---|---|
| Zašifrované credentials providerů, AI klíče, tajemství webhooků | Dešifrují se starým klíčem podle `key_id` v obálce. `oe rotate-credentials` je projde a přešifruje novým. Do té doby fungují dál. |
| Trackovací tokeny v už odeslaných e-mailech | Ověřují se starým klíčem podle `key_id` v tokenu. **Nikdy nevyprší**, protože e-mail v cizí schránce leží roky. Proto se `SECRET_KEY_PREVIOUS` u trackovacích klíčů nesmí odebrat nikdy, dokud nám záleží na starých kampaních. Doporučení v dokumentaci: staré klíče v `SECRET_KEY_PREVIOUS` nechat trvale. |
| Identifikační token z kliku (`oe_token`) | Platnost 15 minut, po rotaci stačí počkat 15 minut. |
| Potvrzovací odkazy double opt-in | Platnost 14 dní, viz část 2. |
| **Otisky v suppression listu** | Ověřují se pokolením podle `key_id` u záznamu. **Přepočítat je nejde nikdy**, protože plaintext byl smazán výmazem podle GDPR. `SECRET_KEY_PREVIOUS` se proto nesmí vyprázdnit, dokud existuje jediný záznam. |
| Session cookies | Nedotčeno, session token je náhodný a v databázi, ne odvozený ze `SECRET_KEY`. |
| Hesla | Nedotčeno, viz 3.1 (žádný pepper). |
| API klíče | Nedotčeno, hash je SHA-256 bez klíče. |
| Podpisy odchozích webhooků | Nedotčeno, tajemství je per endpoint a je uložené zašifrovaně; přešifruje ho `oe rotate-credentials`. |

**Ztráta `SECRET_KEY`** je nevratná pro zašifrované credentials. `oe doctor` to detekuje (otisk nesedí, dešifrování selže) a nabídne jedinou možnou opravu: znovu zadat přístupy k providerům a AI klíče. Trackovací tokeny ze starých kampaní přestanou platit a klik z takového e-mailu skončí na `/t/expired` s neutrální stránkou a přesměrováním na domovskou stránku workspace.
### 3.11 Monorepo a build

**Nástroje**

| Nástroj | Verze | Licence | Poznámka |
|---|---|---|---|
| Node.js | 24.18.1 LTS (Krypton) | MIT | Active LTS k 2026-07-31 |
| pnpm | 11.18.0 | MIT | workspaces, `pnpm-workspace.yaml` |
| Turborepo | 2.10.7 | MIT | orchestrace tasků a cache |
| TypeScript | 7.0.2 | Apache-2.0 | nativní kompilátor; fallback 5.9.3, viz otevřená otázka O4 |
| Go | 1.26 | BSD-3-Clause | `crypto/hkdf` je ve stdlib od 1.24 |

**Struktura** (rozšíření 4.1 hlavní specifikace o konkrétní soubory)

```
.
├── apps/
│   ├── web/                 Next.js 16 App Router, standalone build
│   ├── worker/              pg-boss consumer, tsx entrypoint
│   └── sender/              Go modul, vlastní go.mod
├── packages/
│   ├── core/                doménová logika bez HTTP
│   ├── db/                  Drizzle schéma, migrace, repository, RLS
│   ├── contracts/           čtyři kontrakty + golden fixtures + generátory
│   ├── emails/              blokové šablony a renderer (část 3)
│   ├── i18n/                katalogy zpráv
│   ├── sdk-web/             tracking SDK
│   ├── sdk-node/            API klient
│   ├── ui/                  design systém
│   └── config/              sdílené tsconfig, eslint, prettier, vitest presety
├── docker/
│   ├── Dockerfile
│   ├── entrypoint.sh
│   └── compose.yml
├── docs/
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

**Konvence pojmenování v kódu (KONVENCE)**

| Věc | Pravidlo | Příklad |
|---|---|---|
| Soubor | `kebab-case.ts` | `api-key-service.ts` |
| React komponenta | `PascalCase.tsx` | `WorkspaceSwitcher.tsx` |
| Typ, interface | `PascalCase` | `WorkspaceContext` |
| Funkce, proměnná | `camelCase` | `createApiKey` |
| Konstanta modulu | `SCREAMING_SNAKE_CASE` | `SESSION_COOKIE_NAME` |
| Balíček | `@openengage/<jméno>` | `@openengage/db` |
| pg-boss fronta | `<domena>.<akce>` | `contacts.import` |
| Chybový kód API | `snake_case` | `insufficient_scope` |
| Oprávnění a scope | `resource:action` | `campaigns:send` |
| Událost webhooku | `<entita>.<sloveso>` | `contact.subscribed` |
| Env proměnná | `SCREAMING_SNAKE_CASE` | `SENDER_BATCH_SIZE` |

**Závislosti mezi balíčky (vynucené ESLint pravidlem `import/no-restricted-paths`)**

```
apps/web    → packages/{core,db,contracts,emails,i18n,ui,sdk-node}
apps/worker → packages/{core,db,contracts,emails,i18n}
packages/core → packages/{db,contracts,i18n}
packages/db → packages/contracts
packages/contracts → nic
apps/sender → nic z Node světa, jen packages/contracts/fixtures jako testovací data
```

`packages/contracts` nesmí importovat nic z monorepa. Je to kořen grafu a zároveň jediné místo, které čte i Go.

**Turbo pipeline**

| Task | Závisí na | Cache | Poznámka |
|---|---|---|---|
| `build` | `^build` | ano | |
| `typecheck` | `^build` | ano | |
| `lint` | | ano | oxlint + eslint na pravidla, která oxlint neumí |
| `test:unit` | `^build` | ano | Vitest, bez databáze |
| `test:db` | `^build` | ne | testcontainers, Postgres 18 |
| `test:e2e` | `build` | ne | Playwright proti běžící compose |
| `contracts:generate` | | ano | generuje fixtures a OpenAPI |

### 3.12 Docker image, compose, healthcheck, graceful shutdown (otázka 10)

**Multi-stage Dockerfile** (komentovaná podoba, povinný artefakt)

```dockerfile
# syntax=docker/dockerfile:1.9

# --- 1) Go builder: staticky slinkovaný sender -------------------------------
FROM golang:1.26-alpine AS sender-builder
WORKDIR /src
# Nejdřív jen manifesty, aby se cache modulů neinvalidovala každou změnou kódu.
COPY apps/sender/go.mod apps/sender/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY apps/sender/ ./
COPY packages/contracts/fixtures/ /src/testdata/fixtures/
# CGO_ENABLED=0 => žádná libc závislost, binárka běží i ve scratch.
# -trimpath a -ldflags "-s -w" zmenší binárku a odstraní absolutní cesty.
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -trimpath \
      -ldflags="-s -w -X main.version=${APP_VERSION}" \
      -o /out/oe-sender ./cmd/sender

# --- 2) Node deps: jen instalace, sdílená vrstva ------------------------------
FROM node:24.18.1-alpine AS node-deps
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/*/package.json ./packages/
RUN --mount=type=cache,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && pnpm install --frozen-lockfile

# --- 3) Node builder: build Next.js standalone a workeru ---------------------
FROM node-deps AS node-builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm turbo run build --filter=@openengage/web --filter=@openengage/worker
# Next standalone vyrobí .next/standalone se zabaleným node_modules podmnožinou.

# --- 4) Runtime --------------------------------------------------------------
FROM node:24.18.1-alpine AS runtime
# tini se stará o reaping zombie procesů a o předání signálů, když MODE=all
# spouští tři potomky. Bez něj SIGTERM nedojde k dětem a shutdown není graceful.
RUN apk add --no-cache tini postgresql18-client ca-certificates tzdata \
 && addgroup -g 10001 -S openengage \
 && adduser  -u 10001 -S openengage -G openengage
WORKDIR /app

COPY --from=node-builder --chown=root:root /app/apps/web/.next/standalone ./
COPY --from=node-builder --chown=root:root /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=node-builder --chown=root:root /app/apps/web/public ./apps/web/public
COPY --from=node-builder --chown=root:root /app/apps/worker/dist ./apps/worker/dist
COPY --from=node-builder --chown=root:root /app/packages/db/migrations ./packages/db/migrations
COPY --from=sender-builder --chown=root:root /out/oe-sender /usr/local/bin/oe-sender
COPY --chown=root:root docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --chown=root:root docker/oe /usr/local/bin/oe

# Data se zapisují jen do /data, aplikační soubory jsou pro běžícího uživatele
# jen ke čtení. Kontejner tedy jde spustit s read-only rootfs.
RUN mkdir -p /data/uploads /data/backups && chown -R 10001:10001 /data
VOLUME ["/data"]

ENV NODE_ENV=production \
    MODE=all \
    PORT=3000 \
    HEALTH_PORT=3001 \
    DATA_DIR=/data
EXPOSE 3000
USER 10001:10001

# Readiness, ne liveness: kontroluje i dostupnost databáze a shodu schématu.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD ["/usr/local/bin/oe", "healthcheck"]

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
```

**Očekávaná velikost**

| Vrstva | Přibližně |
|---|---|
| `node:24-alpine` základ | 60 MB |
| tini, ca-certificates, tzdata, postgresql18-client | 22 MB |
| Next.js standalone + static + public | 95 MB |
| worker dist + node_modules podmnožina | 25 MB |
| `oe-sender` (Go, staticky, `-s -w`) | 18 MB |
| **celkem, nekomprimovaně** | **~220 MB** |

Cíl: pod 250 MB. Když se překročí, CI job `image-size` spadne. Bez `postgresql18-client` (potřebného pro `pg_dump` a `pg_restore`) by to bylo o 22 MB méně, ale zálohování ze samotné image je slib z kapitoly 9 hlavní specifikace a stojí za to.

**Entrypoint a režimy**

```sh
#!/bin/sh
set -eu
# 1) validace konfigurace (zod), při chybě exit 78 a výpis všech problémů naráz
# 2) vymazání klíčů AI providerů z prostředí, viz "Klíče AI providerů" níž
# 3) MIGRATE_ON_START=true a MODE in (web,all)  ->  oe migrate  (advisory lock, 3.13)
# 4) podle MODE spustit:
#    web    -> node apps/web/server.js
#    worker -> node apps/worker/dist/main.js
#    sender -> /usr/local/bin/oe-sender
#    all    -> všechny tři jako potomky, sdílené PID 1 přes tini,
#              pád kteréhokoliv potomka ukončí celý kontejner (exit code potomka)
```

**Klíče AI providerů se před spuštěním z prostředí vymažou (KONVENCE)**

Vercel AI SDK i SDK jednotlivých providerů mají fallback: když se klíč nepředá explicitně (`apiKey: undefined`), sáhnou tiše po proměnné prostředí. Model bring your own key z kapitoly 6.5 hlavní specifikace tím dostane díru, kterou nikdo neuvidí: projekt, který si klíč nenakonfiguroval, **začne utrácet peníze provozovatele**, requesty projdou, nic se nezaloguje jako chyba a zjistí se to až na faktuře. V multi-projektovém nástroji je to navíc míchání nákladů mezi zákazníky.

Entrypoint proto před spuštěním web a worker procesu odstraní z prostředí:

| Pravidlo | Co maže |
|---|---|
| **Vzor** | každá proměnná, jejíž název končí na `_API_KEY` |
| Výčet pro ty, které vzoru neodpovídají | `AWS_BEARER_TOKEN_BEDROCK`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_GENAI_USE_VERTEXAI`, `AZURE_OPENAI_ENDPOINT`, `OLLAMA_HOST`, `HF_TOKEN` |

**Vzor, ne výčet**, protože výčet zastará při každém novém provideru a selže tiše. Vzor `*_API_KEY` je bezpečný, protože **žádná konfigurační proměnná OpenEngage na `_API_KEY` nekončí** (ověřeno proti tabulce 4.9: používáme `SECRET_KEY`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `METRICS_TOKEN`). Hlídá to test, který projde zod schéma konfigurace a spadne, kdyby někdo takovou proměnnou zavedl.

Mazání se **neaplikuje na sender**, ten s AI nepřichází do styku.

Dvě vrstvy, protože jedna nestačí:

1. **Entrypoint** maže. Chrání i případ, kdy si provozovatel nastaví klíč do prostředí ze zvyku nebo kvůli jinému nástroji ve stejném compose souboru.
2. **Aplikace při startu ověří**, že po vymazání není žádná z těch proměnných nastavená, a když je (například když někdo spustí `node server.js` napřímo mimo entrypoint), zaloguje `warn` s kódem `ai_key_leaked_from_env` a klíč přesto ignoruje. Volání AI providera **vždy** předává klíč explicitně z dešifrované konfigurace projektu; předání `undefined` je v kódu zakázané typem, ne konvencí.

Akceptační kritérium: kontejner spuštěný s `ANTHROPIC_API_KEY=sk-test` v prostředí a s projektem bez nakonfigurovaného AI klíče **neodešle jediný požadavek** na `api.anthropic.com` a uživateli zobrazí „AI asistent není nastavený".

`MODE=all` nespouští supervizora, který by procesy restartoval. Restart je práce Dockeru. Kdyby kontejner držel běh s jedním mrtvým procesem, healthcheck by lhal.

**Healthchecky**

| Endpoint | Kdo | Kontroluje | Odpověď |
|---|---|---|---|
| `GET /api/health` | web | nic, jen že proces žije | 200 `{"status":"ok","mode":"web","version":"1.0.0"}` |
| `GET /api/health/ready` | web | `SELECT 1` s timeoutem 2 s, shoda `schema_version`, dostupnost `DATA_DIR` pro zápis | 200 nebo 503 s `{"checks":[...]}` |
| `GET :HEALTH_PORT/healthz` | sender | proces žije | 200 `ok` |
| `GET :HEALTH_PORT/readyz` | sender | připojení k DB, poslední úspěšný claim mladší než 60 s nebo prázdný outbox | 200 nebo 503 |
| `GET :HEALTH_PORT/healthz` | worker | proces žije | 200 `ok` |
| `GET :HEALTH_PORT/readyz` | worker | pg-boss `started`, poslední tik maintenance mladší než 5 min | 200 nebo 503 |

Příkaz `oe healthcheck` v HEALTHCHECK direktivě zavolá readiness endpoint podle `MODE` (u `all` všechny tři a spadne, když spadne kterýkoliv).

**Graceful shutdown**

| Proces | Postup po SIGTERM | Timeout |
|---|---|---|
| web | přestat přijímat nová spojení, dokončit rozpracované requesty, uzavřít pool | 25 s, pak `process.exit(1)` |
| worker | `boss.stop({ graceful: true, timeout: 25000 })`, rozpracované joby dokončit, nové nebrat | 30 s |
| sender | přestat claimovat, dokončit rozpracované zprávy v dávce, zbytek dávky vrátit na `pending` jedním UPDATE, uzavřít pool | 25 s, pak nechat zbytek na reaperu |

`SHUTDOWN_GRACE_SECONDS` (výchozí 25) je společné nastavení, které se propisuje do všech tří. Compose má `stop_grace_period: 40s`, aby Docker nezabil proces dřív, než dojede vlastní timeout. Rozdíl 15 sekund je rezerva na uzavření spojení.

Na SIGINT reagují procesy stejně jako na SIGTERM. Druhý signál během shutdownu znamená okamžité ukončení.

**docker-compose.yml** (povinný artefakt)

```yaml
name: openengage

services:
  app:
    image: ghcr.io/nc-mill/openengage:1.0.0     # nikdy :latest v produkci
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
        required: false        # při externím Postgresu se profil "bundled" nepustí
    environment:
      MODE: all
      APP_URL: ${APP_URL:?APP_URL je povinná}
      DATABASE_URL: ${DATABASE_URL:-postgres://openengage_app:openengage@postgres:5432/openengage}
      DATABASE_URL_SENDER: ${DATABASE_URL_SENDER:-postgres://openengage_sender:openengage@postgres:5432/openengage}
      SECRET_KEY: ${SECRET_KEY:?SECRET_KEY je povinná, vygenerujte ji příkazem oe genkey}
      DEFAULT_LOCALE: ${DEFAULT_LOCALE:-cs}
      LOG_LEVEL: ${LOG_LEVEL:-info}
    ports:
      - "${APP_PORT:-3000}:3000"
    volumes:
      - ./data:/data
    stop_grace_period: 40s
    read_only: true
    tmpfs:
      - /tmp:size=256m
    security_opt:
      - no-new-privileges:true
    healthcheck:
      test: ["CMD", "/usr/local/bin/oe", "healthcheck"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 60s
    deploy:
      resources:
        limits:
          memory: 2g

  postgres:
    image: postgres:18-alpine
    profiles: ["bundled"]          # docker compose --profile bundled up -d
    restart: unless-stopped
    environment:
      POSTGRES_DB: openengage
      POSTGRES_USER: openengage_migrator
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-openengage}
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale-provider=icu --icu-locale=cs-CZ"
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
      - ./docker/initdb:/docker-entrypoint-initdb.d:ro   # zakládá role app a sender
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U openengage_migrator -d openengage"]
      interval: 10s
      timeout: 5s
      retries: 5
    stop_grace_period: 30s
```

Rozdělení na `MODE=web`, `MODE=worker` a `MODE=sender` je v `compose.scale.yml` jako dokumentovaná varianta pro větší nasazení. Do MVP 0 stačí `MODE=all`.

**Databázové role** (zakládá `docker/initdb/10-roles.sql`, u externího Postgresu je to v dokumentaci jako ruční krok)

| Role | Práva | Proč |
|---|---|---|
| `openengage_migrator` | vlastník schématu `public`, plná práva | pouští migrace, jinak nikde nepoužitá |
| `openengage_app` | `SELECT, INSERT, UPDATE, DELETE` na aplikačních tabulkách, `USAGE` na schématu, žádné vlastnictví | běžný provoz; nevlastní tabulky, takže na ni platí RLS |
| `openengage_sender` | přesně podle 4.10.1 | oddělený, aby chyba v senderu nemohla sáhnout na kontakty |
| `openengage_backup` | `pg_read_all_data` | jen pro `pg_dump`, nikdy nezapisuje |

### 3.13 Migrace (otázky 11 a 14)

**Nástroj:** `drizzle-kit` 0.31.10 generuje SQL soubory, aplikuje je **vlastní runner** `oe migrate`. Vlastní runner je nutný ze dvou důvodů: potřebujeme advisory lock kolem celého běhu a potřebujeme umět migrace, které nesmí běžet v transakci.

**Formát migrace**

```
packages/db/migrations/
├── 0000_initial.sql
├── 0001_add_api_key_rotation.sql
├── 0002_partitions_2026.sql
└── meta/_journal.json
```

První řádek souboru smí nést direktivy runneru:

```sql
-- oe:no-transaction        migrace poběží mimo transakci (CREATE INDEX CONCURRENTLY)
-- oe:timeout=600           lock_timeout a statement_timeout v sekundách (výchozí 60)
-- oe:expand                migrace je zpětně kompatibilní (viz expand/contract)
```

**Běh při startu s víc replikami (otázka 11)**

```
1. Připoj se jako openengage_migrator.
2. SELECT pg_try_advisory_lock(7264150401) v cyklu s odstupem 1 s,
   nejvýš MIGRATE_LOCK_TIMEOUT_SECONDS (výchozí 300).
   - Konstanta 7264150401 je pevná, zapsaná v packages/db/src/migrate.ts.
   - pg_try_advisory_lock, ne pg_advisory_lock, aby šlo hlásit průběh a mít vlastní timeout.
3. Držitel zámku:
   a. Načti seznam už aplikovaných migrací z drizzle.__drizzle_migrations.
   b. Pro každou nezapsanou migraci v pořadí:
      - SET lock_timeout, SET statement_timeout podle direktivy
      - BEGIN (pokud není oe:no-transaction)
      - vykonej příkazy oddělené --> statement-breakpoint
      - zapiš záznam do drizzle.__drizzle_migrations
      - COMMIT
   c. Zajisti partition na aktuální a další tři měsíce.
   d. UPDATE system_settings SET schema_version = <max>.
4. pg_advisory_unlock(7264150401).
5. Ostatní repliky: zámek nedostanou, čekají. Po jeho uvolnění zjistí,
   že nic nezbývá, a pokračují do startu.
6. Timeout na zámek => exit code 75 (EX_TEMPFAIL), Docker kontejner restartuje.
```

Zámek je session-scoped advisory lock, takže se uvolní i když proces spadne. To je jeho hlavní výhoda proti zámkové tabulce, kterou by po pádu musel někdo uklidit ručně.

**Selhání uprostřed (otázka 14)**

- Migrace, která spadne v transakci, se celá rollbackne. Předchozí migrace zůstávají aplikované, protože každá má vlastní transakci.
- Runner ukončí proces s exit code **3** a vypíše číslo migrace, chybu z Postgresu a příkaz, na kterém spadla.
- Kontejner restartuje a pokusí se znovu. Když je chyba deterministická (například kolize dat s novým `UNIQUE`), zacyklí se restart. Proto runner po **třech** neúspěších stejné migrace (počítáno v `system_settings.settings`) přestane a nastartuje aplikaci v **režimu údržby**: web odpovídá 503 s `migration_failed` na všem kromě `/api/health` a stránky s návodem.
- Migrace `oe:no-transaction`, která spadne uprostřed, může nechat databázi v částečném stavu. Proto smí obsahovat **jen idempotentní příkazy** (`CREATE INDEX CONCURRENTLY IF NOT EXISTS`, `DROP INDEX IF EXISTS`). Kontroluje to lint pravidlo `migration-lint` v CI.

**Index na partitionované tabulce: třífázový postup (KONVENCE)**

`CREATE INDEX CONCURRENTLY` **na partitionované tabulce v PostgreSQL neexistuje**, příkaz skončí chybou. A prostý `CREATE INDEX` na rodiči zamkne rodiče i všechny partition po celou dobu stavby, což u `messages` s miliony řádků znamená zastavené odesílání. Jediný bezpečný postup je tenhle a `migration-lint` ho vynucuje jako **jediný povolený vzor** pro partitionované tabulky:

```sql
-- oe:no-transaction

-- Fáze 1: prázdný index jen na rodiči. Zamkne jen katalog, je to okamžité.
CREATE INDEX IF NOT EXISTS idx_messages__claimable
  ON ONLY messages (campaign_id, next_attempt_at, id)
  WHERE status = 'pending';

-- Fáze 2: skutečná stavba, na každé partition zvlášť, souběžně a bez zámku.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_y2026m08__claimable
  ON messages_y2026m08 (campaign_id, next_attempt_at, id)
  WHERE status = 'pending';
-- (opakuje se pro každou existující partition)

-- Fáze 3: připojení. Rodičovský index se stane platným, teprve až jsou
-- připojené indexy všech partition.
ALTER INDEX idx_messages__claimable
  ATTACH PARTITION idx_messages_y2026m08__claimable;
```

Fáze 2 a 3 generuje `createMonthlyPartitions` automaticky pro nově zakládané partition, takže migrace řeší jen ty, které v okamžiku jejího běhu existují. Runner umí fáze 2 a 3 rozvinout přes všechny partition sám, aby migrace nemusela znát jejich seznam.

**Dopředné migrace, žádné zpětné (KONVENCE)**

Down migrace **nepíšeme**. Důvod je praktický: down migrace se nikdy netestuje, takže v okamžiku, kdy ji potřebujete, nefunguje. Místo toho:

| Situace | Řešení |
|---|---|
| Chybná migrace zjištěná před vydáním | oprava souboru, protože ještě nikde neběžela |
| Chybná migrace zjištěná po vydání | nová dopředná migrace, která stav opraví |
| Potřeba vrátit se na starší verzi aplikace | obnova ze zálohy pořízené `oe backup` před upgradem |

**Breaking změny: expand a contract přes tři vydání**

| Vydání | Krok | Příklad: přejmenování `contacts.title` na `contacts.honorific` |
|---|---|---|
| N | expand | přidat `honorific`, zapisovat do obou sloupců, číst ze starého |
| N+1 | migrate | backfill `honorific` z `title`, číst z nového, zapisovat do obou |
| N+2 | contract | přestat zapisovat do `title`, migrace ho zahodí |

Uživatel, který přeskočí verzi (z N rovnou na N+2), je na tom stejně, protože se aplikují všechny migrace v pořadí. Zakázané je jen přeskočit **major** verzi; kontroluje to `oe migrate` porovnáním `system_settings.schema_version` s minimální podporovanou verzí zabudovanou v image. Při porušení: exit 4 a hláška "nejdřív aktualizujte na verzi X".

**Downgrade guard:** když je `system_settings.schema_version` **vyšší** než maximum známé této image, aplikace nenastartuje (exit 5, kód `schema_version_ahead`). Bez toho by starší aplikace zapisovala do novějšího schématu a tiše ho poškodila.

**Ověření migrací v CI:** job `migrations-check` (blokující) spustí tři scénáře:
1. Prázdná databáze plus všechny migrace = schéma odpovídá `drizzle-kit` snapshotu (žádný drift).
2. Databáze naplněná z tagu předchozího vydání plus nové migrace = projde bez chyby.
3. Seed s 10 000 řádky na klíčových tabulkách, aby migrace s `NOT NULL` a `UNIQUE` narazily na reálná data.

### 3.14 Zálohování, obnova a upgrade (otázka 13)

**Co je v záloze**

| Součást | V záloze | Poznámka |
|---|---|---|
| Celá databáze (všechny workspaces) | ano | `pg_dump -Fc --no-owner --no-privileges` |
| Nahrané obrázky a assety z `/data/uploads` | ano | tar.gz vedle dumpu |
| `SECRET_KEY` | **ne** | záměrně. Záloha bez klíče je pro útočníka bez zašifrovaných credentials. Klíč si operátor musí uložit sám a manifest ho na to upozorní. |
| Konfigurace (env proměnné) | ne | je v compose souboru operátora |
| Schéma a data pg-boss | ano, je součástí dumpu | rozpracované joby po obnově doběhnou |

**Formát**

```
/data/backups/openengage-2026-07-31T030000Z/
├── database.dump          pg_dump -Fc, komprimovaný
├── uploads.tar.gz
└── manifest.json
```

```json
{
  "format_version": 1,
  "created_at": "2026-07-31T03:00:00Z",
  "app_version": "1.0.0",
  "schema_version": 42,
  "installation_id": "0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071",
  "secret_key_fingerprint": "4FoOTudf7gk",
  "postgres_version": "18.4",
  "database": { "bytes": 184320000, "sha256": "..." },
  "uploads":  { "bytes": 42000000,  "sha256": "...", "files": 1284 },
  "row_counts": { "users": 3, "workspaces": 2, "contacts": 48211, "campaigns": 17 }
}
```

`row_counts` je tam kvůli ověření obnovy, `secret_key_fingerprint` kvůli tomu, aby obnova poznala, že operátor obnovuje s jiným klíčem, než kterým se šifrovalo.

**Spuštění**

| Způsob | Příkaz |
|---|---|
| Ručně | `docker compose exec app oe backup` |
| Plánovaně | pg-boss `schedule('platform.backup', BACKUP_SCHEDULE_CRON)`, výchozí `0 3 * * *` v `workspaces`-nezávislé, instalační rovině |
| Před upgradem | `oe upgrade` udělá zálohu automaticky, než pustí migrace |

Zálohu pouští jen `MODE=worker` nebo `MODE=all`, aby při víc replikách neběžela paralelně (pg-boss `schedule` to zajistí sám, protože scheduled job vzniká jednou).

**Retence:** `BACKUP_RETENTION_DAYS` (výchozí 14). Úklid maže celé adresáře starší než limit, ale **vždy nechá alespoň 3 poslední**, i kdyby byly starší. Bez toho instalace, která byla měsíc vypnutá, přijde po prvním startu o všechny zálohy.

**Externí cíle (S3, Dropbox)** nejsou v MVP 0. Rozhraní je připravené: `BACKUP_TARGET=local` je jediná hodnota, kterou 1.0 zná, a `oe backup` po dokončení volá volitelný hook `/data/hooks/post-backup.sh` s cestou k adresáři. Kdo chce, nahraje si zálohu vlastním skriptem hned teď.

**Obnova**

```
oe restore /data/backups/openengage-2026-07-31T030000Z [--force] [--skip-uploads]
```

1. Ověří `manifest.json`, kontrolní součty a `format_version`.
2. Porovná `app_version` v manifestu s verzí image. Obnova zálohy z **novější** verze je odmítnutá (`backup_from_newer_version`). Ze starší je povolená, po obnově se pustí migrace.
3. Zkontroluje, že cílová databáze je prázdná. Když není, odmítne, dokud nepřijde `--force`. S `--force` se použije `pg_restore --clean --if-exists`.
4. Porovná `secret_key_fingerprint` s aktuálním `SECRET_KEY`. Neshoda: hlasité varování a vyžádané potvrzení `--i-know-the-key-differs`, protože všechny credentials providerů bude nutné zadat znovu.
5. Obnoví databázi, pak uploads.
6. Spustí `oe migrate`.
7. Vypíše porovnání `row_counts` z manifestu se skutečností a případné rozdíly označí.
8. Zapíše `backup.restored` do auditu.

**Ověření zálohy, aniž se něco rozbije**

```
oe backup verify /data/backups/<adresář>
```

Vytvoří dočasnou databázi `oe_verify_<timestamp>`, obnoví do ní dump, spustí migrace, porovná `row_counts` a několik integritních dotazů (existuje `system_settings`, každý workspace má ownera, žádný osiřelý `membership`), pak databázi zahodí. Vrací nenulový exit code při jakékoliv neshodě, takže se dá zapojit do monitoringu.

Job `platform.backup_verify` pouští `verify` na poslední záloze jednou týdně a při selhání pošle e-mail ownerům. Bez toho by se na nefunkční zálohu přišlo až v okamžiku, kdy je pozdě.

**Upgrade**

```
docker compose pull && docker compose up -d
```

`oe upgrade` (volitelný, opatrnější postup) navíc: zastaví sender a worker, udělá zálohu, pustí migrace, spustí procesy zpět, ověří readiness. Hlavní specifikace slibuje jednoduchou variantu, `oe upgrade` je pro ty, kdo chtějí jistotu.

### 3.15 CI, testovací strategie a licenční brána (otázka 18)

**Testovací pyramida**

| Úroveň | Nástroj | Co pokrývá | Kde běží |
|---|---|---|---|
| Jednotkové (TS) | Vitest 4.1.10 | čistá logika, validace, kompilace segmentů, renderer | bez databáze |
| Databázové (TS) | Vitest + testcontainers 12.0.4 | repository, RLS, migrace, pg-boss | Postgres 18 v kontejneru |
| Jednotkové (Go) | `go test` | claim, interpolace, MIME, tokeny | bez databáze |
| Integrační (Go) | `go test -tags=integration` | outbox proti reálnému Postgresu | Postgres 18 v kontejneru |
| Kontraktové | Vitest + `go test` nad stejnými fixtures | čtyři kontrakty ze 4.10 | obojí |
| E2E | Playwright 1.62.1 | golden path z kapitoly 8 hlavní specifikace | proti běžícímu compose |

**Cíle pokrytí:** `packages/core` a `packages/db/src/repo` minimálně 80 % větví, `packages/contracts` 100 %. Jinde bez povinné hranice, protože vynucené pokrytí UI vede k testům, které nic netestují.

**Joby v CI (GitHub Actions), všechny blokující**

| Job | Obsah | Limit |
|---|---|---|
| `lint` | oxlint, eslint, prettier check, `migration-lint` | 5 min |
| `typecheck` | `turbo run typecheck` | 8 min |
| `test-unit` | `turbo run test:unit` | 8 min |
| `test-db` | `turbo run test:db` (testcontainers) | 15 min |
| `test-go` | `go vet`, `go test ./...` v `apps/sender` | 8 min |
| `test-go-integration` | `go test -tags=integration ./...` proti Postgresu ze `services:` | 12 min |
| `contracts-golden` | fixtures proti TS i Go implementaci, viz 4.10.5 | 6 min |
| `contracts-schema` | Go strana ověří, že kontraktní sloupce existují a mají očekávaný typ | 5 min |
| `openapi-drift` | vygeneruje OpenAPI a porovná s commitnutým souborem | 3 min |
| `i18n-check` | shoda klíčů `cs.json` a `en.json`, validita ICU výrazů | 2 min |
| `licenses-node` | `license-checker` s whitelistem | 4 min |
| `licenses-go` | `go-licenses check` | 4 min |
| `migrations-check` | tři scénáře z 3.13 | 10 min |
| `build-image` | multi-stage build, kontrola velikosti proti limitu 250 MB | 15 min |
| `e2e` | Playwright proti compose z čerstvé image | 20 min |

Celkový limit workflow: **35 minut** při plné paralelizaci. Joby `e2e` a `build-image` běží až po zelených rychlých jobech, aby se neplýtvalo runnery.

**Jak běží testy senderu vedle testů aplikace:** jsou to samostatné joby s vlastním setupem (`actions/setup-go` versus `pnpm`), spouštěné paralelně. Jediné, co sdílejí, je adresář `packages/contracts/fixtures`, který Go čte přes `testdata` symlink. Job `contracts-golden` je jediný, který potřebuje obojí naráz, a proto v něm běží obě sady setupu.

**Licenční brána**

| Strana | Nástroj | Konfigurace |
|---|---|---|
| Node | `license-checker` 25.0.1 (BSD-3-Clause) | `--onlyAllow "MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;CC0-1.0;Unlicense;Python-2.0"` |
| Go | `google/go-licenses` (Apache-2.0) | `check --disallowed_types=forbidden,restricted,reciprocal` |

Whitelist obsahuje `Unlicense` a `CC0-1.0`, protože jde o veřejné vlastnictví bez podmínek, což je slučitelnější než MIT. `Python-2.0` je tam kvůli tranzitivním závislostem nástrojů, ne kvůli runtime.

Explicitní blocklist s vysvětlením, aby se nikdo nemusel ptát: `GPL-*`, `AGPL-*`, `LGPL-*`, `SSPL-*`, `BUSL-*`, `Elastic-2.0`, `Sustainable Use License` (n8n), `CC-BY-NC-*`.

Výjimky: soubor `licenses.allow.json` s poli `package`, `version`, `license`, `reason`, `approved_by`, `expires_at`. Výjimka bez `expires_at` neprojde validací. Bez toho se z výjimek stane trvalá díra.

Brána se zavádí **v hodině 0 až 2**, ne později. Vyhodit zabudovanou závislost je řádově dražší než ji nepustit dovnitř.

**Ostatní kontroly:** `pnpm audit --audit-level=high` a `govulncheck` běží jako **neblokující** job s vytvořením issue. Blokující by znamenalo, že libovolné nové CVE ve třetí straně zastaví vydání i bezpečnostní opravy.
---

## 4. Rozhraní

### 4.1 Konvence API (KONVENCE)

**Čtyři povrchy, čtyři různá pravidla**

| Povrch | Cesta | Autentizace | Definováno | CSRF | Rate limit podle 4.5 |
|---|---|---|---|---|---|
| Veřejné REST API | `/api/v1/**` | API klíč (`Authorization: Bearer oe_live_...`) nebo session | Hono + `@hono/zod-openapi` | ne | ano |
| Interní API pro UI | Server Actions a `/api/internal/**` | jen session | Next.js, zod validace | **ano** | ano |
| Trackovací a veřejné endpointy | `/t/**`, `/e/**`, `/u/**`, `/f/**`, `/s/c/**`, `/p/**`, `/r/**` | podepsaný token nebo veřejný klíč | Hono | ne | ano |
| **Příchozí webhooky od providerů** | `/api/webhooks/**` | **podpis providera**, viz níže | Hono, syrové tělo | ne | **ne** |

**Proč čtvrtý povrch musí existovat.** Konvence pro `/api/v1/**` by příchozí SNS endpoint odmítla hned třikrát: Amazon posílá `Content-Type: text/plain`, který není mezi povolenými, takže 415; kontrola `Origin` by přidala 403; a rate limit by při nárazu událostí odmítal doručení, které SNS bude opakovat. One-click odhlašování podle RFC 8058 má stejný problém, protože poštovní klient posílá `application/x-www-form-urlencoded` nebo `multipart/form-data` bez `Origin`.

Pravidla čtvrtého povrchu:

- Autentizace **výhradně podpisem providera** ověřeným proti jeho certifikátu nebo tajemství. Žádná session, žádný API klíč. Neplatný podpis je `signature_invalid` (401).
- **Bez CSRF ochrany.** Request nepochází z prohlížeče a `Origin` neexistuje.
- **Bez rate limitu podle 4.5.** Provider by na 429 doručení opakoval a vznikla by lavina. Ochrana proti zahlcení je velikost těla (1 MiB) a timeout, ne počet requestů.
- **Vlastní `Content-Type` per endpoint**, včetně `text/plain`.
- Tělo se čte **syrové** a podpis se ověřuje nad ním, ne nad znovu serializovaným JSONem.
- Idempotence je na endpointu, ne na hlavičce `Idempotency-Key`, protože ji provider neposílá.

**Tři upřesnění, která platí napříč povrchy:**

1. **Kontrola `Origin`** (3.2) platí **jen pro interní povrch a Server Actions**. Na `/api/v1/**` s API klíčem, na trackovacích cestách ani na `/api/webhooks/**` se neuplatňuje.
2. **Povolené `Content-Type` se určují per endpoint, ne globálně.** Výchozí hodnota pro `/api/v1/**` je `application/json`, ale endpoint si smí deklarovat vlastní seznam a OpenAPI ho nese.
3. **`Idempotency-Key` je povinný jen pro zápisy iniciované klientem na `/api/v1/**`.** Nevztahuje se na interní povrch (má session a CSRF token), na trackovací cesty ani na příchozí webhooky.

Veřejné REST API běží na Honu (4.12.33, MIT) mountnutém do Next.js Route Handleru na `app/api/v1/[[...route]]/route.ts`. Jeden proces, sdílené typy, ale routing a validace mimo konvence Next.js, protože potřebujeme generovat OpenAPI z definice cesty.

**Pravidla cest**

- Zdroje v množném čísle, `kebab-case` u víceslovných: `/api/v1/api-keys`, `/api/v1/webhook-endpoints`.
- Identifikátory v cestě jsou UUID: `/api/v1/contacts/{contact_id}`.
- Akce, které nejsou CRUD, jsou pod-zdroj slovesem: `POST /api/v1/campaigns/{id}/send`, ne `POST /api/v1/send-campaign`.
- Vnořování nejvýš o jednu úroveň. Místo `/workspaces/{w}/contacts/{c}/tags/{t}` je workspace v klíči nebo v hlavičce a cesta je `/contacts/{c}/tags/{t}`.
- Bez koncového lomítka. Request s ním dostane 308 na variantu bez něj.

**Metody a stavové kódy**

| Metoda | Použití | Úspěch |
|---|---|---|
| `GET` | čtení, nikdy vedlejší efekt | 200 |
| `POST` | vytvoření, akce | 201 s `Location`, nebo 200 u akce, nebo 202 u asynchronní akce |
| `PATCH` | částečná změna, tělo obsahuje jen měněná pole | 200 |
| `PUT` | úplná náhrada, používáme minimálně | 200 |
| `DELETE` | smazání (měkké tam, kde je definované) | 204 bez těla |

`PATCH` s `null` znamená "nastav na NULL", chybějící klíč znamená "neměň". Rozdíl je vidět, protože zod schéma používá `.optional().nullable()` a validace se dělá nad syrovým JSONem, ne nad objektem po deserializaci.

**Formát těla**

- `Content-Type: application/json; charset=utf-8`. Jiný typ u zápisu = 415 `unsupported_media_type`. Výjimky: `multipart/form-data` u nahrávání souborů, `text/csv` u importu.
- Klíče v JSONu jsou `snake_case`. Ne `camelCase`, protože API čtou i skripty v jiných jazycích a `snake_case` sedí na většinu z nich i na naše DB sloupce. Konverze na `camelCase` se dělá až v TypeScript klientovi.
- Časy jsou vždy řetězec ISO 8601 v UTC s `Z` a milisekundami: `2026-08-01T12:40:00.000Z`.
- Peníze jako řetězec s desetinnou tečkou, nikdy jako `float`.
- Prázdné pole se vrací jako `[]`, nikdy jako `null`.
- Neznámé klíče v těle jsou **odmítnuté** (zod `.strict()`), protože tiché ignorování překlepu je nejhorší možná odpověď na `{"emial": "..."}`.

**Limity requestu**

| Limit | Hodnota | Při překročení |
|---|---|---|
| tělo JSON | 1 MiB | 413 `payload_too_large` |
| tělo CSV importu | 200 MiB | 413 |
| tělo dávkového endpointu | 1 MiB, nejvýš 1 000 položek | 422 `too_many_items` |
| hloubka JSON | 20 | 400 `invalid_json` |
| délka URL | 8 kB | 414 |
| počet hlaviček | 100 | 431 |
| timeout requestu | 30 s (`GET`), 120 s (import) | 504 `dependency_timeout` |

**Korelace**

Každý request dostane `request_id`. Hodnota z hlavičky `X-Request-Id`, pokud vyhoví regulárnímu výrazu `^[A-Za-z0-9._-]{8,64}$`, jinak nově vygenerované UUIDv7. Vrací se v hlavičce `X-Request-Id`, je v každém logovacím řádku a v každé chybové odpovědi jako pole `request_id`.

**Logování:** `pino` 10.3.1 (MIT), JSON na stdout. Povinná pole: `time`, `level`, `msg`, `request_id`, `workspace_id`, `actor_type`, `actor_id`, `route`, `status`, `duration_ms`. Redakce (`redact`): `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.secret`, `*.token`, `*.secret_access_key`, `*.api_key`, `*.render_data`.

### 4.2 Chyby (otázka 5)

**Formát: RFC 9457 Problem Details**, `Content-Type: application/problem+json`.

```json
{
  "type": "https://docs.openengage.dev/errors/validation_failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "Pole 'email' není platná e-mailová adresa.",
  "instance": "/api/v1/contacts",
  "code": "validation_failed",
  "request_id": "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071",
  "errors": [
    { "path": "email", "code": "invalid_email", "message": "Není platná e-mailová adresa." },
    { "path": "attributes.age", "code": "expected_number", "message": "Očekáváno číslo." }
  ]
}
```

| Pole | Původ | Poznámka |
|---|---|---|
| `type` | RFC 9457 | URI identifikující typ problému. Klient ho **nemusí** stahovat, je to identifikátor. Výchozí `about:blank` nepoužíváme nikdy. |
| `title` | RFC 9457 | Stabilní **anglický** text, nezávislý na jazyce klienta. Pro člověka, který čte log. |
| `status` | RFC 9457 | Duplikuje HTTP status, jak RFC dovoluje. |
| `detail` | RFC 9457 | Lokalizovaný podle `Accept-Language`, výchozí `en`. Popisuje **tento** výskyt. |
| `instance` | RFC 9457 | Cesta requestu. |
| `code` | rozšíření | **Strojově čitelný identifikátor. Toto je pole, podle kterého se klient rozhoduje**, ne `type` ani `title`. |
| `request_id` | rozšíření | Pro dohledání v logu. |
| `errors` | rozšíření | Jen u `validation_failed`. `path` je JSON Pointer bez úvodního lomítka, tedy tečková notace. |
| `findings` | rozšíření | Seznam nálezů s vlastní závažností. Pro kontroly, které vracejí víc zjištění najednou a nejsou to validační chyby. |
| `params` | rozšíření | Strojově čitelné parametry chyby. Vše, co by jinak skončilo jen v lokalizovaném textu. |
| `retry_after` | rozšíření | Jen u `rate_limited` a `service_unavailable`, sekundy, duplikuje hlavičku `Retry-After`. |

**Proč `findings` a `params` musí existovat.** Původní obálka měla jen `errors` s pevným tvarem `{path, code, message}` a byla vázaná na `validation_failed`. Do ní se nevejdou tři reálné případy: preflight kampaně vrací čtrnáct nálezů s různou závažností (chyba versus varování), kvóta potřebuje předat `remaining` a `reset_at`, a zakázaný přechod stavu potřebuje sdělit aktuální stav a povolené akce. Bez rozšíření by to všichni nacpali do `detail`, což vlastní konvence zakazuje, protože podle textu se nedá rozhodovat. Obojí je rozšiřující člen povolený RFC 9457.

```json
{
  "type": "https://docs.openengage.dev/errors/campaign_not_sendable",
  "title": "Campaign is not sendable",
  "status": 422,
  "detail": "Kampaň nelze odeslat, našli jsme 2 problémy.",
  "instance": "/api/v1/campaigns/0192.../send",
  "code": "campaign_not_sendable",
  "request_id": "0192f3a0-...",
  "findings": [
    { "code": "campaign_no_unsubscribe", "severity": "error",
      "message": "Šablona neobsahuje odhlašovací odkaz.", "path": "design.blocks.7" },
    { "code": "domain_dmarc_missing", "severity": "warning",
      "message": "Doména nemá DMARC záznam.", "params": { "domain": "mail.example.cz" } }
  ]
}
```

```json
{
  "code": "provider_quota_exceeded",
  "status": 422,
  "params": { "remaining": 0, "reset_at": "2026-08-01T00:00:00.000Z", "quota": 50000 }
}
```

| Pole v `findings[]` | Povinné | Význam |
|---|---|---|
| `code` | ano | registrovaný kód ze stejného jmenného prostoru jako `code` na kořeni |
| `severity` | ano | `error` nebo `warning`. `error` blokuje operaci, `warning` ne |
| `message` | ano | lokalizovaný text pro člověka |
| `path` | ne | tečková cesta do těla requestu nebo do dokumentu |
| `params` | ne | strojově čitelné parametry tohoto nálezu |

Pravidlo, aby se `findings` nestal odpadkovým košem: **operace smí vrátit 4xx s `findings` jen tehdy, když obsahuje alespoň jeden nález se `severity: "error"`.** Samotná varování se vracejí s úspěšnou odpovědí, ne jako chyba.

`errors` zůstává vyhrazené pro `validation_failed` a jeho tvar se nemění. `findings` je pro doménové kontroly, `errors` pro porušení schématu.

Rozšiřující názvy začínají písmenem, obsahují alfanumerické znaky a podtržítka a mají alespoň tři znaky, jak RFC 9457 doporučuje.

**Lokalizace hlášek:** `title` je vždy anglicky a neměnný. `detail` se překládá přes katalogy z 3.9 pod klíčem `errors.<code>.detail` a `errors.<code>.<field_code>`. Klient, který chce vlastní texty, se řídí `code` a `errors[].code`, ne textem.

**Katalog chybových kódů (povinný artefakt)**

| `code` | HTTP | `title` | Opakovat? | Kdy |
|---|---|---|---|---|
| `unauthenticated` | 401 | Unauthenticated | ne | chybí nebo je neplatná session či klíč |
| `invalid_credentials` | 401 | Invalid credentials | ne | špatné jméno nebo heslo |
| `session_expired` | 401 | Session expired | ne | session vypršela nebo byla revokovaná |
| `signature_invalid` | 401 | Invalid signature | ne | **jediný kód pro neplatný podpis jakéhokoliv příchozího webhooku**, včetně SNS. Konkrétní příčina jde do `params.reason` (`bad_signature`, `cert_url_not_allowed`, `topic_mismatch`, `stale_timestamp`), ne do vlastního kódu. Kódy `sns_signature_invalid`, `sns_cert_url_invalid` a `sns_topic_mismatch` se **nezavádějí**, byl by to jmenný prostor per provider, který poroste s každým dalším |
| `forbidden` | 403 | Forbidden | ne | role nemá oprávnění |
| `insufficient_scope` | 403 | Insufficient scope | ne | API klíč nemá scope |
| `origin_not_allowed` | 403 | Origin not allowed | ne | `Origin` neodpovídá `APP_URL` |
| `csrf_token_invalid` | 403 | Invalid CSRF token | ne | chybí nebo nesedí `X-CSRF-Token` |
| `not_found` | 404 | Not found | ne | zdroj neexistuje, nebo na něj aktér nemá vidět |
| `method_not_allowed` | 405 | Method not allowed | ne | |
| `conflict` | 409 | Conflict | ne | obecný konflikt stavu |
| `already_exists` | 409 | Already exists | ne | porušení unikátnosti |
| `invalid_state_transition` | 409 | Invalid state transition | ne | například odeslání už odeslané kampaně |
| `idempotency_key_reuse` | 409 | Idempotency key reused | ne | stejný klíč, jiné tělo |
| `idempotency_request_in_progress` | 409 | Request in progress | **ano**, po `Retry-After` | souběžný request se stejným klíčem |
| `last_owner_cannot_be_removed` | 409 | Last owner cannot be removed | ne | |
| `setup_already_completed` | 409 | Setup already completed | ne | |
| `gone` | 410 | Gone | ne | zdroj trvale odstraněný |
| `endpoint_removed` | 410 | Endpoint removed | ne | zrušený endpoint API |
| `precondition_failed` | 412 | Precondition failed | ne | neshoda `If-Match` |
| `payload_too_large` | 413 | Payload too large | ne | |
| `unsupported_media_type` | 415 | Unsupported media type | ne | |
| `validation_failed` | 422 | Validation failed | ne | tělo neprošlo schématem |
| `too_many_items` | 422 | Too many items | ne | dávka nad limit |
| `unsupported_api_version` | 422 | Unsupported API version | ne | |
| `account_locked` | 423 | Account locked | ano, po `Retry-After` | dočasné uzamčení po neúspěšných přihlášeních |
| `resource_locked` | 423 | Resource locked | ano | zdroj drží jiná operace |
| `rate_limited` | 429 | Rate limit exceeded | ano, po `Retry-After` | |
| `quota_exceeded` | 429 | Quota exceeded | ano | kvóta provideru, viz část 4 |
| `internal_error` | 500 | Internal server error | ano | neočekávaná chyba, `detail` nikdy neobsahuje stack |
| `not_implemented` | 501 | Not implemented | ne | endpoint deklarovaný, ale nedostupný v této fázi |
| `service_unavailable` | 503 | Service unavailable | ano | readiness selhala |
| `migration_failed` | 503 | Migration failed | ne | režim údržby podle 3.13 |
| `dependency_timeout` | 504 | Dependency timeout | ano | databáze nebo externí služba neodpověděla |

**Konvence pro doménové kódy:** části 2 až 5 zavádějí vlastní kódy tvarem `<domena>_<problem>` malými písmeny s podtržítky, například `campaign_already_sent`, `segment_too_complex`, `contact_suppressed`. Kód musí být unikátní napříč celým API; hlídá to test, který sesbírá všechny registrované kódy a spadne na duplicitu. Nový kód se registruje v `packages/core/errors/registry.ts` spolu s HTTP statusem a příznakem opakovatelnosti.

**Test, který rozhoduje o tom, jestli má kód existovat:** vede klient na základě tohohle kódu k jiné akci než na základě obecného? Když ne, patří tam obecný kód. `campaign_not_found` je zbytečný, `not_found` stačí. `provider_quota_exceeded` naopak smysl má, protože obecné `quota_exceeded` vede uživatele k „mám upgradovat", zatímco tenhle k „požádej AWS o zvýšení limitu".

**Registrované doménové kódy části 4a (kampaně, providery, doručitelnost)**

`Op.` = opakovatelné, tedy má smysl zkusit tentýž požadavek znovu beze změny vstupu.

| `code` | HTTP | `title` | Op. |
|---|---|---|---|
| `campaign_locked` | 409 | Campaign is locked | ne |
| `campaign_audience_changed` | 409 | Campaign audience changed | ne |
| `campaign_undo_window_expired` | 409 | Undo window expired | ne |
| `campaign_audience_empty` | 422 | Campaign audience is empty | ne |
| `campaign_audience_too_large` | 422 | Campaign audience too large | ne |
| `campaign_not_compiled` | 422 | Campaign template not compiled | **ano** |
| `campaign_subject_missing` | 422 | Campaign subject is missing | ne |
| `campaign_no_unsubscribe` | 422 | Template has no unsubscribe link | ne |
| `campaign_unknown_merge_field` | 422 | Template references unknown field | ne |
| `campaign_schedule_too_soon` | 422 | Scheduled time is too soon | ne |
| `campaign_schedule_too_far` | 422 | Scheduled time is too far ahead | ne |
| `campaign_not_sendable` | 422 | Campaign is not sendable | ne |
| `provider_not_ready` | 422 | Sending provider is not ready | ano |
| `provider_sending_paused` | 422 | Provider sending is paused | ano |
| `provider_quota_exceeded` | 422 | Provider daily quota exceeded | ano |
| `provider_sandbox` | 422 | Provider account is in sandbox | ne |
| `provider_credentials_invalid` | 422 | Provider credentials are invalid | ne |
| `domain_dkim_missing` | 422 | Domain DKIM is not verified | ano |
| `domain_spf_missing` | 422 | Domain SPF record is missing | ano |
| `domain_dmarc_missing` | 422 | Domain DMARC record is missing | ano |
| `test_recipient_suppressed` | 422 | Test recipient is suppressed | ne |

`type` URI se dogeneruje podle vzorce `https://docs.openengage.dev/errors/{code}`, nevyplňuje se ručně.

Tři poznámky k téhle skupině:

- **`campaign_not_compiled` je opakovatelné, i když to vypadá divně.** UI na něj reaguje spuštěním kompilace šablony a zopakováním požadavku. Je to jediný kód v katalogu, kde je opakování akcí klienta, ne čekáním.
- **`domain_*` jsou opakovatelné, ale s odstupem.** DNS propagace trvá minuty až hodiny. `retry_after` proto **rozšiřuju i mimo `rate_limited` a `service_unavailable`**: smí ho nést jakýkoliv kód označený jako opakovatelný a znamená „dřív to nezkoušej". U `domain_*` se plní hodnotou 300.
- **`sns_*` kódy se nezavádějí**, viz `signature_invalid` v katalogu výše.

Sedm kódů `provider_smtp_*` (`host_unknown`, `connection_refused`, `tls_invalid`, `auth_failed`, `timeout` a dva další) doplní část 4a, všechny budou 422 a opakovatelné.

**Nikdy v odpovědi:** stack trace, SQL dotaz, název tabulky nebo sloupce, obsah env proměnných, e-mail cizího uživatele. Interní detaily jdou do logu pod `request_id`.

**Mapování na jiné formáty:** trackovací endpointy (`/t/**`) chyby neposílají jako problem+json, protože je konzumuje prohlížeč nebo poštovní klient. Otevírací pixel vrací vždy 200 s 1x1 GIF, klik s neplatným tokenem vrací 302 na `/t/expired`. Detaily vlastní část 5.

### 4.3 Stránkování (KONVENCE)

**Cursor, ne offset.** Offset u tabulky s miliony řádků znamená, že si databáze musí projít a zahodit N řádků, a navíc při souběžném zápisu přeskakuje a duplikuje položky.

**Požadavek**

```
GET /api/v1/contacts?limit=50&cursor=eyJrIjpbIjAxOTJmM2EwLTFjMmQtN2U0MyJdLCJkIjoibiJ9&order=created_at.desc
```

| Parametr | Výchozí | Meze |
|---|---|---|
| `limit` | 50 | 1 až 200; nad limit 422 `validation_failed` |
| `cursor` | žádný | neprůhledný řetězec z předchozí odpovědi |
| `order` | `created_at.desc` | jen hodnoty vyjmenované u konkrétního zdroje |

**Odpověď**

```json
{
  "data": [ ],
  "pagination": {
    "next_cursor": "eyJrIjpb...",
    "prev_cursor": null,
    "has_more": true,
    "limit": 50
  }
}
```

**Kurzor** je `base64url(JSON)` s tvarem `{"k": [<hodnoty řadicích klíčů posledního řádku>], "d": "n" | "p", "o": "<order>"}`. Když se `o` v kurzoru neshoduje s parametrem `order`, request skončí 422 `validation_failed`, protože jinak by výsledek nedával smysl. Kurzor **není** podepsaný; neobsahuje nic tajného a workspace se stejně bere z autentizace.

**Stabilita řazení:** každé `order` končí implicitně `, id desc`, aby byl klíč jednoznačný. Podmínka je pak keyset porovnání n-tice: `(created_at, id) < ($1, $2)`. Index musí odpovídat pořadí sloupců, jinak stránkování zpomalí lineárně, a to je právě důvod, proč každý zdroj vyjmenovává povolené `order` hodnoty.

**Počty:** `has_more` je odvozený z načtení `limit + 1` řádků. **Celkový počet se v odpovědi seznamu nevrací nikdy**, protože `COUNT(*)` nad segmentem s pěti miliony kontaktů zablokuje odpověď a platil by se při každém listování.

**Samostatný endpoint na počty (KONVENCE)**

Každá kolekce, u které uživatel potřebuje vidět velikost, má vedle seznamu tenhle endpoint:

```
GET /api/v1/<kolekce>/count?<stejné filtry jako u seznamu>
```

```json
{
  "count": 48211,
  "precision": "exact",
  "computed_at": "2026-07-31T14:22:03.000Z",
  "stale": false
}
```

| Pole | Význam |
|---|---|
| `count` | číslo |
| `precision` | `exact` nebo `estimated` |
| `computed_at` | kdy hodnota vznikla |
| `stale` | `true`, když je hodnota z cache a starší než TTL kolekce |

**Jak se určuje `precision`, aby endpoint nikdy nebyl pomalý:**

1. Spustí se `COUNT(*)` se **stejným indexem jako seznam** a se `statement_timeout` **500 ms**.
2. Doběhne: vrátí se `exact`.
3. Timeout: vrátí se odhad plánovače (`EXPLAIN` nad tímtéž dotazem, u nefiltrovaného seznamu `reltuples`) jako `estimated`.

Drtivá většina instalací tak dostane přesné číslo a nikdo nečeká déle než půl sekundy.

**Proč samostatný endpoint a ne pole v odpovědi seznamu.** Aby seznam nikdy nečekal na počet. UI vykreslí tabulku hned a počet doplní, až dorazí, případně request zruší, když uživatel mezitím změní filtr.

**Číslované stránkování se nezavádí.** Kurzor je pozice v seřazené množině, ne pořadové číslo, takže skok na stránku 47 jde postavit jen tak, že se pod tím schová `OFFSET`, čímž se ztratí všechno, kvůli čemu kurzor je. UI dostává předchozí, další a filtry. Počet se zobrazuje jako `48 211 kontaktů` u `exact` a `~48 000 kontaktů` u `estimated`.

### 4.4 Idempotence zápisů (KONVENCE)

**Kde je povinná:** každý `POST`, který něco vytváří nebo spouští nevratnou akci. Konkrétně: vytvoření kontaktu, import, odeslání kampaně, testovací odeslání, vytvoření klíče, vytvoření webhook endpointu, server-side event.

**Hlavička:** `Idempotency-Key`, 8 až 255 znaků z `[A-Za-z0-9._:-]`. Doporučený obsah je UUID. Chybějící hlavička u endpointu, kde je povinná, znamená 422 `validation_failed` s `errors[0].path = "Idempotency-Key"`.

**Algoritmus**

```
fingerprint = SHA-256(method || "\n" || path || "\n" || kanonický JSON těla)
```

Kanonizace: klíče objektů seřazené podle kódových bodů, bez nevýznamných mezer, čísla v nejkratší podobě. Bez kanonizace by přeformátovaný stejný request vypadal jako jiný.

```
1. INSERT INTO idempotency_keys (workspace_id, key, fingerprint, status, expires_at)
   VALUES (..., 'in_progress', now() + interval '24 hours')
   ON CONFLICT (workspace_id, key) DO NOTHING;
2. Vložilo se 0 řádků => klíč už existuje:
   a. status = 'completed' a fingerprint sedí  -> vrať uloženou odpověď,
      hlavička Idempotent-Replay: true
   b. status = 'completed' a fingerprint nesedí -> 409 idempotency_key_reuse
   c. status = 'in_progress' a locked_at < 60 s -> 409 idempotency_request_in_progress,
      Retry-After: 2
   d. status = 'in_progress' a locked_at >= 60 s -> převezmi zámek
      (UPDATE ... SET locked_at = now() WHERE ... AND locked_at = <stará hodnota>),
      pokud UPDATE ovlivnil 1 řádek, pokračuj; jinak zpět na bod 2c
3. Vykonej operaci.
4. UPDATE idempotency_keys SET status='completed', response_status, response_body,
   completed_at = now();
```

**Uložená odpověď:** jen stavový kód a tělo, nejvýš 64 kB. Větší odpověď se neuloží, uloží se jen `response_status` a odkaz na vytvořený zdroj; opakování pak vrátí 303 na `Location`. Retence 24 hodin, úklid jobem `platform.cleanup_idempotency`.

**Chyba během operace:** záznam se **smaže**, aby šlo request bezpečně zopakovat. Výjimka: chyby 4xx způsobené vstupem se ukládají jako výsledek, protože zopakování stejného špatného requestu má dát stejnou odpověď.

### 4.5 Rate limiting (otázka 6)

**Knihovna:** `rate-limiter-flexible` 11.2.0 (ISC, 3,0 mil. stažení týdně, aktualizováno 2026-06-08). Backend podle `RATE_LIMIT_BACKEND`:

| Hodnota | Kdy | Poznámka |
|---|---|---|
| `memory` (výchozí) | jedna instance (`MODE=all`) | žádná režie, limity platí per proces |
| `postgres` | víc replik | tabulka `rate_limits` ve schématu `platform`, sdílený stav |

Redis se v MVP 0 nezavádí, jak určuje hlavní specifikace. `postgres` backend má vyšší latenci (jednotky ms), což je u limitů na úrovni desítek requestů za sekundu přijatelné.

**Algoritmus:** posuvné okno s pevnými sloty (`rate-limiter-flexible` výchozí). Ne token bucket, protože ten dovoluje jednorázový výbuch, a u ingestion endpointu je právě výbuch to, před čím se chráníme.

**Limity**

| Klíč | Endpointy | Limit | Okno |
|---|---|---|---|
| IP | `POST /api/v1/auth/login` | 20 | 5 min |
| IP + e-mail | `POST /api/v1/auth/login` | 5 | 5 min |
| IP | `POST /api/v1/auth/password-reset` | 5 | 60 min |
| IP | `POST /api/v1/setup` | 10 | 60 min |
| session (user_id) | interní API a Server Actions | 600 | 1 min |
| API klíč | `GET /api/v1/**` | 1000 | 1 min |
| API klíč | zápisové `/api/v1/**` | 300 | 1 min |
| API klíč | `POST /api/v1/contacts/import` | 10 | 60 min |
| API klíč | `POST /api/v1/campaigns/{id}/send` | 30 | 60 min |
| veřejný klíč (`oe_pub_`) | `POST /e/track` | 6000 | 1 min |
| veřejný klíč + IP | `POST /e/track` | 120 | 1 min |
| IP | `/t/o/**`, `/t/c/**` | 600 | 1 min |
| IP | veřejné formuláře `/f/**` | 20 | 10 min |
| workspace | odchozí webhooky (souběžnost) | 5 souběžně | průběžně |

Limity per veřejný klíč a per IP existují vedle sebe schválně. Sám klíč omezuje celkovou zátěž z jednoho webu, sama IP omezuje jednoho útočníka.

**Odpověď při překročení**

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
Retry-After: 37
RateLimit-Limit: 300
RateLimit-Remaining: 0
RateLimit-Reset: 37
```

Hlavičky `RateLimit-*` odpovídají návrhu IETF `draft-ietf-httpapi-ratelimit-headers` a posílají se **i u úspěšných odpovědí**, aby klient viděl, jak blízko je limitu. `Retry-After` je v sekundách.

**Zjištění IP adresy:** `TRUST_PROXY` určuje, kolik proxy vrstev věřit. Při `TRUST_PROXY=0` (výchozí) se bere adresa spojení a `X-Forwarded-For` se ignoruje. Při `TRUST_PROXY=n` se bere `n`-tá adresa zprava z `X-Forwarded-For`. Naivní "vezmi první hodnotu z XFF" je zakázané, protože ji útočník nastaví.

**Vyloučení z limitů:** `/api/health`, `/api/health/ready`, `/metrics`. Nic jiného.

### 4.6 Verzování API (otázka 7)

**Model:** verze v cestě, `/api/v1/`. Ne hlavička, ne datum. Verze v cestě je vidět v logu, v curl příkazu i v dokumentaci a nikdo si ji omylem nezmění.

**Co je breaking change (a vyžaduje `v2`)**

| Změna | Breaking |
|---|---|
| Odebrání endpointu nebo metody | ano |
| Odebrání pole z odpovědi | ano |
| Přejmenování pole kdekoliv | ano |
| Změna typu pole (`string` na `number`, skalár na pole) | ano |
| Zúžení formátu hodnoty (delší UUID, jiný tvar ID) | ano |
| Nové **povinné** pole v requestu | ano |
| Zpřísnění validace existujícího pole | ano |
| Změna výchozí hodnoty, která mění chování | ano |
| Změna HTTP statusu u existujícího scénáře | ano |
| Změna `code` u existující chyby | ano |
| Změna výchozího řazení seznamu | ano |
| Odebrání hodnoty z výčtu v **odpovědi** | ano |
| Nové pole v odpovědi | ne |
| Nové **volitelné** pole v requestu | ne |
| Nový endpoint | ne |
| Nová hodnota ve výčtu v **odpovědi** | ne, klienti musí neznámé hodnoty tolerovat (je to v dokumentaci) |
| Nový chybový `code` u nového scénáře | ne |
| Nová volitelná hlavička | ne |
| Rozvolnění validace | ne |

Poslední řádek s výčty je past, kterou je lepší mít napsanou: přidání hodnoty `status: "paused"` do kampaní **není** breaking podle naší definice, ale rozbije klienta se `switch` bez `default`. Proto je v dokumentaci pro integrátory explicitní požadavek na tolerantní parsování a v `sdk-node` jsou výčty typované jako `'a' | 'b' | (string & {})`.

**Životní cyklus verze**

| Fáze | Chování |
|---|---|
| aktivní | plná podpora |
| deprecated | odpovědi nesou `Deprecation: true` a `Sunset: <RFC 1123 datum>` (RFC 8594), v UI banner |
| po sunset | 410 `endpoint_removed` s `detail` odkazujícím na migrační průvodce |

Minimální doba mezi ohlášením deprecated a sunsetem: **12 měsíců** u celé verze, **6 měsíců** u jednotlivého endpointu. U self-hosted produktu je to ještě důležitější než u SaaS, protože uživatel aktualizuje, kdy chce.

**Verze v payloadu webhooku:** pole `api_version` z 3.8. Endpoint si verzi volí při vytvoření a my ji držíme, dokud ji neodstraníme podle stejného rozvrhu.

### 4.7 OpenAPI (otázka 8)

**Zdroj pravdy: zod schémata v kódu.** Ne ručně psaný YAML a ne generování z běhu.

```ts
// packages/core/identity/api/api-keys.routes.ts
import { createRoute, z } from '@hono/zod-openapi';

export const ApiKeySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  kind: z.enum(['secret', 'public']),
  prefix: z.string().length(8),
  scopes: z.array(PermissionSchema),
  last_used_at: z.iso.datetime().nullable(),
  expires_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
}).openapi('ApiKey');

export const createApiKeyRoute = createRoute({
  method: 'post',
  path: '/api-keys',
  tags: ['API keys'],
  security: [{ bearerAuth: ['api_keys:write'] }],
  request: {
    headers: z.object({ 'idempotency-key': z.string().min(8).max(255) }),
    body: { content: { 'application/json': { schema: CreateApiKeyInput } } },
  },
  responses: {
    201: { description: 'Vytvořeno', content: { 'application/json': { schema: ApiKeyWithSecret } } },
    403: problemResponse('forbidden', 'insufficient_scope'),
    409: problemResponse('idempotency_key_reuse'),
    422: problemResponse('validation_failed'),
  },
});
```

- Knihovna: `@hono/zod-openapi` 1.5.1 (MIT), peer `zod ^4.0.0` a `hono >= 4.10.0`, tedy sedí na `zod` 4.4.3 a `hono` 4.12.33.
- Jedna definice slouží zároveň jako runtime validace, jako typ pro handler a jako zdroj OpenAPI. Nemůže se rozejít, protože je jen jedna.
- Verze specifikace: **OpenAPI 3.1**, jak požaduje hlavní specifikace. `@hono/zod-openapi` generuje 3.1 (`OpenAPIHono.getOpenAPI31Document`).

**Jak se generuje a proč nemůže zestárnout**

1. `pnpm contracts:generate` zapíše `packages/contracts/openapi.json` a commituje se do repozitáře.
2. CI job `openapi-drift` (blokující) vygeneruje soubor znovu a porovná bajt po bajtu. Rozdíl = spadlý build s instrukcí spustit generátor.
3. Endpoint `GET /api/v1/openapi.json` servíruje **ten samý commitnutý soubor**, ne generovaný za běhu, aby se produkce chovala stejně jako repozitář.
4. `GET /api/v1/docs` je Scalar nebo Redoc UI nad tím souborem, bez externích CDN, protože instalace může být v uzavřené síti.
5. Endpoint bez OpenAPI definice je v CI chyba: test projde router a porovná seznam registrovaných cest se seznamem cest ve vygenerovaném dokumentu.

**Co v OpenAPI být musí:** u každého endpointu `security` se seznamem potřebných scopes, všechny chybové odpovědi se schématem `Problem`, příklady requestu a odpovědi. Chybějící příklad je varování, chybějící chybová odpověď je chyba testu.

### 4.8 Endpointy vlastněné částí 1

Autentizace a session (bez workspace kontextu):

| Metoda a cesta | Request | Odpověď | Chyby |
|---|---|---|---|
| `POST /api/v1/setup` | `{email, password, name, workspace_name, locale}` | 201 `{user, workspace}` | 409 `setup_already_completed`, 422 |
| `POST /api/v1/auth/login` | `{email, password}` | 200 `{user, workspaces[]}` + cookie | 401 `invalid_credentials`, 423 `account_locked`, 429 |
| `POST /api/v1/auth/logout` | prázdné | 204 | 401 |
| `POST /api/v1/auth/logout-all` | prázdné | 204 | 401 |
| `GET /api/v1/auth/me` | | 200 `{user, memberships[]}` | 401 |
| `PATCH /api/v1/auth/me` | `{name?, locale?, timezone?}` | 200 `{user}` | 401, 422 |
| `POST /api/v1/auth/change-password` | `{current_password, new_password}` | 204 | 401, 422 |
| `POST /api/v1/auth/password-reset` | `{email}` | 202 vždy | 429 |
| `POST /api/v1/auth/password-reset/confirm` | `{token, new_password}` | 204 | 401 `unauthenticated`, 422 |
| `GET /api/v1/auth/sessions` | | 200 `{data[]}` | 401 |
| `DELETE /api/v1/auth/sessions/{id}` | | 204 | 401, 404 |

Workspaces a členství:

| Metoda a cesta | Oprávnění | Odpověď |
|---|---|---|
| `GET /api/v1/workspaces` | členství | 200, jen workspaces aktéra |
| `POST /api/v1/workspaces` | přihlášený uživatel | 201, zakladatel se stává ownerem |
| `GET /api/v1/workspaces/{id}` | `workspace:read` | 200 |
| `PATCH /api/v1/workspaces/{id}` | `workspace:update` | 200 |
| `DELETE /api/v1/workspaces/{id}` | `workspace:delete` | 204, měkké smazání; vyžaduje `{confirm_name}` v těle |
| `POST /api/v1/workspaces/{id}/restore` | `workspace:delete` | 200, do 30 dnů |
| `POST /api/v1/workspaces/{id}/transfer-ownership` | `workspace:transfer` | 200, vyžaduje `X-Reauth-Password` |
| `GET /api/v1/members` | `members:read` | 200 |
| `PATCH /api/v1/members/{user_id}` | `members:update_role` | 200; 409 `last_owner_cannot_be_removed` |
| `DELETE /api/v1/members/{user_id}` | `members:remove` | 204 |
| `GET /api/v1/invitations` | `members:read` | 200 |
| `POST /api/v1/invitations` | `members:invite` | 201; 409 `already_exists`, `already_member` |
| `DELETE /api/v1/invitations/{id}` | `members:invite` | 204 (revokace) |
| `POST /api/v1/invitations/accept` | přihlášený uživatel | 200 `{workspace, role}`; 404 na neplatný token |

API klíče, webhooky, audit, provoz:

| Metoda a cesta | Oprávnění | Poznámka |
|---|---|---|
| `GET /api/v1/api-keys` | `api_keys:read` | sekret nikdy |
| `POST /api/v1/api-keys` | `api_keys:write` | 201, jediné místo se sekretem v odpovědi |
| `POST /api/v1/api-keys/{id}/rotate` | `api_keys:write` | 200 s novým sekretem |
| `DELETE /api/v1/api-keys/{id}` | `api_keys:write` | 204, revokace |
| `GET /api/v1/webhook-endpoints` | `webhooks:read` | |
| `POST /api/v1/webhook-endpoints` | `webhooks:write` | 201 se `secret` v odpovědi jednou |
| `PATCH /api/v1/webhook-endpoints/{id}` | `webhooks:write` | |
| `DELETE /api/v1/webhook-endpoints/{id}` | `webhooks:write` | 204 |
| `POST /api/v1/webhook-endpoints/{id}/test` | `webhooks:write` | pošle `ping` událost |
| `POST /api/v1/webhook-endpoints/{id}/enable` | `webhooks:write` | znovuaktivace po deaktivaci |
| `GET /api/v1/webhook-deliveries` | `webhooks:read` | filtry `endpoint_id`, `event_type`, `status` |
| `POST /api/v1/webhook-deliveries/{id}/retry` | `webhooks:write` | ruční opakování |
| `GET /api/v1/audit-log` | `audit:read` | filtry podle 3.7 |
| `GET /api/v1/openapi.json` | veřejné | commitnutý dokument |
| `GET /api/health`, `/api/health/ready` | veřejné | viz 3.12 |
| `GET /metrics` | `METRICS_TOKEN` v `Authorization` | Prometheus, vypnuté ve výchozím stavu |

**Kompletní typ `Problem`** pro `sdk-node` a pro ostatní části:

```ts
export type Problem = {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  request_id: string;
  errors?: Array<{ path: string; code: string; message: string }>;
  retry_after?: number;
};

export type Paginated<T> = {
  data: T[];
  pagination: {
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
};
```

### 4.9 Konfigurační proměnné (otázka 12, povinný artefakt)

Validace při startu: jedno zod schéma v `packages/core/config`. Při chybě se vypíšou **všechny** problémy naráz (ne první) a proces skončí s exit code **78** (`EX_CONFIG`). Go sender validuje svou podmnožinu vlastním kódem se stejnými názvy a stejnými výchozími hodnotami; shodu hlídá test `config-parity`, který porovná zod schéma s Go strukturou vygenerovanou do `packages/contracts/config.json`.

Legenda sloupce "Kdo": W = web, K = worker, S = sender.

| Proměnná | Typ | Povinná | Výchozí | Kdo | Validace a chování |
|---|---|---|---|---|---|
| `APP_URL` | URL | **ano** | | W K | absolutní URL s `http` nebo `https`, bez koncového lomítka. Používá se v odkazech v e-mailech a pro `Origin` kontrolu. Chybí = start selže. |
| `SECRET_KEY` | string | **ano** | | W K S | `[<key_id>:]<base64url>`, po dekódování přesně 32 B. Odmítne se známý ukázkový klíč z dokumentace. |
| `SECRET_KEY_PREVIOUS` | string | ne | prázdné | W K S | čárkou oddělený seznam `<key_id>:<base64url>`, **bez horního počtu položek** (strop by znemožnil ověřit nejstarší otisky, viz 3.10) |
| `DATABASE_URL` | URL | **ano** | | W K | `postgres://`, role `openengage_app` |
| `DATABASE_URL_SENDER` | URL | ne | odvozeno z `DATABASE_URL` s uživatelem `openengage_sender` | S | při `MODE=all` se dopočítá, jinak povinná |
| `DATABASE_POOL_MAX` | int | ne | 10 | W K | 1 až 100 |
| `DATABASE_STATEMENT_TIMEOUT_MS` | int | ne | 30000 | W K | 1000 až 600000 |
| `MODE` | enum | ne | `all` | W K S | `web`, `worker`, `sender`, `all` |
| `PORT` | int | ne | 3000 | W | 1 až 65535 |
| `HEALTH_PORT` | int | ne | 3001 | K S | |
| `NODE_ENV` | enum | ne | `production` | W K | `production`, `development`, `test` |
| `LOG_LEVEL` | enum | ne | `info` | W K S | `trace`,`debug`,`info`,`warn`,`error`,`fatal` |
| `LOG_FORMAT` | enum | ne | `json` | W K S | `json`, `pretty` (pretty jen mimo produkci) |
| `TRUST_PROXY` | int | ne | 0 | W | 0 až 5, viz 4.5 |
| `DEFAULT_LOCALE` | string | ne | `cs` | W K | musí být v `SUPPORTED_LOCALES` |
| `SUPPORTED_LOCALES` | seznam | ne | `cs,en` | W K | musí existovat katalog pro každý |
| `DEFAULT_TIMEZONE` | string | ne | `Europe/Prague` | W K | platná IANA zóna |
| `SIGNUP_MODE` | enum | ne | `closed` | W | `closed`, `invite`, `open` |
| `SESSION_ABSOLUTE_TTL_DAYS` | int | ne | 30 | W | 1 až 365 |
| `SESSION_IDLE_TTL_DAYS` | int | ne | 14 | W | 1 až `SESSION_ABSOLUTE_TTL_DAYS` |
| `MIGRATE_ON_START` | bool | ne | `true` | W | při `false` se jen ověří shoda verze |
| `MIGRATE_LOCK_TIMEOUT_SECONDS` | int | ne | 300 | W | 10 až 3600 |
| `DATA_DIR` | cesta | ne | `/data` | W K | musí existovat a být zapisovatelná |
| `UPLOADS_DIR` | cesta | ne | `${DATA_DIR}/uploads` | W K | |
| `BACKUP_DIR` | cesta | ne | `${DATA_DIR}/backups` | K | |
| `BACKUP_TARGET` | enum | ne | `local` | K | v 1.0 jen `local` |
| `BACKUP_SCHEDULE_CRON` | cron | ne | `0 3 * * *` | K | prázdná hodnota vypne plánovanou zálohu |
| `BACKUP_RETENTION_DAYS` | int | ne | 14 | K | 1 až 3650; vždy zůstanou 3 poslední |
| `AUDIT_RETENTION_MONTHS` | int | ne | 24 | K | 1 až 120 |
| `RATE_LIMIT_BACKEND` | enum | ne | `memory` | W | `memory`, `postgres` |
| `RATE_LIMIT_ENABLED` | bool | ne | `true` | W | `false` jen pro testy, při `NODE_ENV=production` a `false` se loguje `warn` |
| `WORKER_CONCURRENCY` | int | ne | 5 | K | 1 až 50, mapuje se na `localConcurrency` u pg-boss |
| `PGBOSS_SCHEMA` | string | ne | `pgboss` | K | alfanumerické a podtržítko, do 50 znaků |
| `SENDER_ID` | string | ne | hostname + PID | S | zapisuje se do `messages.claimed_by`, max 64 znaků |
| `SENDER_CONCURRENCY` | int | ne | 32 | S | 1 až 1024 |
| `SENDER_BATCH_SIZE` | int | ne | 500 | S | 1 až 5000 |
| `SENDER_CLAIM_TTL_SECONDS` | int | ne | 300 | S | 30 až 3600, viz 4.10.1 |
| `SENDER_POLL_INTERVAL_MS` | int | ne | 1000 | S | 100 až 60000 |
| `SHUTDOWN_GRACE_SECONDS` | int | ne | 25 | W K S | 1 až 300 |
| `TRACKING_DOMAIN` | string | ne | odvozeno z `APP_URL` | W S | vlastní doména pro `/t/**` a `/e/**` |
| `WEBHOOK_ALLOW_PRIVATE_TARGETS` | bool | ne | `false` | K | povolí odchozí webhooky do privátních rozsahů |
| `WEBHOOK_MAX_ATTEMPTS` | int | ne | 8 | K | 1 až 12 |
| `METRICS_ENABLED` | bool | ne | `false` | W K S | |
| `METRICS_TOKEN` | string | ne | prázdné | W K S | povinná, když `METRICS_ENABLED=true`, min. 32 znaků |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL | ne | prázdné | W K S | prázdná hodnota = žádná telemetrie, což je výchozí stav |
| `IMAGE_VERSION` | string | ne | vloženo při buildu | W K S | jen ke čtení, do `/api/health` |

**Proměnné vlastněné jinými částmi**

Tvar, validace při startu a chování při chybě jsou stejné jako výše. Uvádím je odděleně, aby bylo vidět, kdo za kterou odpovídá. Hodnoty pocházejí od autorů příslušných částí.

*Bezpečnost, část 1 (doplněno na základě nálezu části 3):*

| Proměnná | Typ | Povinná | Výchozí | Kdo | Validace |
|---|---|---|---|---|---|
| `SENDER_CREDENTIALS_MAX_RETRIES` | int | ne | 10 | S | 1 až 100 |

Samostatná proměnná pro otisky suppression listu **neexistuje**, klíč se odvozuje ze `SECRET_KEY` jako všechno ostatní (3.10).

*Kampaně a doručitelnost, část 4a:*

| Proměnná | Typ | Výchozí | Kdo | Validace |
|---|---|---|---|---|
| `AMBIGUOUS_DISPATCH_POLICY_SES` | enum | **`fail`** | S | `retry` nebo `fail`. SES přepisuje `Message-ID`, viz 4.10.1 |
| `AMBIGUOUS_DISPATCH_POLICY_SMTP` | enum | **`retry`** | S | `retry` nebo `fail`. U SMTP deterministický `Message-ID` projde |
| `CAMPAIGN_MATERIALIZE_BATCH_SIZE` | int | 5000 | K | 100 až 50000 |
| `CAMPAIGN_MATERIALIZE_MAX_MINUTES` | int | 60 | K | 1 až 1440 |
| `CAMPAIGN_MAX_RECIPIENTS` | int | 2000000 | W K | 1 až 50000000 |
| `CAMPAIGN_PARTIAL_THRESHOLD` | float | 0.01 | K | 0 až 1 |
| `CAMPAIGN_SCHEDULE_CATCHUP_HOURS` | int | 6 | K | 0 až 168 |
| `CAMPAIGN_UNDO_WINDOW_SECONDS` | int | 60 | W K | 0 až 900, 0 vypíná |
| `SOFT_BOUNCE_THRESHOLD` | int | 3 | K | 1 až 20 |
| `SOFT_BOUNCE_WINDOW_DAYS` | int | 30 | K | 1 až 365 |
| `DELIVERABILITY_BOUNCE_GUARD_RATE` | float | 0.08 | K | 0 až 1, 0 vypíná |
| `DELIVERABILITY_COMPLAINT_GUARD_RATE` | float | 0.003 | K | 0 až 1, 0 vypíná |
| `DELIVERABILITY_GUARD_MIN_SENT` | int | 500 | K | 1 až 1000000 |
| `MESSAGE_RETENTION_DAYS` | int | 90 | K | 7 až 3650 |
| `MESSAGE_EVENT_RETENTION_DAYS` | int | 365 | K | 7 až 3650 |
| `SNS_CERT_CACHE_SECONDS` | int | 86400 | W | 60 až 604800 |
| `SNS_STORE_RAW_EVENTS` | bool | true | W K | při `false` se ztrácí možnost dohledat, proč se událost nespárovala |
| `DNS_CHECK_TIMEOUT_MS` | int | 3000 | K | 500 až 30000 |
| `DNS_CHECK_CONCURRENCY` | int | 10 | K | 1 až 50 |
| `AWS_API_TIMEOUT_MS` | int | 5000 | W K | 1000 až 60000 |

**Typ `float`** se tímhle zavádí do konfigurace poprvé. Validuje se jako číslo v uzavřeném intervalu, ne jako řetězec.

**Retenční proměnné mají ve skutečnosti měsíční granularitu**, ne denní. Retence u partitionovaných tabulek se provádí odpojením partition (2.1), takže `MESSAGE_RETENTION_DAYS=90` reálně drží 90 až 120 dní. Musí to být napsané u proměnné v dokumentaci, jinak to překvapí.

*Sender, část 4b:*

| Proměnná | Typ | Výchozí | Kdo | Validace |
|---|---|---|---|---|
| `SENDER_DISPATCH_TIMEOUT_SECONDS` | int | 10 | S | 1 až 300. Timeout jednoho volání provideru. Musí platit `SENDER_CLAIM_TTL_SECONDS > 4 × SENDER_DISPATCH_TIMEOUT_SECONDS`, ověřuje se při startu |

*Obsah, assety a AI, část 3:*

| Proměnná | Typ | Výchozí | Kdo | Validace |
|---|---|---|---|---|
| `ASSET_BASE_URL` | url | `APP_URL` | W K | absolutní URL |
| `ASSET_QUOTA_MB` | int | 2048 | W K | 100 až 1000000 |
| `ASSET_MAX_UPLOAD_MB` | int | 10 | W K | 1 až 100 |
| `ASSET_REQUIRE_SIGNED_URL` | bool | false | W K | podpis bez expirace, viz 3.10 |
| `ASSET_RATE_LIMIT_PER_IP` | int | 0 | W K | 0 až 100000 za hodinu |
| `STORAGE_DRIVER` | enum | `local` | W K | `local` nebo `s3` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | string | | W K | povinné při `STORAGE_DRIVER=s3` |
| `BRAND_FETCH_ENABLED` | bool | true | W K | |
| `BRAND_FETCH_ALLOW_HTTP` | bool | true | W K | jinak než u webhooků schválně, viz níže |
| `BRAND_FETCH_ALLOW_PRIVATE_NETWORKS` | bool | false | W K | `true` zaloguje varování při startu |
| `BRAND_FETCH_ALLOWED_HOSTS` | csv | prázdné | W K | prázdné = bez allowlistu |
| `BRAND_FETCH_BLOCKED_HOSTS` | csv | `metadata.google.internal,metadata.goog,instance-data,metadata` | W K | |
| `BRAND_FETCH_RESPECT_ROBOTS` | bool | true | W K | |
| `BRAND_FETCH_DNS_SERVERS` | csv | prázdné | W K | IP adresy |
| `BRAND_FETCH_DNS_TIMEOUT_MS` | int | 2000 | W K | 200 až 10000 |
| `BRAND_FETCH_CONNECT_TIMEOUT_MS` | int | 3000 | W K | 500 až 20000 |
| `BRAND_FETCH_HEADERS_TIMEOUT_MS` | int | 5000 | W K | 500 až 30000 |
| `BRAND_FETCH_BODY_TIMEOUT_MS` | int | 10000 | W K | 1000 až 60000 |
| `BRAND_FETCH_TOTAL_TIMEOUT_MS` | int | 30000 | W K | 5000 až 120000 |
| `BRAND_FETCH_MAX_HTML_BYTES` | int | 2097152 | W K | |
| `BRAND_FETCH_MAX_CSS_BYTES` | int | 524288 | W K | |
| `BRAND_FETCH_MAX_IMAGE_BYTES` | int | 5242880 | W K | |
| `BRAND_FETCH_MAX_TOTAL_BYTES` | int | 20971520 | W K | |
| `BRAND_FETCH_MAX_CSS_FILES` | int | 3 | W K | 0 až 10 |
| `BRAND_FETCH_MAX_IMAGE_FILES` | int | 8 | W K | 0 až 20 |
| `BRAND_FETCH_RATE_PER_HOUR` | int | 10 | W K | 1 až 1000 |
| `BRAND_FETCH_CONCURRENCY` | int | 3 | W K | 1 až 20 |
| `BRAND_EXTRACTION_INFER_TONE` | bool | true | W K | |
| `AI_ENABLED` | bool | true | W K | |
| `AI_REQUEST_TIMEOUT_MS` | int | 120000 | W K | 10000 až 600000 |
| `AI_MAX_TOKENS_PER_REQUEST` | int | 16000 | W K | |
| `AI_RATE_PER_HOUR` | int | 60 | W K | na projekt |
| `AI_CONVERSATION_RETENTION_DAYS` | int | 90 | K | 0 = neomezeně |
| `AI_ALLOW_CUSTOM_BASE_URL` | bool | true | W K | |
| `TEMPLATE_VERSION_RETENTION_DAYS` | int | 180 | K | 0 = neomezeně |
| `TEMPLATE_VERSION_MAX_UNPINNED` | int | 50 | K | 5 až 1000 |

`BRAND_FETCH_ALLOW_HTTP` je ve výchozím stavu `true`, zatímco odchozí webhooky `http` nepovolují vůbec. Rozdíl je záměrný a je nutné ho znát: webhook přenáší podepsané tajemství na adresu zvolenou uživatelem, kdežto stahování značky je čtení veřejné stránky, kde se žádné tajemství nepřenáší a weby zákazníků na `http` reálně existují.

**Nic z toho nemíří na náš cloud.** Žádná proměnná typu `LICENSE_KEY`, `TELEMETRY_URL` nebo `PHONE_HOME` neexistuje a existovat nebude. Je to železné pravidlo 4 z kapitoly 1 hlavní specifikace a v `packages/core/config` je test, který spadne na jakoukoliv proměnnou obsahující `license` nebo `telemetry` v názvu.

**Tajemství v souborech:** každá proměnná přijímá i variantu se sufixem `_FILE`, například `SECRET_KEY_FILE=/run/secrets/secret_key`. Když existují obě, vyhrává `_FILE`. Je to podmínka pro Docker secrets a Kubernetes.
### 4.10 Čtyři kontrakty TS ↔ Go (otázka 9) **KONTRAKT**

Všechno v této sekci je zmrazené po hodině 2 hackathonu. Změna znamená novou verzi formátu (`v2`) a souběžnou podporu obou, ne úpravu `v1`. Sdílené artefakty žijí v `packages/contracts`:

```
packages/contracts/
├── src/                       TypeScript implementace a typy
│   ├── outbox.ts
│   ├── liquid/                validátor a registrace filtrů pro LiquidJS
│   ├── token.ts
│   └── crypto.ts
├── fixtures/                  jazykově neutrální golden fixtures (JSON)
│   ├── liquid/*.json
│   ├── token/vectors.json
│   ├── crypto/vectors.json
│   └── outbox/scenarios.json
├── schema/                    JSON schémata fixtures, validují se v CI
├── config.json                vygenerovaný popis konfigurace pro paritu s Go
└── openapi.json               vygenerovaný OpenAPI dokument
```

Go strana čte `fixtures/` přes `apps/sender/testdata` (symlink) a implementaci má v `apps/sender/internal/contracts`.

---

#### 4.10.1 Kontrakt 1: Outbox protokol

**Rozdělení vlastnictví:** tabulku `messages` jako celek vlastní část 4. Tato sekce definuje **kontraktní podmnožinu**, tedy sloupce, stavy a dotazy, na které se spoléhá Go strana. Část 4 smí přidávat sloupce a indexy, nesmí měnit název, typ ani sémantiku kontraktních sloupců, hodnoty stavů, ani povolené přechody.

**Kontraktní sloupce**

```sql
-- KONTRAKTNÍ PODMNOŽINA tabulky messages. Část 4 vlastní zbytek.
CREATE TABLE messages (
  id                  uuid        NOT NULL DEFAULT uuidv7(),
  workspace_id        uuid        NOT NULL,
  campaign_id         uuid        NOT NULL,
  contact_id          uuid        NOT NULL,
  email               text        NOT NULL,
  render_data         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status              text        NOT NULL DEFAULT 'pending',
  claimed_by          text,
  claimed_at          timestamptz,
  claim_expires_at    timestamptz,
  attempts            smallint    NOT NULL DEFAULT 0,
  ambiguous_count     smallint    NOT NULL DEFAULT 0,
  dispatch_started_at timestamptz,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  provider_message_id text,
  sent_at             timestamptz,
  error_code          text,
  error_detail        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_messages__status
    CHECK (status IN ('pending','claimed','sent','failed','skipped'))
) PARTITION BY RANGE (created_at);

-- Claim dotaz senderu, druhý krok. Vede campaign_id jako první sloupec schválně:
-- claim vždy běží v rámci konkrétní běžící kampaně, viz "Dvoukrokový claim" níž.
-- Index (next_attempt_at, id) BEZ campaign_id by znamenal, že pozastavená kampaň
-- na 500 tisíc příjemců má nejstarší časy, řadí se první a každý claim jakékoliv
-- jiné kampaně by musel projít a zamknout jejích 500 tisíc řádků, než je join
-- zahodí. Dvakrát za sekundu na každý sender.
CREATE INDEX idx_messages__claimable
  ON messages (campaign_id, next_attempt_at, id)
  WHERE status = 'pending';

-- Reaper hledá zaseknuté claimy. Částečný index drží velikost v jednotkách řádků.
CREATE INDEX idx_messages__stuck
  ON messages (claim_expires_at)
  WHERE status = 'claimed';

-- Report kampaně a kontrola postupu.
CREATE INDEX idx_messages__campaign_status
  ON messages (campaign_id, status);

-- Deduplikace publika: jeden kontakt dostane kampaň nejvýš jednou.
-- POZOR: created_at v indexu je vynucené (unikátní index na partitionované
-- tabulce musí obsahovat partition key). Sám o sobě index NEDÁVÁ ochranu proti
-- duplicitám, dává ji až ve spojení s invariantem I1 níže.
CREATE UNIQUE INDEX uq_messages__campaign_contact
  ON messages (campaign_id, contact_id, created_at);

-- Řádek se za život několikrát přepíše (claim, heartbeat, dispatch, výsledek).
-- POZOR, poctivé zdůvodnění: HOT update se tady NEUPLATNÍ. HOT vyžaduje, aby se
-- nezměnil žádný indexovaný sloupec, včetně sloupců v predikátu částečného
-- indexu. Claim mění status, heartbeat mění claim_expires_at, zápis výsledku
-- mění status i provider_message_id. Ani jeden ze tří zápisů senderu tedy HOT
-- není a fillfactor to nezmění.
-- Nižší fillfactor přesto pomáhá, ale z jiného důvodu: nová verze řádku se vejde
-- do téže stránky, takže se nenafukuje počet stránek a sekvenční čtení reportu
-- zůstane rychlé. Je to opatření proti bloatu, ne proti přepisu indexů.
-- Úložné parametry nejdou nastavit na partitionované tabulce jako celku,
-- nastavují se na každé partition zvlášť. Dělá to createMonthlyPartitions.
ALTER TABLE messages_y2026m08 SET (
  fillfactor = 70,
  -- Bez agresivnějšího autovacuum degraduje claim v průběhu kampaně: mrtvé verze
  -- řádků zůstávají v částečném indexu idx_messages__claimable a claim je musí
  -- přeskakovat. Výchozí prahy (20 % tabulky) jsou při milionu řádků nedosažitelné
  -- dost dlouho na to, aby se to projevilo uprostřed rozesílky.
  autovacuum_vacuum_scale_factor  = 0.02,
  autovacuum_vacuum_threshold     = 1000,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay    = 0
);
```

**Invariant I1 (KONTRAKT): jedno `created_at` na celou kampaň.**

> Všechny řádky jedné kampaně mají `created_at` rovné `campaigns.audience_built_at`. Materializace tuhle hodnotu nastavuje **explicitně**, nespoléhá na `DEFAULT now()`. `audience_built_at` se ukládá zaokrouhlené na celé sekundy (`date_trunc('second', now())`). **Sender `created_at` nikdy nemění.**

Bez tohohle invariantu index `uq_messages__campaign_contact` nedává záruku, kterou jeho název slibuje. Dvě dávky materializace by dostaly různý `now()`, klíč by se lišil a duplicitní příjemce by prošel. Dnes to platí jen shodou okolností a netestuje to nic.

Dva důsledky, které je nutné znát:

1. **Celá kampaň leží v jedné partition**, vybrané v okamžiku materializace. Pro report kampaně je to výhoda, čte se jedna partition. Pro retenci je to past: kampaň materializovaná 31. srpna má všechny zprávy v srpnové partition, i když se dorozesílá v září. **Retenční job nesmí odpojit partition, ve které leží kampaň v nekoncovém stavu nebo zpráva ve stavu `pending` či `claimed`.** Veto je popsané v 2.1.
2. **Zaokrouhlení na sekundy** dělá z `created_at` hodnotu přesně reprezentovatelnou jako `uint32`, což je předpoklad pro pole `message_created_at` v trackovacím tokenu (4.10.3).

**Zápis při materializaci musí použít `ON CONFLICT` nad všemi třemi sloupci indexu:**

```sql
INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, render_data, created_at)
VALUES (...)
ON CONFLICT (campaign_id, contact_id, created_at) DO NOTHING;
```

Uvedení jen dvou sloupců není tichá chyba, ale tvrdý `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification`, a materializace by neproběhla vůbec.

**Stavy a přechody**

| Z | Do | Kdo | Podmínka |
|---|---|---|---|
| (vznik) | `pending` | aplikace | materializace publika |
| (vznik) | `skipped` | aplikace | příjemce vyloučený už při materializaci (suppression, odhlášený, neplatná adresa). Řádek vzniká rovnou jako `skipped`, aby byl v reportu vidět důvod vyloučení |
| `pending` | `claimed` | sender | claim dotaz |
| `pending` | `skipped` | aplikace | kontakt se mezitím odhlásil, dostal se na suppression list, **nebo byla kampaň zrušena** |
| `claimed` | `sent` | sender | provider přijal zprávu |
| `claimed` | `failed` | sender | trvalá chyba, nebo vyčerpané pokusy |
| `claimed` | `pending` | sender nebo reaper | opakovatelná chyba, nebo uvolnění při shutdownu, nebo expirovaný claim |
| `claimed` | `skipped` | sender | kontrola suppression těsně před odesláním selhala |
| `sent`, `failed`, `skipped` | (nic) | | **koncové stavy, žádný přechod zpět** |

Zakázané přechody, které musí odmítnout aplikační kód a musí mít test: `sent → pending`, `sent → claimed`, **`sent → failed`**, `failed → sent`, `skipped → cokoliv`, `pending → sent` (bez claimu).

> **Jediná výjimka ze zákazu `failed → sent` (KONTRAKT).** Přechod `failed → sent` je povolený **výhradně** tehdy, když má zpráva `error_code = 'ambiguous_dispatch'` a přechod provádí **aplikace** při zpracování události od providera. Sender tuhle výjimku nemá, provádí ji jen aplikační kód zpracovávající příchozí události.
>
> Důvod: `ambiguous_dispatch` znamená „nevíme, jestli jsme zprávu předali". Událost od providera je důkaz, že předaná byla, takže se nepřepisuje selhání, ale nejistota. Bez výjimky by kampaň napořád vykazovala selhání, která selháními nebyla, a `sent_count` by byl trvale podhodnocený.
>
> Vázanost na konkrétní hodnotu `error_code` dělá výjimku auditovatelnou: je to jedna hodnota v jednom sloupci, dá se na ni napsat test i dotaz do auditu. S jakýmkoliv jiným `error_code` musí přechod `failed → sent` selhat, včetně `NULL`. Rozbor je v části 4a, kapitola 11.13.

**`sent` je koncový, i když později přijde tvrdý bounce.**

`messages.status` popisuje **náš výsledek odeslání**, tedy jestli jsme zprávu předali provideru. Co se s ní stalo potom, patří do `message_events`. Běžná sekvence u SES je potvrzení odeslání a teprve pak bounce, někdy o dny později. Kdyby aplikace směla přepsat `sent` na `failed`, měl by ten sloupec **dva pisatele s úplně jiným životním cyklem, jeden v Go a jeden v TypeScriptu, bez společné transakce**. To je hlavní důvod tohohle rozhodnutí, uzavřenost automatu a čistota reportů jsou navrch.

> **Normativní pravidlo pro reporty.** `message_events` je jediný zdroj pravdy o **doručení**. `messages.status` je jediný zdroj pravdy o **předání provideru**. Report, dashboard doručitelnosti ani odchozí webhooky nesmí odvozovat míru doručení, bounce rate ani complaint rate ze `messages.status`. Zpráva ve stavu `sent`, ke které existuje událost typu `bounce`, **není v reportu doručená**.

Bez téhle věty si první implementátor reportu napíše `COUNT(*) WHERE status = 'sent'` a bude to vypadat správně až do prvního bounce.

**Zrušení kampaně je `pending → skipped`, ne `failed`.** Zrušená kampaň se o odeslání nepokusila. `failed` znamená „pokusili jsme se a nešlo to" a započítání zrušených zpráv mezi selhání by zkreslilo dashboard doručitelnosti a spustilo prahové alarmy.

> **Normativní pravidlo pro pauzu a zrušení.** Zprávy ve stavu `claimed` **doběhnou** bez ohledu na pauzu i zrušení kampaně. Pauza i zrušení působí jen na `pending`. Sender nemá jak vzít zpět zprávu, kterou už předal provideru, a přerušení rozpracované dávky uprostřed by znamenalo nejednoznačné odeslání u každé z nich.

Je to jediné místo v produktu, kde nástroj nesplní naivní očekávání uživatele („zrušil jsem to, tak se nic neodešle"), a proto to musí být napsané tady i v UI. Prakticky jde o nejvýš `SENDER_BATCH_SIZE` zpráv na běžící sender.

**Sender nikdy nemaže řádky.** `DELETE` na `messages` má sender odebrané v grantech. Úklid dělá retenční job aplikace odpojením partition.

**Claim je dvoukrokový (normativní)**

Jednokrokový claim s globálním `ORDER BY next_attempt_at` má patologii, která položí odesílání celé instalace: pozastavená kampaň na 500 tisíc příjemců má nejstarší časy, řadí se první, a **každý claim jakékoliv jiné kampaně** musí projít a zamknout jejích 500 tisíc řádků, než je join na `campaigns` zahodí. Dvakrát za sekundu na každý běžící sender. Proto se claim rozděluje.

**Krok 1: seznam běžících kampaní.** Levný dotaz nad malou tabulkou, výsledek si sender drží a obnovuje ho jednou za `SENDER_POLL_INTERVAL_MS`.

```sql
SELECT c.id
FROM campaigns c
JOIN workspaces w ON w.id = c.workspace_id
WHERE c.status IN ('queueing','sending')
  AND c.deleted_at IS NULL
  AND w.deleted_at IS NULL
ORDER BY c.scheduled_at NULLS FIRST, c.id;
```

`c.deleted_at IS NULL` je tam proto, že `campaigns` má měkké mazání. Aplikace sice smazání běžící kampaně blokuje na úrovni API, ale to spoléhá na jediné místo v kódu. Predikát nad už načteným řádkem nestojí nic.

`queueing` je v seznamu schválně: část 4a slibuje uživateli první odeslané zprávy do několika sekund od kliknutí, tedy ještě během materializace publika. Ochrana proti pauze i zrušení tím neslábne, ty mají vlastní stavy.

**Krok 2: claim v rámci jedné kampaně.** Běží nad indexem `idx_messages__claimable (campaign_id, next_attempt_at, id)`.

```sql
WITH claimable AS (
  SELECT m.id, m.created_at
  FROM messages m
  WHERE m.campaign_id = $4          -- jedna kampaň ze seznamu z kroku 1
    AND m.status = 'pending'
    AND m.next_attempt_at <= now()
  ORDER BY m.next_attempt_at, m.id
  LIMIT $2
  FOR UPDATE OF m SKIP LOCKED
)
UPDATE messages m
SET status           = 'claimed',
    claimed_by       = $1,
    claimed_at       = now(),
    claim_expires_at = now() + make_interval(secs => $3),
    updated_at       = now()
FROM claimable cl, campaigns c, workspaces w
WHERE m.id         = cl.id
  AND m.created_at = cl.created_at
  AND c.id         = m.campaign_id     -- pojistka proti závodu, viz níž
  AND w.id         = m.workspace_id
  AND c.status IN ('queueing','sending')
  AND c.deleted_at IS NULL
  AND w.deleted_at IS NULL
RETURNING m.id, m.created_at, m.workspace_id, m.campaign_id, m.contact_id,
          m.email, m.render_data, m.attempts;
```

**Proč spojovací podmínky ve `WHERE` a ne v `ON`.** Tvar `FROM claimable cl JOIN campaigns c ON c.id = m.campaign_id` **PostgreSQL odmítne**:

```
ERROR:  invalid reference to FROM-clause entry for table "m"
HINT:   There is an entry for table "m", but it cannot be referenced from this part of the query.
```

Cílová tabulka `UPDATE` je do dotazu přidaná mimo strom spojení ve `FROM`, takže na ni jde odkazovat ve `WHERE`, ale ne v `ON` (bez `LATERAL`). Zápis čárkou oddělenými relacemi s podmínkami ve `WHERE` je vnitřní spojení se **shodnou sémantikou i shodným plánem**, jen se dá napsat. Ověřeno proti `src/backend/parser/parse_relation.c` v PostgreSQL 18, kde ta nápověda vzniká právě při odkazu na cíl `UPDATE`.

Join na `campaigns` a `workspaces` zůstává v UPDATE jako **pojistka proti závodu**: mezi krokem 1 a krokem 2 mohl uživatel kampaň pozastavit. Pojistka je levná, protože se vyhodnocuje nad nejvýš `LIMIT` řádky, ne nad celou kampaní. Bez ní by se pozastavená kampaň dorozeslala o jednu dávku dál.

Sender prochází kampaně ze seznamu cyklicky (round robin), aby jedna velká kampaň nevyhladověla ostatní.

| Parametr | Zdroj | Výchozí |
|---|---|---|
| `$1` `claimed_by` | `SENDER_ID` | hostname + PID, max 64 znaků |
| `$2` velikost dávky | `SENDER_BATCH_SIZE` | 500 |
| `$3` TTL claimu v sekundách | `SENDER_CLAIM_TTL_SECONDS` | 300 |

Poznámky, které nejsou volitelné:

- **Nikdy `FETCH FIRST ... WITH TIES`.** PostgreSQL bug #17141 popisuje, že kombinace `WITH TIES` a `FOR UPDATE SKIP LOCKED` vrací nesprávný počet řádků. Ověřeno v původním hlášení: týká se **výhradně** `WITH TIES`, prosté `LIMIT` postižené není. Claim dotaz proto používá `LIMIT` a `WITH TIES` je v celém projektu zakázané; hlídá to lint pravidlo `migration-lint` i review.
- **Krátká dávka není chyba.** Claim může vrátit méně než `SENDER_BATCH_SIZE` řádků, a to úplně běžně: outbox dochází, nebo si jiný sender vzal zbytek. Sender musí krátkou dávku zpracovat a jít znovu, nikdy ji nesmí považovat za chybu ani z ní usuzovat, že je outbox prázdný. Prázdný outbox pozná jen z **nulového** počtu řádků.
- `FOR UPDATE OF m SKIP LOCKED` uzamyká jen `messages`, ne `campaigns` a `workspaces`. Bez `OF m` by se zamykaly i řádky kampaně a dva sendery by se navzájem blokovaly.
- Join na `campaigns` a `workspaces` je součástí kontraktu, protože je jediná ochrana proti odeslání kampaně, kterou uživatel mezitím pozastavil, nebo z projektu, který smazal. Sender proto potřebuje `SELECT` na obě tabulky.
- `ORDER BY next_attempt_at, id` dává stabilní pořadí a využívá `idx_messages__claimable`.
- Dotaz běží ve vlastní krátké transakci. Zpracování zpráv **není** v té transakci; kdyby bylo, držela by se otevřená minuty.

**Heartbeat claimu**

Sender každých `SENDER_CLAIM_TTL_SECONDS / 3` sekund prodlouží claim rozpracovaných zpráv:

```sql
UPDATE messages m
SET claim_expires_at = now() + make_interval(secs => $2), updated_at = now()
FROM unnest($3::uuid[], $4::timestamptz[]) AS k(id, created_at)
WHERE m.id = k.id AND m.created_at = k.created_at
  AND m.status = 'claimed' AND m.claimed_by = $1;
```

Heartbeat musí nést **obě složky klíče**, ne jen `id = ANY($3)`. Jednosložková varianta porušuje konvenci z 2.1 a prakticky znamená, že se prořezání partition neuplatní a heartbeat každých pár desítek sekund projde všechny partition tabulky `messages`. Dvě rovnoběžná pole rozbalená přes `unnest` jsou jediný tvar, který drží pořadí a projde přes protokol jako dva parametry.

**Reaper zaseknutých claimů**

Běží v senderu (ne v aplikaci, protože sender ví, kdo je naživu) každých 30 sekund:

```sql
UPDATE messages
SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
    claim_expires_at = NULL, next_attempt_at = now(), updated_at = now()
WHERE status = 'claimed' AND claim_expires_at < now()
  AND dispatch_started_at IS NULL
RETURNING id;
```

Podmínka `dispatch_started_at IS NULL` je klíčová: uvolní se jen zprávy, u kterých **ještě nezačalo** odesílání k providerovi. Zprávy s rozpracovaným odesláním řeší následující odstavec.

**Nejednoznačné odeslání (crash mezi providerem a zápisem)**

Toto je nejtěžší místo celého kontraktu. Sekvence u jedné zprávy:

```
D1. UPDATE ... SET attempts = attempts + 1, dispatch_started_at = now()   [commit]
D2. volání provideru (SES SendEmail nebo SMTP DATA)
D3. UPDATE ... SET status='sent', provider_message_id=..., sent_at=now(),
                   dispatch_started_at = NULL                            [commit]
```

**Kroky D1 i D3 musí ověřit, že řádek pořád patří tomuhle senderu (KONTRAKT).**

```sql
-- D1
UPDATE messages
SET attempts = attempts + 1, dispatch_started_at = now(), updated_at = now()
WHERE id = $1 AND created_at = $2
  AND status = 'claimed' AND claimed_by = $3;
```

```sql
-- D3
UPDATE messages
SET status = 'sent', provider_message_id = $4, sent_at = now(),
    dispatch_started_at = NULL, updated_at = now()
WHERE id = $1 AND created_at = $2
  AND status = 'claimed' AND claimed_by = $3;
```

Podmínka `status = 'claimed' AND claimed_by = $3` zavírá celou třídu závodů a **není optimalizace**. Bez ní může nastat tohle: sender A drží claim, jeho heartbeat se zpozdí (zátěž, pauza GC, výpadek sítě k databázi), claim vyprší, reaper zprávu uvolní na `pending` a claimne ji sender B. Sender A mezitím ožije a pokračuje krokem D1, ničeho si nevšimne a zapíše výsledek zprávy, kterou **už nevlastní**. Podle načasování buď odešle zprávu, kterou právě odesílá i B, nebo přepíše výsledek toho, kdo ji odeslal doopravdy.

Chování při nule ovlivněných řádků je normativní:

| Krok | Nula řádků znamená | Co sender udělá |
|---|---|---|
| D1 | claim mezitím ztracen | **volání provideru se neprovede**, zpráva se z lokální dávky zahodí bez zápisu, do logu jde `claim_lost` |
| D3 | claim ztracen během odesílání | zpráva **možná odešla**. Sender nezapisuje nic a zaloguje `claim_lost_after_dispatch`. Řádek drží nový vlastník a rozhodne o něm reaperem řízená logika nejednoznačného odeslání |

Kontrola počtu ovlivněných řádků po D1 a D3 je proto povinná. Sender, který návratovou hodnotu ignoruje, tuhle ochranu nemá, i když má podmínku ve `WHERE`.

Když sender zemře mezi D2 a D3, zůstane řádek se `status='claimed'`, `dispatch_started_at IS NOT NULL` a `provider_message_id IS NULL`. Nikdo neví, jestli zpráva odešla.

Řešení má dvě části:

**a) Deterministický `Message-ID`, ale jen u SMTP.** Sender vždy generuje

```
Message-ID: <oe.{base32_lower(uuid_bytes(messages.id))}@{sending_domain}>
```

Nikdy nezahrnuje číslo pokusu ani čas. Opakované odeslání téže zprávy má proto identický `Message-ID` a většina přijímajících MTA a poštovních klientů ho deduplikuje.

> **Na Amazon SES tahle pojistka neexistuje.** SES si `Message-ID` generuje sám a hlavičku dodanou odesílatelem **přepíše**, a to jak u `SendEmail`, tak u odeslání se syrovým obsahem. Dvě odeslání téže zprávy přes SES tedy dostanou **různé** `Message-ID` a žádný přijímající server je nespáruje. Deterministický `Message-ID` je proto zmírnění platné jen pro SMTP.

Tohle zjištění mění výchozí politiku, viz níže. Původní verze kontraktu o něj opírala doporučení `retry` i pro SES, což bylo chybné.

**b) Řízené rozhodnutí o nejednoznačném stavu.** Reaper má druhý dotaz:

```sql
UPDATE messages
SET ambiguous_count = ambiguous_count + 1,
    status = CASE
               WHEN $1 = 'retry' AND ambiguous_count = 0 THEN 'pending'
               ELSE 'failed'
             END,
    error_code          = 'ambiguous_dispatch',
    claimed_by          = NULL, claimed_at = NULL, claim_expires_at = NULL,
    dispatch_started_at = NULL,
    next_attempt_at     = now(),
    updated_at          = now()
WHERE status = 'claimed'
  AND claim_expires_at < now() - make_interval(secs => $2)   -- MÍNUS, viz níž
  AND dispatch_started_at IS NOT NULL
  AND provider_message_id IS NULL
RETURNING id, created_at, ambiguous_count;
```

**Znaménko je mínus, ne plus.** Přičtení by práh posunulo do **budoucnosti**, takže by dotaz zabíral víc řádků, ne míň, tedy přesně opačně, než je jeho účel. Při výchozích hodnotách by podmínka `claim_expires_at < now() + 300` byla splněná i pro claim vydaný před vteřinou, takže by **každá právě odesílaná zpráva** na nejbližším tiku reaperu dostala `ambiguous_dispatch`. Mechanismus proti duplicitám by duplicity sám vyráběl.

- Rezerva `$2` je **jeden TTL claimu navíc** oproti běžnému reaperu, takže se nejednoznačná zpráva uvolní zhruba po dvojnásobku TTL od claimu. Pomalu odpovídající provider se tím nepoplete s mrtvým senderem.

**Politika `$1` je `AMBIGUOUS_DISPATCH_POLICY` a její výchozí hodnota závisí na typu providera:**

| Provider | Výchozí | Proč |
|---|---|---|
| SES | **`fail`** | SES přepisuje `Message-ID`, takže duplikát nikdo nezachytí |
| SMTP | **`retry`** | deterministický `Message-ID` projde a přijímající servery duplikát běžně odchytí |

Zdůvodnění, které za tím stojí a patří i do UI: u nejednoznačného odeslání **nevíme**, jestli zpráva odešla. `retry` riskuje duplicitu, `fail` riskuje nedoručení. **U marketingové kampaně je duplicita horší.** Příjemce ji vidí, štve ho a zvyšuje míru stížností, a právě míra stížností je to, kvůli čemu Amazon ruší odesílací účty. Nedoručená zpráva v padesátitisícové kampani je proti tomu neviditelná a uživatel ji umí doposlat sám.

Uživatel proto musí nejednoznačné zprávy v reportu **rozeznat**: mají `error_code = 'ambiguous_dispatch'`, v UI se zobrazují jako samostatná kategorie „nejisté odeslání", ne jako běžné selhání, a jde z nich udělat publikum pro doposlání. Bez toho by rozhodnutí `fail` znamenalo tiše zahozené zprávy.

Proměnnou lze přepsat per workspace i per provider. Hodnota `retry` u SES je legitimní volba pro toho, komu vadí nedoručení víc než duplicita, ale UI u ní musí zobrazit varování o dopadu na míru stížností.

**Opakování se pozná z čítače, ne z `error_code`.** Kontraktní sloupec `ambiguous_count smallint NOT NULL DEFAULT 0` se inkrementuje při každém průchodu a rozhodnutí `pending` versus `failed` padá **v témž `UPDATE`** podle jeho hodnoty před inkrementem.

Rozpoznávat opakování podle `error_code = 'ambiguous_dispatch'` nefunguje ze dvou nezávislých důvodů. Zaprvé ho ten samý dotaz sám nastavuje, takže by po prvním průchodu byla podmínka splněná vždycky a `retry` by nikdy nenastalo. Zadruhé se `error_code` přepisuje při každém dalším selhání z jiné příčiny, takže by se historie ztratila a zpráva by mohla cyklovat donekonečna, při každém cyklu s pokusem o odeslání. Čítač je monotónní a jiná chyba ho nepřepíše.

**Chování při restartu senderu uprostřed dávky**

| Způsob ukončení | Chování |
|---|---|
| SIGTERM (graceful) | přestat claimovat, dokončit zprávy s `dispatch_started_at IS NOT NULL`, zbytek dávky jedním UPDATE zpět na `pending`, pak konec |
| SIGKILL nebo pád | nic se neuklidí; po `SENDER_CLAIM_TTL_SECONDS` je uvolní reaper (běžné zprávy) nebo po dvojnásobku (nejednoznačné) |
| Restart s jiným `SENDER_ID` | staré claimy uvolní reaper, protože ten nekontroluje `claimed_by` |
| Dva sendery naráz | funguje z definice, `SKIP LOCKED` je právě na to |

Uvolnění zbytku dávky při shutdownu:

```sql
UPDATE messages
SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
    claim_expires_at = NULL, updated_at = now()
WHERE status = 'claimed' AND claimed_by = $1 AND dispatch_started_at IS NULL;
```

**Databázová role senderu (KONTRAKT)**

**Kdo roli zakládá a kdo jí dává práva** (odpověď na dotaz z části 4b: rozdělení je nutné, ne kosmetické):

| Krok | Kde | Proč tam |
|---|---|---|
| `CREATE ROLE` | `docker/initdb/10-roles.sql` u přibalené databáze, u externí databáze dokumentovaný ruční krok | `CREATE ROLE` vyžaduje oprávnění `CREATEROLE` nebo superuživatele. Migrátor je záměrně **nemá**, protože migrace nemají umět zakládat účty. |
| `GRANT` a `REVOKE` | **migrace** v `packages/db` | Granty se vztahují k tabulkám, které migrátor vlastní, takže je udělit může. Zároveň se tím práva verzují spolu se schématem a nová tabulka nemůže zůstat bez správně nastavených práv. |

Migrace s granty je napsaná tak, aby prošla i tehdy, když role ještě neexistuje (například při testu proti prázdné databázi): obalí se do `DO $$ BEGIN ... EXCEPTION WHEN undefined_object THEN RAISE NOTICE ...; END $$;`. Bez toho by testovací prostředí bez role neprošlo migracemi.

```sql
-- Krok 1: initdb skript nebo ruční příkaz správce, NE migrace.
CREATE ROLE openengage_sender LOGIN PASSWORD :'sender_password';

-- Krok 2: migrace v packages/db.
GRANT USAGE ON SCHEMA public TO openengage_sender;

-- Sloupcové granty na messages: sender smí měnit jen to, co je jeho.
-- Bez nich by chyba v senderu mohla přepsat render_data nebo email.
GRANT SELECT ON messages TO openengage_sender;
GRANT UPDATE (status, claimed_by, claimed_at, claim_expires_at,
              dispatch_started_at, attempts, next_attempt_at,
              provider_message_id, sent_at, error_code, error_detail, updated_at)
  ON messages TO openengage_sender;
-- created_at ve výčtu SCHVÁLNĚ NENÍ, viz invariant I1.

GRANT SELECT ON campaigns TO openengage_sender;
-- Sloupcový GRANT UPDATE na campaigns: sender smí kampaň POUZE pozastavit.
-- Bez toho je pravidlo o automatické pauze při 5 % selhání renderu (4.10.2)
-- a pravidlo o SENDER_CREDENTIALS_MAX_RETRIES (3.10) neproveditelné.
GRANT UPDATE (status, pause_reason) ON campaigns TO openengage_sender;
GRANT SELECT ON sending_providers TO openengage_sender;
GRANT SELECT ON campaign_links    TO openengage_sender;
GRANT SELECT ON workspaces        TO openengage_sender;
GRANT SELECT ON suppressions      TO openengage_sender;
GRANT INSERT ON message_events    TO openengage_sender;
-- Žádná práva na contacts, web_events, users, sessions, api_keys, audit_log.
-- Sender kontakty nečte, data má v render_data.

ALTER DEFAULT PRIVILEGES FOR ROLE openengage_migrator IN SCHEMA public
  REVOKE ALL ON TABLES FROM openengage_sender;
```

`SELECT ON suppressions` je nutný, jinak je přechod `claimed → skipped` (kontrola suppression těsně před odesláním), který kontrakt sám povoluje, fyzicky neproveditelný.

**Sender smí kampaň pozastavit, nic víc (KONTRAKT).** Je to jediná zapisovací pravomoc senderu mimo `messages` a je omezená na dva sloupce. Grant je **sloupcový**, nikdy na celou tabulku: sender nesmí sáhnout na `compiled_html`, `subject` ani na nic dalšího.

Sloupec `campaigns.pause_reason` je součástí kontraktu a má typ **`jsonb`**. DDL tabulky `campaigns` vlastní část 4a, ale sloupec musí existovat a mít tenhle typ, jinak sender pozastavení neprovede:

```sql
ALTER TABLE campaigns ADD COLUMN pause_reason jsonb;
```

| Pravidlo | |
|---|---|
| Povolený přechod | **výhradně `sending → paused`**. Nic jiného, ani `queueing → paused`, ani cokoliv zpět |
| Povinný zápis | `pause_reason` musí být neprázdný objekt s klíčem `code` z uzavřeného výčtu (`render_failure_rate`, `credentials_undecryptable`, `provider_quota_exhausted`, `provider_unavailable`) |
| Odpauzování | **výhradně akce uživatele nebo aplikace.** Sender kampaň nikdy nerozjede zpět, ani když příčina pominula |
| Audit | každé automatické pozastavení zapisuje aplikace do `audit_log` jako `campaign.auto_paused` s důvodem, jakmile změnu uvidí |

```sql
UPDATE campaigns
SET status = 'paused', pause_reason = $2
WHERE id = $1 AND status = 'sending';
```

Podmínka `status = 'sending'` ve `WHERE` je součástí kontraktu, ne optimalizace: zabraňuje tomu, aby sender přepsal stav kampaně, kterou mezitím uživatel zrušil nebo dokončil. Nula ovlivněných řádků není chyba, znamená to, že kampaň už není v odesílacím stavu.

Asymetrie „sender smí zastavit, ale ne rozjet" je záměrná. Zastavení je bezpečná operace, kterou musí umět provést ten, kdo problém vidí. Rozjetí je rozhodnutí, které vyžaduje, aby si člověk příčinu prohlédl.

Sender **nemá** `DELETE` nikde a nemá `INSERT` do `messages`. Nová partition je pro něj neviditelná, dokud ji migrátor nezaloží a nepřidělí granty; to dělá `createMonthlyPartitions` automaticky.

**Sender a RLS (KONTRAKT).** Tvrzení „sender nepodléhá RLS" bez mechanismu je nefunkční: role `openengage_sender` nemá `BYPASSRLS` a nikdy nevolá `set_config('openengage.workspace_id')`, protože pracuje napříč projekty. `current_setting(..., true)` proto vrátí NULL, politika `ws_isolation` nepustí nic a claim dotaz by vracel **nula řádků vždy**.

Řešení je permisivní politika vedle `ws_isolation` na **každé** tabulce, kterou sender čte nebo do níž zapisuje. Politiky se v PostgreSQL OR-ují, takže `ws_isolation` zůstává pro `openengage_app` nedotčená:

```sql
CREATE POLICY sender_bypass ON messages          TO openengage_sender USING (true) WITH CHECK (true);
CREATE POLICY sender_bypass ON campaigns         TO openengage_sender USING (true);
CREATE POLICY sender_bypass ON sending_providers TO openengage_sender USING (true);
CREATE POLICY sender_bypass ON campaign_links    TO openengage_sender USING (true);
CREATE POLICY sender_bypass ON workspaces        TO openengage_sender USING (true);
CREATE POLICY sender_bypass ON suppressions      TO openengage_sender USING (true);
CREATE POLICY sender_bypass ON message_events    TO openengage_sender WITH CHECK (true);
```

Varianta `ALTER ROLE openengage_sender BYPASSRLS` je hrubší (platí na všechno včetně tabulek, na které sender nemá mít přístup) a vyžaduje superuživatele, takže patří do `docker/initdb`, ne do migrace. Nepoužíváme ji.

**Testy z tabulky scénářů musí běžet pod rolí `openengage_sender`, ne pod migrátorem.** Tohle je na celém nálezu to nejcennější: kdyby scénáře `OB-01` až `OB-13` běžely pod migrátorem, prošly by a chybu by zamaskovaly. Chyba nebyla jen v návrhu, ale i v testu, který ji měl odhalit. Test harness proto otevírá spojení pod `DATABASE_URL_SENDER` a v CI se ověřuje, že se pod migrátorem nespouští.

**Kontraktní podmnožiny cizích tabulek.** Pravidlo: **co má sender v grantu, to musí být v kontraktu.** Jinak má sender povinnost číst nebo zapisovat tabulku, jejíž sloupce se můžou změnit bez porušení kontraktu.

| Tabulka | Vlastník | Kontraktní sloupce, které sender potřebuje |
|---|---|---|
| `campaigns` | část 4a | `id`, `workspace_id`, `status`, `pause_reason`, `scheduled_at`, `audience_built_at`, `provider_id`, `compiled_html`, `compiled_text`, `subject`, `preheader`, `from_name`, `from_email`, `reply_to`, `track_opens`, `track_clicks`, `deleted_at` |
| `sending_providers` | část 4a | `id`, `workspace_id`, `type`, `config_encrypted`, `quota_max_send_rate`, `verified_at` |
| `campaign_links` | část 4a | `id`, `campaign_id`, `url`, `position` |
| `workspaces` | část 1 | `id`, `deleted_at` |
| `suppressions` | část 2 | `workspace_id`, `email` (nebo otisk podle 3.10), `created_at` |
| `message_events` | část 4a | `id`, `message_id`, `message_created_at`, `workspace_id`, `type`, `ts`, `received_at`, `source`, `metadata` |

Vlastník smí tabulku rozšiřovat, nesmí měnit název, typ ani sémantiku vyjmenovaných sloupců. Shodu hlídá CI job `contracts-schema` dotazem do `information_schema.columns`.

**Testovací scénáře (`fixtures/outbox/scenarios.json`, spouští se proti reálnému Postgresu na obou stranách)**

| ID | Scénář | Očekávaný výsledek |
|---|---|---|
| **`OB-00`** | **Spustit každý normativní dotaz z tohoto kontraktu proti čerstvě zmigrované databázi. Netvrdí nic o výsledku, jen že dotaz projde parserem a plánovačem.** Běží **první ze všech** | žádná chyba. Prázdný výsledek je v pořádku |
| `OB-01` | dva sendery, 1 000 zpráv, dávka 500 | každá zpráva claimnutá právě jednou, žádné čekání |
| `OB-02` | claim, pak SIGKILL, pak reaper po TTL | zprávy zpět na `pending`, `attempts` nezměněné |
| `OB-03` | claim, `dispatch_started_at` nastavené, SIGKILL, reaper po 2×TTL, politika `retry` | `pending`, `error_code = 'ambiguous_dispatch'`, `attempts = 1` |
| `OB-04` | totéž, druhý výskyt | `failed`, bez ohledu na politiku |
| `OB-05` | kampaň přepnutá na `paused` uprostřed | claim dotaz vrací 0 řádků do obnovení |
| `OB-06` | workspace měkce smazaný | claim dotaz vrací 0 řádků |
| `OB-07` | pokus o `UPDATE ... SET status='sent'` z `pending` | odmítnuto aplikační kontrolou, test na zakázaný přechod |
| `OB-08` | sender se pokusí `DELETE FROM messages` | chyba oprávnění z Postgresu |
| `OB-09` | sender se pokusí `SELECT * FROM contacts` | chyba oprávnění z Postgresu |
| `OB-10` | graceful shutdown uprostřed dávky 500 | rozpracované dokončené, zbytek `pending`, žádná ztráta |
| `OB-11` | `Message-ID` u dvou pokusů téže zprávy | identický řetězec |
| `OB-12` | **Pozastavená kampaň s 200 000 řádky `pending` vedle běžící kampaně s 1 000 řádky.** Claim běžící kampaně | vrátí dávku do **10 ms**. Bez dvoukrokového claimu a bez `campaign_id` v indexu trvá sekundy. Tenhle scénář je jediná ochrana proti tomu, aby se patologie vrátila |
| `OB-13` | Materializace 1 000 zpráv ve dvou dávkách po 500 | všech 1 000 řádků má **identické** `created_at` rovné `campaigns.audience_built_at` a to má nulovou sub-sekundovou složku (invariant I1) |
| `OB-14` | Zrušení kampaně s 500 `pending` a 50 `claimed` | 500 přejde na `skipped`, **žádný na `failed`**, 50 `claimed` doběhne do `sent` nebo `failed` |
| `OB-15` | Pozdní bounce k už `sent` zprávě | `messages.status` zůstane `sent`, vznikne řádek v `message_events`, report ji nepočítá jako doručenou |
| `OB-16` | Sender pozastaví kampaň (`sending → paused` s `pause_reason`) | uspěje. Tentýž UPDATE na kampani ve stavu `paused` nebo `cancelled` ovlivní **0 řádků** a není to chyba |
| `OB-17` | Sender se pokusí o `paused → sending` nebo o změnu jiného sloupce `campaigns` | chyba oprávnění z Postgresu (sloupcový grant) nebo 0 řádků (podmínka ve `WHERE`) |
| `OB-18` | Claim nad kampaní s `deleted_at IS NOT NULL` ve stavu `sending` | vrátí 0 řádků v kroku 1 i v kroku 2 |
| `OB-19` | Sender A drží claim, reaper ho uvolní, claimne sender B, **teprve pak** se A pokusí o D1 | D1 ovlivní 0 řádků, **A neodešle nic** a zprávu z dávky zahodí. Odešle ji jen B. Bez stráže v D1 se odešle dvakrát |
| `OB-20` | Totéž, ale A se dostane až k D3 (zpráva už u providera) | D3 ovlivní 0 řádků, A nezapisuje nic a loguje `claim_lost_after_dispatch`. O řádku rozhodne nový vlastník, výsledek je `sent` nebo `ambiguous_dispatch`, **nikdy dvojí zápis `sent` s různým `provider_message_id`** |
| `OB-21` | Zpráva ve stavu `failed` s `error_code = 'ambiguous_dispatch'`, aplikace zpracuje událost od providera a přepne ji na `sent` | přechod **uspěje**, doplní se `provider_message_id` a `sent_at` |
| `OB-22` | Tentýž přechod `failed → sent` u zprávy s jiným `error_code` (například `render_failure`, `provider_rejected`) i s `error_code IS NULL` | přechod **musí selhat** ve všech případech. Test běží pro každou hodnotu zvlášť, aby neprošel omylem na prázdné množině |

**Všechny scénáře běží pod rolí `openengage_sender`.** Spuštění pod migrátorem je v CI chyba, protože zamaskuje chybějící politiku `sender_bypass`.

#### `OB-00` a proč je z celého seznamu nejdůležitější

`OB-00` je jediný scénář, který **netestuje chování**. Vezme každý normativní SQL dotaz z tohoto kontraktu, spustí ho proti čerstvě zmigrované databázi s prázdnými tabulkami a ověří jedinou věc: že neskončí chybou. Prázdný výsledek je úspěch.

Zní to triviálně. Přesto by právě on odhalil obě chyby, které tenhle kontrakt v jednom vydání obsahoval: neplatný odkaz na cíl `UPDATE` v klauzuli `ON` a obrácené znaménko u reaperu (to druhé sice ne jako chybu, ale při naplněné tabulce okamžitě jako nesmyslný počet zasažených řádků). Obojí prošlo dvěma koly revize, protože se ověřovalo **čtením**, a čtení neumí zjistit, jestli je SQL platné.

**Tohle je potřetí, co narážíme na tentýž vzorec, a proto to píšu sem, ne do poznámky.**

| # | Ochrana existovala | Nic ji nevynucovalo | Následek |
|---|---|---|---|
| 1 | „sender nepodléhá RLS" | scénáře neurčovaly databázovou roli, testy by běžely pod migrátorem | claim by v produkci vracel nula řádků, testy zelené |
| 2 | stráž `claimed_by` v dispatch UPDATE | nebylo napsáno, že se **musí** kontrolovat počet ovlivněných řádků | sender ignorující návratovou hodnotu nemá ochranu, i když má predikát |
| 3 | normativní SQL v kontraktu | nikdo ho nikdy nespustil | centrální dotaz produktu se nespustí, zjištěno až třetím čtenářem |

Společný jmenovatel: **specifikace popisovala žádoucí stav, ale nepojmenovala mechanismus, který ho vynutí.** Pravidlo, které z toho plyne a platí pro všechny části:

> Ke každé ochraně v tomhle dokumentu musí existovat konkrétní mechanismus, který její porušení **zachytí automaticky**: test, lint, databázové oprávnění nebo constraint. Ochrana, jejíž jediné vynucení je „implementátor si to přečte", není ochrana, ale přání. Když takový mechanismus nejde vymyslet, patří to do dokumentu jako přiznané riziko, ne jako vyřešená věc.

`OB-00` je ten mechanismus pro SQL v kontraktu. Je levný, běží první a spadne dřív, než se pustí cokoliv, co by jeho selhání zamaskovalo delším výpisem.

**Jmenný prostor `messages.error_code` (KONTRAKT).** Je to **oddělený uzavřený výčet**, nemá nic společného s katalogem HTTP chybových kódů ze 4.2. Dnes do něj zapisují tři části a nevlastní ho nikdo, proto ho zavádím tady. Registr je `packages/contracts/src/outbox-errors.ts`, hodnota mimo výčet je v CI chyba.

| Hodnota | Kdo zapisuje | Význam |
|---|---|---|
| `ambiguous_dispatch` | sender | pád mezi voláním provideru a zápisem výsledku |
| `render_failed` | sender | šablona za běhu selhala |
| `render_timeout` | sender | render překročil 50 ms |
| `provider_rejected` | sender | provider zprávu trvale odmítl |
| `provider_unavailable` | sender | opakovatelná chyba providera po vyčerpání pokusů |
| `credentials_undecryptable` | sender | konfiguraci provideru nešlo dešifrovat, viz 3.10 |
| `invalid_recipient` | sender nebo aplikace | adresa neprošla validací |
| `suppressed` | aplikace nebo sender | příjemce na suppression listu |
| `unsubscribed` | aplikace | příjemce se mezitím odhlásil |
| `campaign_cancelled` | aplikace | zrušení kampaně |

Nový kód přidává vlastník příslušné části a musí ho zaregistrovat, stejně jako u HTTP kódů.

---

#### 4.10.2 Kontrakt 2: Liquid subset

**Zásadní rozhodnutí: vlastní filtry na obou stranách.** LiquidJS 10.27.2 a `osteele/liquid` v1.8.1 sdílejí tvar jazyka, ale ne implementaci filtrů. Proto **nepoužíváme ani jeden vestavěný filtr**. Obě strany registrují pět vlastních filtrů se stejnou definicí. Knihovny nám dávají tokenizer, parser a řízení toku, nic víc. Tím se plocha rozporu smrskne na věci, které jsou v Shopify Liquid dobře definované a obě knihovny je implementují shodně.

**Konkrétní rozdíly, které tímhle rozhodnutím mizí** (průzkum části 4b, ověřeno k 2026-07-31):

| Rozdíl | Kde by kousl | Proč nás už netrápí |
|---|---|---|
| `default` v Go vždy přepíše `false`, LiquidJS má volbu `allow_false` | `{% if %}` nad boolean polem | filtr je náš, definice v tabulce níž je jediná platná; shodou okolností odpovídá chování Go |
| `date` bere v Go zónu serveru, v LiquidJS zónu prohlížeče | úplně jiný čas v náhledu a v odeslaném e-mailu | filtr je náš a zóna se bere výhradně z `render_data._context.timezone` |
| `osteele/liquid` nepodporuje **pojmenované** parametry filtrů | `{{ x \| truncate: length: 10 }}` | gramatika povoluje jen **poziční** argument (`default: "kolego"`, `date: "%d.%m.%Y"`), pojmenované nikde nejsou |
| V Go chybí `where`, `find`, `group_by`, `sum`, `reject`, `date_to_*` | šablona funguje v náhledu a spadne při odeslání | žádný z nich není v povolené pětici; validátor je odmítne už v editoru |
| `escape` produkuje v obou shodné entity | | přesto ho definujeme sami, viz odstavec o escapování |

**Povinná konfigurace knihoven** (bez ní kontrakt neplatí):

- LiquidJS se instancuje s `jsTruthy: false` (výchozí hodnota). Se zapnutým `jsTruthy` se pravdivost rozejde s Go, protože prázdný řetězec a nula začnou být nepravdivé. Kontrola je součástí testu `LQ-3xx`.
- LiquidJS se instancuje se `strictFilters: true` a `strictVariables: false`. Neznámý filtr má být chyba (chytí ho validátor), neznámá proměnná má být prázdný řetězec (bod 1 níže).
- Obě strany registrují pětici filtrů **před** prvním renderem a žádná strana neregistruje nic navíc.

**Povolená gramatika (úplná)**

```
template     := (text | output | tag)*
output       := "{{" ws expr ws "}}"
expr         := path (ws "|" ws filter)*
path         := ident ("." ident)*                 // nejvýš 3 segmenty
filter       := "default" ":" ws literal
              | "upcase" | "downcase"
              | "date" ":" ws string_literal
              | "escape"
tag          := if_tag | unless_tag | for_tag
if_tag       := "{%" ws "if" ws cond ws "%}" template
                ("{%" ws "elsif" ws cond ws "%}" template)*
                ("{%" ws "else" ws "%}" template)?
                "{%" ws "endif" ws "%}"
unless_tag   := "{%" ws "unless" ws cond ws "%}" template
                ("{%" ws "else" ws "%}" template)? "{%" ws "endunless" ws "%}"
for_tag      := "{%" ws "for" ws ident ws "in" ws path ws "%}" template
                "{%" ws "endfor" ws "%}"
cond         := operand (ws op ws operand)? (ws ("and"|"or") ws cond)?
op           := "==" | "!=" | ">" | "<" | ">=" | "<="
operand      := path | literal
literal      := string_literal | number | "true" | "false" | "nil" | "blank" | "empty"
string_literal := '"' [^"]* '"' | "'" [^']* "'"
ident        := [a-z_][a-z0-9_]*
```

**Zakázané a proč**

| Konstrukce | Důvod |
|---|---|
| `{{-` a `-}}` (whitespace control) | knihovny se v ořezávání okrajových případů liší |
| `{% assign %}`, `{% capture %}`, `{% increment %}` | proměnné v šabloně znamenají stav a nepředvídatelný výstup |
| `{% include %}`, `{% render %}`, `{% layout %}` | čtení souborů ze senderu, bezpečnostní riziko |
| `{% case %}` | jde vyjádřit přes `if`/`elsif`, méně plochy pro rozpor |
| `{% cycle %}`, `{% tablerow %}` | v e-mailu nepotřebné |
| `{% raw %}` | jeho chování při vnořování se liší |
| `{% comment %}` | v e-mailu není potřeba; komentář patří do editoru, ne do šablony |
| jakýkoliv jiný filtr | není v kontraktu |
| `contains` | v Shopify Liquid pracuje jinak nad řetězcem a nad polem; zbytečné riziko |
| závorky v podmínkách | Liquid je nepodporuje, ale uživatel je zkusí; validátor musí dát srozumitelnou hlášku |
| vnořený `for` | složitost bez užitku, v e-mailu jedna úroveň stačí |
| `for` s `limit`, `offset`, `reversed`, `forloop.*` | zúžení plochy; iterační proměnná je jen prvek |
| indexování `pole[0]`, `hash["klíč"]` | dvě notace pro totéž, každá knihovna jinak u chybějícího klíče |

**Limity**

| Limit | Hodnota | Chování |
|---|---|---|
| hloubka vnoření `if` a `unless` | 3 | validátor odmítne, `liquid_nesting_too_deep` |
| počet `for` cyklů v šabloně | 5 | `liquid_too_many_loops` |
| iterací v jednom `for` | 200 | při renderu se cyklus ukončí a zapíše se varování do `message_events` |
| segmentů v cestě | 3 | `liquid_path_too_deep` |
| délka šablony | 512 kB | `liquid_template_too_large` |
| počet výstupních výrazů | 500 | `liquid_too_many_outputs` |
| doba renderu jedné zprávy | 50 ms | přerušení, zpráva na `failed` s `render_timeout` |

**Sémantika, ve které se knihovny musí shodnout (normativní)**

1. **Chybějící proměnná** se vyhodnotí jako `nil` a vypíše se jako prázdný řetězec. Nikdy chyba, nikdy `null` v textu. Platí i pro cestu, jejíž prostřední segment neexistuje (`contact.address.city`, když `address` chybí).
2. **Pravdivost:** falešné jsou **jen** `false` a `nil`. Prázdný řetězec, `0`, prázdné pole a `"false"` jsou pravdivé. To je Shopify sémantika a obě knihovny ji mají.
3. **Porovnání různých typů** (`{% if contact.age > "10" %}`) se vyhodnotí jako `false`, nikdy jako chyba. Validátor na to navíc dá varování.
4. **`blank` a `empty`** se porovnávají jen operátory `==` a `!=`. `x == blank` je pravda pro `nil`, `""`, `"   "`, `[]`, `{}`.
5. **Řazení a rovnost řetězců** je bajtové porovnání UTF-8, žádná lokalizovaná kolace.
6. **Výstup čísel:** celá čísla bez desetinné části, desetinná s tečkou a bez koncových nul. `1` je `1`, `1.5` je `1.5`, `1.50` je `1.5`. Formátování podle jazyka dělá aplikace při materializaci, ne sender.
7. **Výstup boolean:** `true` a `false` jako anglická slova malými písmeny.
8. **Výstup pole:** prvky spojené bez oddělovače (Shopify sémantika). V praxi se v šablonách nemá objevit; validátor na to dá varování.

**Pět filtrů (normativní definice)**

| Filtr | Signatura | Chování |
|---|---|---|
| `default` | `default: <literal>` | Vrátí argument, když je hodnota `nil`, `false`, `""` nebo prázdné pole. Jinak hodnotu. Argument musí být literál, ne cesta. |
| `upcase` | bez argumentu | Unicode velká písmena podle "simple uppercase mapping" (bez speciálních pravidel pro turečtinu). `ž` → `Ž`. |
| `downcase` | bez argumentu | totéž opačně |
| `date` | `date: "<formát z whitelistu>"` | viz níže |
| `escape` | bez argumentu | v HTML kontextu **no-op** (viz níže), v textovém kontextu také no-op |

**Filtr `date`.** Vstup: řetězec RFC 3339 s explicitní zónou, celé číslo (unix sekundy), nebo `"now"`. Cokoliv jiného → prázdný řetězec. Časová zóna výstupu se bere z `render_data._context.timezone`, chybí-li, `UTC`.

Povolené formáty (whitelist, cokoliv jiného je chyba validátoru `liquid_date_format_not_allowed`):

| Formát | Výstup pro `2026-08-01T12:40:00Z` v `Europe/Prague` |
|---|---|
| `%d.%m.%Y` | `01.08.2026` |
| `%-d.%-m.%Y` | `1.8.2026` |
| `%Y-%m-%d` | `2026-08-01` |
| `%d.%m.%Y %H:%M` | `01.08.2026 14:40` |
| `%H:%M` | `14:40` |

Whitelist je krátký schválně. Názvy měsíců a dnů by znamenaly lokalizační data v senderu, a to je přesně to, čemu se vyhýbáme (viz kapitola 6.3 hlavní specifikace o vokativu, stejný princip). Kdo potřebuje "1. srpna 2026", nechá si datum naformátovat aplikací do `render_data`.

**Escapování a HTML kontext.** Toto je bod, kde se kontrakt liší od výchozího chování Liquidu, a proto musí být napsaný nahlas:

- V **HTML části** zprávy se výstup **každého** `{{ }}` po aplikaci filtrů automaticky HTML-escapuje. Escapování je pevně dané: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&#39;`. Nic jiného se nemění.
- V **textové části** se neescapuje nic.
- Filtr `escape` je proto v obou kontextech **no-op**. Zůstává v povolené sadě, aby seděl výčet z kapitoly 4.5 hlavní specifikace a aby šablony zkopírované odjinud nepadaly. Validátor na něj dá informační hlášku "escape není potřeba, hodnoty se escapují automaticky". Detailní zdůvodnění je v sekci 11, rozpor R2.
- Automatické escapování se vypnout nedá. Merge tag, který má vložit HTML, v kontraktu neexistuje. HTML se vkládá blokem "HTML" v editoru, tedy při kompilaci šablony, ne při interpolaci.

**Jmenný prostor proměnných (KONVENCE, vlastní části 2 a 3)**

Kořenové proměnné, které sender zaručeně najde v `render_data`:

```
contact.<pole>            pole kontaktu první třídy (část 2 definuje výčet)
contact.attr.<key>        vlastní pole kontaktu, katalog vlastní část 2
campaign.name             campaign.subject
workspace.name            workspace.sender_address
unsubscribe_url           one_click_unsubscribe_url
preferences_url           webview_url
_context.timezone         _context.locale     (interní, validátor je v šabloně zakáže)
```

**`contact.attr.<key>` je závazný tvar pro vlastní pole**, ne `contact.custom.<key>` ani `contact.<key>` naplocho. Naplocho by hrozila kolize vlastního pole s polem první třídy (uživatel si založí vlastní pole `email`), `attr` je kratší než `custom` a je to jediný povolený tvar. Katalog klíčů vlastní část 2 a validátor proti němu kontroluje existenci.

**`workspace.sender_address`** je text, může být víceřádkový, a nese fyzickou adresu odesílatele. U komerčního e-mailu je identifikace odesílatele včetně adresy právní požadavek, takže patička ji potřebuje. Bez ní by ji autoři šablon vkládali jako konstantu při kompilaci a po stěhování firmy by se nepromítla do už uložených šablon.

Validátor odmítne cestu, jejíž kořen není v tomto seznamu (`liquid_unknown_root`), a cestu pod `contact.`, která neodpovídá existujícímu poli projektu (`liquid_unknown_field`). Kompilace zároveň **vyextrahuje seznam použitých cest**, což je vstup pro `render_data` snapshot podle kapitoly 5 hlavní specifikace.

**Chování za běhu při chybě.** Šablona prošla validací, přesto může za běhu nastat problém. Politika je pevná:

| Situace | Chování |
|---|---|
| Chybějící hodnota v `render_data` | prázdný řetězec, zpráva se odešle, do `message_events` se zapíše `render_warning` s cestou |
| Cyklus přes ne-pole | cyklus se neprovede, `render_warning` |
| Překročení 200 iterací | cyklus se ukončí, `render_warning` |
| Syntaktická chyba (nemělo by nastat, šablona je předvalidovaná) | zpráva na `failed` s `error_code = 'render_failed'`, kampaň **se nezastaví** |
| Překročení 50 ms | zpráva na `failed` s `render_timeout` |
| Podíl `failed` z důvodu renderu přesáhne 5 % z prvních 1 000 zpráv | kampaň se automaticky pozastaví (`paused`) a uživatel dostane upozornění |

Poslední řádek je pojistka proti tomu, aby se odeslalo 100 000 rozbitých e-mailů. Konkrétní práh a UI vlastní část 4.

**Golden fixtures**

Formát jednoho souboru (`fixtures/liquid/<id>.json`), validovaný JSON schématem:

```json
{
  "id": "LQ-014",
  "description": "default filtr na prázdném řetězci",
  "context": "html",
  "template": "Dobrý den, {{ contact.first_name | default: \"kolego\" }}!",
  "data": { "contact": { "first_name": "" }, "_context": { "timezone": "Europe/Prague" } },
  "expected": "Dobrý den, kolego!"
}
```

Nebo, u případů, které mají selhat už ve validátoru:

```json
{
  "id": "LQ-051",
  "description": "zakázaný filtr",
  "template": "{{ contact.first_name | vocative }}",
  "expect_validation_error": { "code": "liquid_filter_not_allowed", "hint_contains": "first_name_vocative" }
}
```

Minimálně **40 fixtures** podle kapitoly 4.5 hlavní specifikace, rozdělených takto:

| Skupina | Počet | Co pokrývá |
|---|---|---|
| `LQ-0xx` výstup a cesty | 8 | prostá proměnná, vnořená cesta, chybějící mezičlen, chybějící kořen, escapování v HTML i textu |
| `LQ-1xx` filtry | 10 | každý filtr, řetězení, `default` na `nil`, `false`, `""`, `[]`, `0` (pozor: `0` **není** prázdné) |
| `LQ-2xx` `date` | 6 | všech pět formátů plus neplatný vstup |
| `LQ-3xx` podmínky | 8 | pravdivost `""`, `0`, `false`, `nil`, porovnání typů, `and`/`or`, `blank`, `empty` |
| `LQ-4xx` cykly | 4 | prázdné pole, jeden prvek, limit 200, cyklus přes ne-pole |
| `LQ-5xx` odmítnutí validátorem | 10 | každá zakázaná konstrukce z tabulky výše |
| `LQ-6xx` diakritika a Unicode | 4 | `upcase` nad `ěščřžýáíé`, emoji, kombinující znaky, dlouhé UTF-8 |

**Jak to pouští CI** (job `contracts-golden`, blokující):

```
1. pnpm vitest run packages/contracts/test/liquid.golden.test.ts
   Načte všechny fixtures/liquid/*.json, pustí je přes LiquidJS s našimi filtry.
2. go test ./internal/contracts -run TestLiquidGolden
   Načte tytéž soubory z testdata/, pustí je přes osteele/liquid s našimi filtry.
3. Oba testy porovnávají výstup s "expected" bajt po bajtu (žádná normalizace mezer).
4. Test "no orphan fixtures": obě strany musí zpracovat stejný počet souborů.
   Fixture, kterou umí jen jedna strana, je chyba.
5. Test "coverage": každý kód z tabulky zakázaných konstrukcí musí mít
   alespoň jednu fixture. Nová zakázaná konstrukce bez fixture spadne.
```

Bod 4 je ten, který skutečně zabraňuje rozchodu dialektů. Bez něj by se jedna strana mohla tiše vyhnout nepohodlné fixture.

---

#### 4.10.3 Kontrakt 3: Formát trackovacích tokenů

**Sender tokeny vyrábí, aplikace je ověřuje.** Musí sedět bajt na bajt.

**Struktura**

```
token        = "t1" || base64url_nopad( type || key_id || payload || mac )
type         = 1 bajt, ASCII znak
key_id       = 1 bajt, unsigned, 1 až 255
payload      = binární, velký endián, pevná délka podle typu
mac          = prvních 16 bajtů z HMAC-SHA256
mac_input    = "openengage/token/v1" || type || key_id || payload
mac_key      = HKDF(SHA-256, MASTER, "openengage/v1", "openengage/v1/tracking-token", 32)
```

`"t1"` je čitelný prefix pro rozpoznání a pro budoucí `t2`. Base64url je RFC 4648 §5 **bez paddingu**, s abecedou `A-Za-z0-9-_`.

**Typy a payloady**

| Typ | Znak | Payload (pořadí je závazné) | Délka payloadu | Délka tokenu |
|---|---|---|---|---|
| open | `o` | `workspace_id`(16) `message_id`(16) `message_created_at`(u32) | 36 | 74 znaků |
| click | `c` | `workspace_id`(16) `message_id`(16) `link_id`(16) `message_created_at`(u32) | 52 | 96 znaků |
| identity | `i` | `workspace_id`(16) `contact_id`(16) `campaign_id`(16) `nonce`(8) `expires_at`(u32) | 60 | 106 znaků |
| unsubscribe | `u` | `workspace_id`(16) `message_id`(16) `contact_id`(16) `list_id`(16) `message_created_at`(u32) | 68 | 117 znaků |

**Proč `message_created_at` a ne `issued_at`.** `messages` má dvousložkový primární klíč `(id, created_at)`, protože je partitionovaná. Token, který nese jen `message_id`, tedy neumožňuje zprávu dohledat jinak než prohledáním všech partition. Původní verze kontraktu nesla `issued_at` (čas vydání tokenu) a ten problém neřešil: kampaň materializovaná 31. srpna a odeslaná 1. září má obě hodnoty v jiném měsíci, tedy v jiné partition.

`issued_at` je zároveň redundantní. Jakmile se zpráva dohledá, je na řádku `sent_at`, což je pro posouzení stáří kliku lepší zdroj. Nahrazením se tedy nic neztrácí a **délka tokenu se nemění ani o znak**.

**Přesnost vychází díky invariantu z 4.10.1.** `created_at` je `timestamptz` s mikrosekundovou přesností, `uint32` sekundy by ho usekly a shoda na primárním klíči by nesedla. Invariant „všechny zprávy jedné kampaně mají `created_at` rovné `campaigns.audience_built_at`, které se ukládá zaokrouhlené na celé sekundy" dělá z `uint32` **přesnou** hodnotu, ne aproximaci. Dohledání je pak `WHERE id = $1 AND created_at = to_timestamp($2)`, tedy přímý zásah do primárního klíče jedné partition.

**Neprozrazuje nic o příjemci.** `message_created_at` je čas materializace publika, tedy jedna hodnota společná všem příjemcům kampaně. O konkrétním příjemci neříká nic a hlavička `Date` v tomtéž e-mailu prozradí totéž přesněji. Pole je uvnitř MAC vstupu, takže ho nejde změnit.

- UUID se kóduje jako 16 bajtů v pořadí podle RFC 9562 (síťové pořadí, tedy `hex` bez pomlček přečtený zleva).
- `message_created_at` a `expires_at` jsou unixové sekundy jako `uint32` big endian. Přetečou v roce 2106, což je pro tento produkt přijatelné a je to zapsané.
- `nonce` u identity tokenu je 8 náhodných bajtů z CSPRNG. Slouží k jednorázovosti (část 5 si drží použité nonce).
- `list_id` samých nul (`00000000-0000-0000-0000-000000000000`) znamená globální odhlášení, ne odhlášení ze seznamu.
- **`link_id` zůstává UUID, nezkracuje se na `campaign_links.position`.** Návrh nahradit ho dvoubajtovým pořadím (token by se zkrátil z 96 na 77 znaků) je **zamítnutý**. Devatenáct znaků v odkazu, který nikdo neopisuje ručně, je bezcenná úspora, zatímco `position` je nestabilní: jakákoliv operace, která překompiluje šablonu a přečísluje odkazy, by zneplatnila všechny už odeslané tokeny, aniž by to bylo poznat. Navíc `position` není globálně unikátní, takže by rozklíčování vyžadovalo nejdřív dohledat zprávu, tedy přesně tu závislost, kterou pole `message_created_at` odstraňuje. Kdyby byla délka odkazu skutečný problém, správná páka je kratší hodnota `TRACKING_DOMAIN`.
- **Token nikdy neobsahuje e-mailovou adresu ani nic čitelného.** Je to požadavek z kapitoly 4.4 hlavní specifikace.

**Ověření (normativní pořadí kroků)**

```
1. Řetězec začíná "t1"? Jinak neplatný.
2. base64url dekódování zbytku. Chyba => neplatný.
3. Délka odpovídá známému typu? Jinak neplatný.
4. type odpovídá endpointu, na kterém token přišel? Jinak neplatný.
   (Token typu 'o' nesmí projít na /t/c a naopak.)
5. key_id je známý (SECRET_KEY nebo některý ze SECRET_KEY_PREVIOUS)? Jinak neplatný.
6. Přepočítej mac a porovnej v konstantním čase (crypto.timingSafeEqual /
   hmac.Equal). Nesouhlas => neplatný.
7. Až teď se hodnoty z payloadu použijí. Nikdy dřív.
8. U typu 'i' navíc: expires_at > now() a nonce nebyl použit.
```

Krok 4 je snadné vynechat a je to zranitelnost: bez něj by šel token pro otevření podstrčit jako token pro odhlášení. Proto je typ v MAC vstupu a proto se kontroluje proti endpointu.

**Platnost**

| Typ | Platnost | Důvod |
|---|---|---|
| open, click, unsubscribe | **neomezená** | e-mail leží ve schránce roky, odkaz musí fungovat |
| identity | 15 minut a jednorázově | přenáší identitu, krátká platnost je celý smysl |

`message_created_at` se proti expiraci nekontroluje **nikdy**, je to lokátor partition, ne časové omezení platnosti. Stáří kliku se posuzuje z `messages.sent_at` na dohledaném řádku, a je to přesnější zdroj než cokoliv v tokenu.

**Testovací vektory (závazné, ověřeno spuštěním; klíč je testovací `SECRET_KEY` z 3.10, `key_id = 1`)**

```
workspace_id = 0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071
message_id   = 0192f3a0-1c2d-7e41-8b2c-3d4e5f607182
link_id      = 0192f3a0-1c2d-7e42-9c3d-4e5f60718293
contact_id   = 0192f3a0-1c2d-7e43-8d4e-5f60718293a4
campaign_id  = 0192f3a0-1c2d-7e44-9e5f-60718293a4b5
list_id      = 0192f3a0-1c2d-7e45-8f60-718293a4b5c6
message_created_at = 1784995200      (2026-07-25T16:00:00Z, = campaigns.audience_built_at)
expires_at   = 1785000600
nonce        = 0011223344556677
```

| Typ | Token |
|---|---|
| open | `t1bwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2Bxgmpk3YCVNgR__t5nFa1z5_Wn6r8V` |
| click | `t1YwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5CnD1OX2BxgpNqZN2AdHpw8pB-jc8TeaF-MsQGQA` |
| identity | `t1aQEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkONTl9gcYKTpAGS86AcLX5Enl9gcYKTpLUAESIzRFVmd2pk8piofVi4fkHZTjcDdmtUI_Pt` |
| unsubscribe | `t1dQEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5DjU5fYHGCk6QBkvOgHC1-RY9gcYKTpLXGamTdgHKvx5wpOM1WbVJMo8EGV48` |
| unsubscribe (globální, `list_id` = samé nuly) | `t1dQEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5DjU5fYHGCk6QAAAAAAAAAAAAAAAAAAAAAamTdgCYnjHQicEmTYRaa1jo79Zg` |

Plné HMAC-SHA256 před zkrácením (pro ladění implementace):

```
open   9536047ffede6715ad73e7f5a7eabf158c6480b2aab5ba1260645b79d1a33a75
click  747a70f2907e8dcf1379a17e32c406409aafe9290c963fc2a025bc1bfa707bd1
ident  a87d58b87e41d94e3703766b5423f3ed1b49795d2ac33868e06a8ce39b58cac2
unsub  72afc79c2938cd566d524ca3c106578f3c34b935be1023b5e47c8d15c461e540
```

Identity token se oproti předchozí verzi kontraktu **nezměnil**, protože `message_created_at` nenese. Ostatní tři ano. Kdo implementoval proti staré verzi, pozná to na prvním vektoru.

Odvozený klíč pro kontrolu: `K_tracking-token = 4a60b23f5ad33af512e8a70f9f09b43a37ef1909894df07295067f24d05bf6ca`.

**Negativní vektory (musí být odmítnuté oběma stranami)**

| ID | Vstup | Očekávaná chyba |
|---|---|---|
| `TK-N1` | token bez prefixu `t1` | `token_malformed` |
| `TK-N2` | poslední znak změněný | `token_signature_invalid` |
| `TK-N3` | open token poslaný na `/t/c/` | `token_type_mismatch` |
| `TK-N4` | `key_id = 9`, klíč není v konfiguraci | `token_unknown_key` |
| `TK-N5` | payload zkrácený o 1 bajt | `token_malformed` |
| `TK-N6` | identity token s `expires_at` v minulosti | `token_expired` |
| `TK-N7` | identity token použitý podruhé | `token_already_used` |
| `TK-N8` | base64 se standardní abecedou (`+`, `/`) místo base64url | `token_malformed` |
| `TK-N9` | base64url **s** paddingem `=` | `token_malformed` |

**Fixture soubor** `fixtures/token/vectors.json` obsahuje pole objektů `{id, type, key_id, fields, expected_token, expected_mac_full}` pro pozitivní a `{id, token, endpoint_type, expected_error}` pro negativní případy. Go i TypeScript test načte tentýž soubor, vyrobí token z polí a porovná řetězec.

---

#### 4.10.4 Kontrakt 4: Šifrování credentials

**Použití:** přístupy k SES a SMTP, API klíče AI providerů, tajemství odchozích webhooků. Aplikace šifruje i dešifruje, sender jen dešifruje (a to jen `sending_providers.config_encrypted`).

**Algoritmus:** AES-256-GCM, 96bitový nonce, 128bitový tag. Obojí je ve standardní knihovně Node (`crypto.createCipheriv('aes-256-gcm', ...)`) i Go (`crypto/aes` + `crypto/cipher.NewGCM`).

**Obálka**

```
header     = version(1) || key_id(1) || context_len(1) || context(context_len)
envelope   = header || nonce(12) || ciphertext(N) || tag(16)
stored     = "enc:v1:" || base64_standard_with_padding(envelope)
aad        = "openengage/cred/v1" || header || workspace_id(16)
key        = HKDF(SHA-256, MASTER, "openengage/v1", "openengage/v1/credential-encryption", 32)
```

| Pole | Hodnota |
|---|---|
| `version` | `0x01` |
| `key_id` | 1 až 255, viz 3.10 |
| `context` | ASCII, 1 až 64 bajtů, viz tabulka níže |
| `nonce` | 12 náhodných bajtů z CSPRNG, **nikdy se neopakuje pro tentýž klíč** |
| `ciphertext` | šifrovaný UTF-8 JSON |
| `tag` | GCM autentizační tag |
| `workspace_id` v AAD | 16 bajtů binárně (ne ASCII s pomlčkami), pořadí podle RFC 9562 |

**AAD váže obálku na dvě věci: na kontext a na workspace.**

- **Kontext** brání přesunu zašifrované hodnoty z jednoho sloupce do druhého. Bez něj by šlo zkopírovat obsah `webhook_endpoints.secret_encrypted` do `sending_providers.config_encrypted` a dešifrování by prošlo.
- **`workspace_id`** brání přesunu mezi projekty. Bez něj by útočník se zápisem do databáze mohl zkopírovat zašifrované SES přístupy projektu A do řádku provideru projektu B a rozesílat z cizího účtu. Je to návrh z části 4b a přebírám ho, protože stojí jeden řádek kódu a zavírá reálnou díru.

`workspace_id` je v AAD, ne v obálce. Kdo dešifruje, ho už má (je to `workspace_id` řádku, ze kterého obálku načetl), takže se nemusí přenášet. Pro hypotetické budoucí tajemství, které k projektu nepatří, se použije nulové UUID; v MVP 0 takové není.

**Dva důsledky, které je nutné mít na paměti:**

1. Přesun projektu mezi instalacemi (export a import) vyžaduje zachovat `workspace_id`. Kdo by ho při importu přegeneroval, znepřístupní si credentials. Je to napsané v dokumentaci k obnově.
2. `oe rotate-credentials` musí znát `workspace_id` každého řádku. Zná ho, protože prochází tabulky, které ho nesou.

**Povolené kontexty (KONTRAKT, rozšiřuje se jen společným rozhodnutím)**

| Kontext | Kde | Kdo dešifruje |
|---|---|---|
| `sending_provider` | `sending_providers.config_encrypted` | aplikace i sender |
| `ai_provider` | `workspaces.settings.ai` a vlastní tabulka části 3 | aplikace |
| `webhook_secret` | `webhook_endpoints.secret_encrypted` | aplikace |
| `oauth_token` | rezervováno pro budoucí konektory | aplikace |

**Uložení jako `text`, ne `bytea`.** Prefix `enc:v1:` dělá zálohu a debugování čitelnými (`grep enc:v1:` najde všechna zašifrovaná pole) a odpadá práce s `bytea` escapováním na dvou stranách. Base64 je zde **standardní** s paddingem (RFC 4648 §4), na rozdíl od tokenů, kde je base64url bez paddingu. Rozdíl je záměrný: token jde do URL, tohle ne.

**Dešifrování (normativní)**

```
1. Prefix "enc:v1:"? Jinak chyba crypto_envelope_malformed.
2. base64 dekódování. Chyba => crypto_envelope_malformed.
3. version == 0x01? Jinak crypto_unsupported_version.
4. Načti key_id, context_len, context. context_len mimo 1..64 => malformed.
5. Kontext odpovídá očekávanému pro tento sloupec? Jinak crypto_context_mismatch.
6. key_id je známý? Jinak crypto_unknown_key.
7. Sestav aad, dešifruj, ověř tag. Neplatný tag => crypto_auth_failed.
   Chybu NIKDY nerozlišuj podle příčiny směrem ven; ven jde vždy jeden kód.
8. Parsuj JSON.
```

**Testovací vektory (závazné, ověřeno spuštěním)**

```
SECRET_KEY   = AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8
key_id       = 1
context      = sending_provider
workspace_id = 0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071
nonce        = 000102030405060708090a0b        (v testu pevný, v provozu náhodný)
plaintext    = {"access_key_id":"AKIAEXAMPLE","secret_access_key":"s3cr3t","region":"eu-central-1"}

K_credential-encryption = 99d7e191906061a6b21d63fb792449c93ca147dc7324862c2963b0b6c70bdc6f
header hex     = 01011073656e64696e675f70726f7669646572
aad hex        = 6f70656e656e676167652f637265642f763101011073656e64696e675f70726f76696465
                 720192f3a01c2d7e409a1b2c3d4e5f6071
ciphertext hex = 879c4c4575b21dda4910c03c9f37f6f284d7c292f784f59df8f90db8836d0ae36b6569525b5a
                 46e701e195207bbfa8f282ede23d1d7a5f4bff4400d3532f2f70d43a553e19d2858e95d979e
                 abdba2eb53bd8d607
tag hex        = 581ff0497f7a0ff5899762e3cb5a0144
envelope bajtů = 131

stored = enc:v1:AQEQc2VuZGluZ19wcm92aWRlcgABAgMEBQYHCAkKC4ecTEV1sh3aSRDAPJ839vKE18KS94T1nfj5DbiDbQrja2VpUltaRucB4ZUge7+o8oLt4j0del9L/0QA01MvL3DUOlU+GdKFjpXZeeq9ui61O9jWB1gf8El/eg/1iZdi48taAUQ=
```

Pozor při implementaci: **AAD neovlivňuje ciphertext, jen tag.** Kdo si vektor přepočítá bez `workspace_id` v AAD, dostane shodný ciphertext a jiný tag. Když tedy sedí ciphertext a nesedí tag, chyba je v AAD, ne v klíči ani v nonce.

**Negativní vektory**

| ID | Vstup | Očekávaná chyba |
|---|---|---|
| `CR-N1` | změněný jeden bajt ciphertextu | `crypto_auth_failed` |
| `CR-N2` | změněný `context` na `ai_provider` | `crypto_auth_failed` (AAD nesedí) |
| `CR-N8` | tatáž obálka dešifrovaná s `workspace_id` jiného projektu | `crypto_auth_failed` |
| `CR-N3` | očekáván kontext `webhook_secret`, v obálce `sending_provider` | `crypto_context_mismatch` |
| `CR-N4` | `version = 0x02` | `crypto_unsupported_version` |
| `CR-N5` | `key_id = 7`, klíč není v konfiguraci | `crypto_unknown_key` |
| `CR-N6` | chybějící prefix `enc:v1:` | `crypto_envelope_malformed` |
| `CR-N7` | obálka zkrácená o tag | `crypto_envelope_malformed` |

---

#### 4.10.5 Golden fixtures a jejich spouštění v CI

**Formát:** všechny fixtures jsou JSON, protože ho čtou oba jazyky bez knihovny. Žádný YAML, žádný jazykově specifický formát.

**Struktura každého souboru** je popsaná JSON schématem v `packages/contracts/schema/`. Job `contracts-fixtures-schema` validuje fixtures proti schématu, takže se nemůže stát, že jedna strana čte pole, které druhá neposílá.

**Sdílení do Go:** `apps/sender/testdata` je symlink na `../../packages/contracts/fixtures`. Go test čte přes `os.ReadDir("testdata/liquid")`. Symlink, ne kopie, protože kopie se rozejde.

**Job `contracts-golden` (blokující)**

```yaml
contracts-golden:
  runs-on: ubuntu-latest
  timeout-minutes: 6
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4     # Node 24.18.1
    - uses: pnpm/action-setup@v4      # pnpm 11.18.0
    - uses: actions/setup-go@v5       # Go 1.26
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @openengage/contracts test:golden      # TypeScript strana
    - run: cd apps/sender && go test ./internal/contracts/... -run 'TestGolden'
    - run: pnpm --filter @openengage/contracts test:parity      # počty a pokrytí
```

`test:parity` kontroluje čtyři věci:

1. Obě strany zpracovaly stejný počet fixtures v každé kategorii (čte se počítadlo, které si každá strana zapíše do `reports/<lang>-golden.json`).
2. Každý kód z tabulek zakázaných konstrukcí a negativních vektorů má alespoň jednu fixture.
3. Žádná fixture není označená jako přeskočená.
4. Kontraktní sloupce z 4.10.1 existují v databázi po migracích a mají očekávaný typ (dotaz do `information_schema.columns`).

**Co se stane, když fixture spadne:** build je červený a merge zablokovaný. Fixture se neopravuje tak, aby prošla; opravuje se implementace. Změna očekávané hodnoty ve fixture vyžaduje popis v commit message začínající `contract:` a review od vlastníků obou stran, což hlídá `CODEOWNERS` na adresáři `packages/contracts/fixtures`.
---

## 5. UI

Tato část vlastní **skořápku aplikace a design systém**, ne obrazovky jednotlivých domén.

### 5.1 Design systém

| Vrstva | Volba |
|---|---|
| CSS | Tailwind CSS 4, konfigurace v `packages/ui` |
| Komponenty | shadcn/ui, zkopírované do `packages/ui/src/components`, ne jako závislost |
| Ikony | `lucide-react` (ISC) |
| Písmo | systémový stack, žádné načítání z Google Fonts (pravidlo o nulové komunikaci s cizím cloudem platí i pro fonty) |
| Barevný režim | světlý a tmavý, přepínač v profilu, výchozí podle `prefers-color-scheme` |

**Designové tokeny** jsou CSS proměnné v `packages/ui/src/tokens.css`. Sémantické názvy, ne barvy: `--color-surface`, `--color-surface-muted`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-primary`, `--color-danger`, `--color-warning`, `--color-success`. Komponenta, která používá `bg-blue-500` místo tokenu, neprojde review.

**Přístupnost:** cíl WCAG 2.2 AA. Kontrast textu 4,5:1, interaktivní prvky 3:1. Každý interaktivní prvek má viditelný focus ring. Modální okna mají focus trap a `Escape`. Formuláře mají `label` svázaný s `input`, chybová hláška je propojená přes `aria-describedby` a oznámená přes `aria-live="polite"`. Testuje se `axe-core` v Playwright na hlavních obrazovkách.

### 5.2 Layout aplikace

```
┌──────────────────────────────────────────────────────────────┐
│ Topbar: [logo] [přepínač projektů ▾]        [?] [jazyk] [já ▾]│
├────────────┬─────────────────────────────────────────────────┤
│ Sidebar    │  Obsah                                          │
│  Přehled   │  ┌───────────────────────────────────────────┐  │
│  Kontakty  │  │ Nadpis stránky + primární akce vpravo      │  │
│  Segmenty  │  ├───────────────────────────────────────────┤  │
│  Šablony   │  │ Tělo                                       │  │
│  Kampaně   │  └───────────────────────────────────────────┘  │
│  Reporty   │                                                 │
│  Formuláře │                                                 │
│  ─────────  │                                                 │
│  Nastavení │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

- Cesta: `/{locale?}/w/{workspace_slug}/{sekce}`. Workspace je v URL, takže se dá poslat odkaz kolegovi a otevře se správný projekt.
- Sidebar se sbaluje na ikony, na mobilu je v šuplíku. Stav sbalení v `localStorage`.
- **Přepínač projektů** je vždy vidět v topbaru a ukazuje název aktuálního projektu. Je to přímá odpověď na problém ze zadání: uživatel musí vždy vědět, ve kterém projektu je, protože jinak pošle kampaň špatným lidem. Aktuální projekt má navíc barevný proužek pod topbarem, jehož barva se odvozuje deterministicky z `workspace_id`.
- Sekce, na kterou uživatel nemá oprávnění, se v navigaci **nezobrazuje**. Přímý přístup vrací stránku 403 s vysvětlením a odkazem zpět.

### 5.3 Obrazovky vlastněné částí 1

| Obrazovka | Cesta | Stavy |
|---|---|---|
| První spuštění | `/setup` | formulář, odesílání, chyba, hotovo (přesměrování) |
| Přihlášení | `/login` | formulář, odesílání, chybné údaje, zamčený účet, rate limit |
| Zapomenuté heslo | `/forgot-password` | formulář, odesláno (vždy stejná hláška) |
| Nastavení nového hesla | `/reset-password` | formulář, neplatný nebo prošlý token, hotovo |
| Přijetí pozvánky | `/invitations/accept` | načítání, formulář registrace nebo přihlášení, neplatná pozvánka, hotovo |
| Nemám projekt | `/no-workspace` | prázdný stav s výzvou vytvořit projekt |
| Profil | `/settings/profile` | jméno, jazyk, zóna, změna hesla, aktivní relace |
| Projekt | `/w/{slug}/settings/general` | název, slug, jazyk, zóna, oslovení (vykání nebo tykání), smazání |
| Členové | `/w/{slug}/settings/members` | seznam, pozvánky, změna role, odebrání |
| API klíče | `/w/{slug}/settings/api-keys` | seznam, vytvoření, zobrazení sekretu jednou, rotace, revokace |
| Webhooky | `/w/{slug}/settings/webhooks` | seznam, detail s logem doručení, test, znovuaktivace |
| Audit log | `/w/{slug}/settings/audit` | seznam s filtry |
| Zálohy | `/w/{slug}/settings/backups` | seznam, spuštění, výsledek posledního ověření |

**Povinné stavy každého seznamu:** načítání (skeleton, ne spinner), prázdný stav s vysvětlením a primární akcí, chyba s tlačítkem "Zkusit znovu" a s `request_id` k okopírování, stav bez oprávnění.

**Prázdné stavy, texty**

| Obrazovka | cs | en |
|---|---|---|
| API klíče | „Zatím nemáte žádný API klíč. Klíč slouží k propojení e-shopu nebo vlastní aplikace." | "You do not have any API keys yet. A key connects your shop or your own application." |
| Členové | „V projektu jste zatím sami. Pozvěte kolegy a určete, co smí." | "You are alone in this project. Invite colleagues and choose what they can do." |
| Webhooky | „Žádný webhook. Webhook pošle událost na vaši adresu, jakmile se něco stane." | "No webhooks yet. A webhook posts an event to your URL as soon as something happens." |
| Audit log | „Zatím se nic nestalo." | "Nothing has happened yet." |
| Zálohy | „Zatím žádná záloha. Nastavte pravidelné zálohování, než vložíte první kontakty." | "No backups yet. Set up scheduled backups before you add your first contacts." |
| Nemám projekt | „Nemáte přístup k žádnému projektu. Požádejte o pozvánku, nebo si založte vlastní." | "You have no access to any project. Ask for an invitation or create your own." |

**Klíčové hlášky**

| Situace | cs | en |
|---|---|---|
| Sekret klíče | „Zkopírujte si sekret teď. Už ho nikdy neuvidíme ani my." | "Copy the secret now. Neither you nor we can see it again." |
| Smazání projektu | „Smazání odstraní všechny kontakty, kampaně i statistiky. Obnovit to jde 30 dní. Pro potvrzení opište název projektu." | "Deleting removes all contacts, campaigns and statistics. You can restore it for 30 days. Type the project name to confirm." |
| Deaktivovaný webhook | „Váš webhook jsme vypnuli po 20 neúspěšných pokusech. Opravte cíl a zapněte ho znovu." | "We disabled your webhook after 20 failed attempts. Fix the target and enable it again." |
| Neshoda `SECRET_KEY` | „Šifrovací klíč instalace se změnil. Uložené přístupy k odesílání nejde přečíst. Vraťte původní klíč, nebo přístupy zadejte znovu." | "The installation encryption key has changed. Stored sending credentials cannot be read. Restore the original key or re-enter the credentials." |
| Režim údržby | „Aktualizace databáze se nezdařila. Aplikace běží v omezeném režimu. Podrobnosti najdete v logu pod ID {request_id}." | "The database update failed. The application runs in limited mode. See the log under ID {request_id}." |

**Chyby v UI:** uživatel vidí lokalizovaný `detail` a pod ním malým písmem `request_id` s tlačítkem „kopírovat". Pod tím je **sbalený blok „Technické detaily"**, který po rozkliknutí ukáže `code`, `request_id`, čas a cestu, opět s tlačítkem na zkopírování celého bloku.

Původní verze konvence nechávala `code` jen v atributu `data-error-code`. Verze části 6 je praktičtější: uživatel podpory ho takhle přečte a pošle, zatímco číst atributy v DOM po telefonu nejde. Sbalený stav zajistí, že běžnému uživateli to nepřekáží. `data-error-code` v DOM zůstává kvůli testům.

### 5.4 Živé aktualizace

Infrastrukturu pro živé aktualizace (SSE) vlastní část 5. Tato část dodává jen společný layout prvek pro indikátor spojení (připojeno, obnovuje se, odpojeno) a pravidlo, že žádná obrazovka nesmí být závislá na živém spojení pro základní funkci. Když SSE spadne, stránka funguje dál a jen se neaktualizuje sama.

---

## 6. Bezpečnost a soukromí

**Model hrozeb, na které tato část odpovídá**

| Hrozba | Opatření | Sekce |
|---|---|---|
| Únik dat mezi projekty | repository vrstva plus RLS, testy | 3.6 |
| Kompromitovaný API klíč vidí do jiného projektu | workspace se bere z klíče, ne z requestu | 3.5, 3.6 |
| Krádež session cookie | HttpOnly, Secure, SameSite, krátká nečinnostní expirace, revokace | 3.2 |
| CSRF | SameSite, kontrola Origin, double submit token | 3.2 |
| Útok hrubou silou na heslo | Argon2id, rate limit na tři úrovně, zamčení účtu | 3.1 |
| Enumerace účtů | jednotné odpovědi a jednotná latence u přihlášení a resetu | 3.1 |
| Enumerace workspace ID | 404 místo 403 pro nečlena | 3.4 |
| Časovací útok na API klíč | `timingSafeEqual`, dummy porovnání při neexistenci | 3.5 |
| SSRF přes odchozí webhook | blocklist rozsahů, kontrola při každém doručení, žádná přesměrování | 3.8 |
| Replay podepsaného webhooku u příjemce | timestamp v podpisu, `OE-Event-Id`, dokumentovaný postup | 3.8 |
| Záměna typu trackovacího tokenu | typ v MAC vstupu, kontrola proti endpointu | 4.10.3 |
| Přesun zašifrované hodnoty mezi sloupci | kontext v AAD | 4.10.4 |
| Chyba v senderu sáhne na kontakty | oddělená DB role bez práv na `contacts` | 4.10.1 |
| Ztráta nebo únik `SECRET_KEY` | otisk v `system_settings`, `oe doctor`, dokumentovaná rotace | 3.10 |
| Škodlivý obsah v šabloně | automatické escapování v HTML kontextu | 4.10.2 |

**Hlavičky odpovědí** (nastavuje `proxy.ts`, tedy Next.js 16 náhrada middleware):

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self';
  frame-ancestors 'none'; base-uri 'self'; form-action 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains      (jen když APP_URL je https)
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=(), interest-cohort=()
X-Frame-Options: DENY
```

`img-src` musí povolit `https:`, protože náhled šablony zobrazuje obrázky z domény uživatele. `script-src 'self'` bez `unsafe-inline` znamená, že Next.js musí běžet s nonce; nastavuje se v `proxy.ts` a předává do `next/script`.

**CORS:** veřejné API má CORS **vypnutý** (žádná hlavička `Access-Control-Allow-Origin`), protože serverový klíč nemá co dělat v prohlížeči. Výjimky s CORS `*`: `/e/track` (ingestion, ověřuje se veřejným klíčem), `/f/**` (formuláře), `/api/v1/openapi.json`. Preflight se cachuje na 24 hodin.

**Co se nikdy nesmí objevit v logu:** hesla, obsah `Authorization`, cookies, sekrety klíčů, dešifrované credentials, `render_data` (obsahuje osobní údaje), e-mailové adresy kontaktů na úrovni `info` a níž (na `debug` ano, s upozorněním v dokumentaci).

**GDPR na úrovni platformy** (doménová část je v části 2):

- `users`: právo na export a výmaz je řešené jako smazání účtu; členství zaniknou, `audit_log` si drží `actor_label` jako zmrazený text, ne odkaz.
- Audit log obsahuje IP adresy. Retence 24 měsíců je zdůvodnitelná jako oprávněný zájem (bezpečnost), a je konfigurovatelná níž.
- Zálohy obsahují osobní údaje. Dokumentace to říká nahlas a doporučuje šifrovaný svazek pro `/data/backups`.
- Instalace neposílá nikam nic. Žádná telemetrie, žádná kontrola licence, žádné volání domů. Test v CI hlídá, že v produkčním buildu není žádný `fetch` na cizí doménu mimo whitelist (AI provideři a SES, obojí volané jen na výslovný pokyn uživatele).

---

## 7. Výkon

**Očekávané objemy jedné self-hosted instalace (návrhový cíl MVP 0)**

| Veličina | Cíl | Kde to praskne dřív |
|---|---|---|
| Workspaces | do 50 | nikde, je to malá tabulka |
| Uživatelů | do 200 | nikde |
| Kontaktů na workspace | 5 000 000 | segmentace, viz část 2 |
| Zpráv v jedné kampani | 1 000 000 | materializace a claim, viz část 4 |
| Requestů na API | 100 za sekundu | pool spojení, `DATABASE_POOL_MAX` |
| Web eventů | 500 za sekundu | ingestion, viz část 5 |

**Kritické dotazy vlastněné touto částí**

| Dotaz | Frekvence | Index | Cíl |
|---|---|---|---|
| Ověření session podle `token_hash` | každý request z UI | `uq_sessions__token_hash` | < 1 ms |
| Ověření API klíče podle `prefix` | každý request na API | `uq_api_keys__prefix` | < 1 ms |
| Členství uživatele pro přepínač projektů | jednou za načtení stránky | `idx_memberships__user_id` | < 2 ms |
| Fan-out webhooku: aktivní endpointy pro typ | při každé události | `idx_webhook_endpoints__ws_active` + GIN | < 3 ms |
| Audit log projektu, první stránka | ruční akce | `idx_audit_log__ws_created` | < 20 ms |
| Claim dávky senderem | 2× za sekundu na sender | `idx_messages__claimable` | < 10 ms pro 500 řádků |

**Kde to praskne první a co s tím**

1. **`sessions` a zápis `last_used_at`.** Při 100 requestech za sekundu by to bylo 100 zápisů za sekundu do malé tabulky s indexy. Proto se zapisuje nejvýš jednou za 5 minut na session. Bez toho by `sessions` generovala nejvíc WAL v celém systému.
2. **`api_keys.last_used_at`** ze stejného důvodu nejvýš jednou za 60 sekund a mimo hlavní transakci.
3. **Pool spojení.** `MODE=all` znamená tři procesy proti jedné databázi. Součet `DATABASE_POOL_MAX` (web) plus pg-boss `max` (worker) plus pool senderu musí zůstat pod `max_connections` Postgresu (výchozí 100). Výchozí hodnoty: web 10, worker 10, sender 8, celkem 28. Dokumentace to uvádí u návodu na škálování a `oe doctor` to kontroluje.
4. **`audit_log` bez partition** by po roce provozu měl desítky milionů řádků a dotaz s `ORDER BY created_at DESC` by byl pomalý. Partitioning to řeší tím, že se čte jen poslední partition.
5. **RLS režie.** Politika s `current_setting(...)::uuid` se vyhodnocuje na řádek. U seznamů s indexem je to zanedbatelné, u sekvenčního scanu ne. Proto je repository vrstva primární obranou a RLS druhou: dotazy se píší tak, aby vždy měly index na `workspace_id`, a RLS pak jen potvrzuje to, co už `WHERE` splnil. Měření: rozdíl mezi zapnutou a vypnutou RLS na dotazech z tabulky výše musí zůstat pod 10 %, měří to benchmark v `test-db`.
6. **Idempotency klíče.** Tabulka roste s počtem zápisových requestů. 24hodinová retence a úklidový job drží velikost v desítkách tisíc řádků.

**Startovací doba:** cíl je od `docker compose up` po `ready` do **60 sekund** na čisté instalaci včetně migrací. Proto má healthcheck `start-period=60s`.

---

## 8. Akceptační kritéria

Testovatelné věty. Z každé jde napsat test bez doptávání.

**Instalace a provoz**

1. Na čistém stroji s Dockerem vytvoří `docker compose --profile bundled up -d` běžící instalaci, která do 60 sekund odpovídá 200 na `/api/health/ready`.
2. Start bez `SECRET_KEY` skončí s exit code 78 a vypíše na stderr řádek obsahující `SECRET_KEY` a slovo "povinná" nebo "required".
3. Start s neplatnou konfigurací vypíše **všechny** chyby konfigurace naráz, ne jen první.
4. Tři repliky s `MODE=web` spuštěné současně proti prázdné databázi aplikují migrace právě jednou; `drizzle.__drizzle_migrations` obsahuje každou migraci jednou.
5. Zabití kontejneru během migrace a jeho restart vede k dokončení migrací bez ruční akce.
6. `docker compose kill -s SIGTERM app` ukončí procesy do 30 sekund; v logu je řádek o graceful shutdownu a žádný request neskončí přerušeným spojením.
7. Image nemá víc než 250 MB a `docker inspect` ukazuje `User` `10001`.
7b. Kontejner spuštěný s `ANTHROPIC_API_KEY=sk-test` v prostředí a s projektem bez nakonfigurovaného AI klíče neodešle jediný požadavek na `api.anthropic.com`; proměnná není v prostředí web ani worker procesu.
7c. Žádná proměnná v zod schématu konfigurace nekončí na `_API_KEY`, jinak by ji entrypoint vymazal.
8. Kontejner spuštěný s `read_only: true` funguje; zapisuje jen do `/data` a `/tmp`.
9. `oe backup` vytvoří adresář s `database.dump`, `uploads.tar.gz` a `manifest.json`, jehož `row_counts.contacts` odpovídá skutečnosti.
10. `oe backup verify` na právě vytvořené záloze skončí s exit code 0 a nezanechá databázi `oe_verify_*`.
11. `oe restore` do neprázdné databáze bez `--force` skončí nenulovým kódem a nic nezmění.
12. `oe restore` zálohy z novější `app_version` je odmítnutý s hláškou obsahující `backup_from_newer_version`.
13. Start image se `schema_version` v databázi vyšší, než image zná, skončí exit code 5 a hláškou `schema_version_ahead`.

**Identita a přístup**

14. Přihlášení se správnými údaji nastaví cookie `oe_session` s atributy `HttpOnly`, `SameSite=Lax` a (nad https) `Secure`.
15. Deset neúspěšných přihlášení na jeden účet vede k `423 account_locked` a jedenáctý pokus se správným heslem také selže, dokud neuplyne 15 minut.
16. Doba odpovědi na přihlášení k neexistujícímu účtu se neliší od odpovědi k existujícímu o víc než 20 % (měřeno mediánem ze 100 pokusů).
17. Změna hesla revokuje všechny ostatní relace uživatele; request se starou cookie z jiné relace vrátí 401 `session_expired`.
18. `POST /api/v1/auth/logout-all` způsobí, že i aktuální cookie přestane platit.
19. API klíč workspace B na `GET /api/v1/contacts/{id_z_A}` vrátí 404 s `Content-Type: application/problem+json` a `code: "not_found"`.
20. Přímý SQL `SELECT * FROM contacts` pod rolí `openengage_app` bez `set_config('openengage.workspace_id', ...)` vrátí 0 řádků.
21. Pokus vložit řádek s cizím `workspace_id` pod nastaveným kontextem selže na `WITH CHECK`.
22. Odebrání posledního ownera vrátí 409 `last_owner_cannot_be_removed` a členství zůstane beze změny.
23. Uživatel s rolí `viewer` dostane na `POST /api/v1/campaigns` odpověď 403 `forbidden`.
24. API klíč bez scope `contacts:write` dostane na `POST /api/v1/contacts` odpověď 403 `insufficient_scope`.
25. Sekret API klíče je v odpovědi právě jednou, při vytvoření; `GET /api/v1/api-keys` ho neobsahuje v žádném poli.
26. Veřejný klíč `oe_pub_*` na `POST /api/v1/contacts` vrátí 403; na `POST /e/track` projde.

**API framework**

27. Neplatné tělo vrátí 422 s `Content-Type: application/problem+json` a polem `errors` obsahujícím `path` každého vadného pole.
28. Neznámý klíč v těle vrátí 422, ne 201.
29. Každá chybová odpověď obsahuje `request_id`, který se objevuje i v logu s tímtéž requestem.
30. Dvě volání téhož `POST` se stejným `Idempotency-Key` a stejným tělem vytvoří jeden zdroj; druhá odpověď má hlavičku `Idempotent-Replay: true` a shodné tělo.
31. Stejný `Idempotency-Key` s jiným tělem vrátí 409 `idempotency_key_reuse`.
32. Překročení limitu vrátí 429 s hlavičkami `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining` a `RateLimit-Reset`.
33. Stránkování přes celý seznam 10 000 položek po 50 vrátí každou položku právě jednou i při souběžném vkládání nových.
34. `GET /api/v1/openapi.json` vrací dokument, který je bajt po bajtu shodný s `packages/contracts/openapi.json`.
35. Každá cesta registrovaná v routeru je přítomná ve vygenerovaném OpenAPI dokumentu.

**Webhooky**

36. Endpoint vracející 500 dostane přesně 8 pokusů rozložených podle tabulky z 3.8 (tolerance jitteru ±20 %), pak je doručení `abandoned`.
37. Endpoint vracející 410 je po prvním pokusu `disabled` s důvodem `endpoint_gone`.
38. Podpis `OE-Signature` spočítaný z testovacího vektoru v 3.8 odpovídá bajt na bajt.
39. Webhook na `http://169.254.169.254/` se neuloží; při změně DNS na privátní adresu po uložení skončí doručení s `blocked_target` a bez pokusu o spojení.
40. Dvacet neúspěchů po sobě deaktivuje endpoint a odešle e-mail ownerům.

**Kontrakty**

41. Všech nejméně 40 Liquid fixtures projde v TypeScriptu i v Go se shodným výstupem bajt po bajtu.
42. Fixture přidaná jen do jedné strany způsobí selhání testu `test:parity`.
43. Každý ze čtyř typů trackovacích tokenů vygenerovaný v Go je shodný s tokenem vygenerovaným v TypeScriptu pro tatáž vstupní data a odpovídá vektoru z 4.10.3.
44. Open token poslaný na `/t/c/` je odmítnutý s `token_type_mismatch`.
45. Obálka credentials zašifrovaná v TypeScriptu je dešifrovatelná v Go a naopak; změna jednoho bajtu ciphertextu vede k `crypto_auth_failed`.
46. Obálka s kontextem `sending_provider` dešifrovaná s očekáváním `webhook_secret` selže.
47. Dva sendery claimující z outboxu s 1 000 zprávami zpracují každou právě jednou.
48. Sender zabitý uprostřed dávky nezpůsobí ztrátu zprávy: po uplynutí TTL claimu je součet `sent + failed + skipped + pending` roven 1 000 a žádná zpráva nemá `attempts > 1` bez zápisu `ambiguous_dispatch`.
49. Sender s rolí `openengage_sender` dostane chybu oprávnění na `SELECT * FROM contacts` i na `DELETE FROM messages`.
50. `Message-ID` vygenerovaný pro tutéž `messages.id` je při dvou pokusech identický.

**i18n a rotace klíčů**

51. Klíč přítomný v `en.json` a chybějící v `cs.json` způsobí selhání jobu `i18n-check`.
52. Chybějící překladový klíč vyhodí výjimku v `NODE_ENV=test` a vykreslí poslední segment klíče v produkci.
53. Text s `{count, plural, ...}` se v češtině vykreslí správně pro 0, 1, 3 a 5.
54. Po rotaci `SECRET_KEY` s ponechaným `SECRET_KEY_PREVIOUS` se starý trackovací token stále ověří a nový se podepíše novým klíčem.
55. `oe rotate-credentials` přešifruje všechny obálky na aktuální `key_id`; po jeho doběhnutí projde dešifrování i bez `SECRET_KEY_PREVIOUS`.
56. Start s jiným `SECRET_KEY` bez `SECRET_KEY_PREVIOUS` proběhne, ale `/api/health/ready` obsahuje varování `secret_key_fingerprint_mismatch`.

---

## 9. Závislosti

Všechny ověřené 2026-07-31 příkazem `npm view <balíček> license version time.modified` a `https://api.npmjs.org/downloads/point/last-week/<balíček>`, respektive přes GitHub API u Go knihoven.

### 9.1 pg-boss a konvence jobů

`pg-boss` chyběl v tabulce závislostí, přestože ho tenhle dokument používá v šesti sekcích a část 4a na jeho `singletonKey` staví jednu ze tří ochran proti dvojí materializaci publika.

| Balíček | Verze | Licence | Poslední aktualizace | Stažení za týden |
|---|---|---|---|---|
| `pg-boss` | 12.26.3 | MIT | 2026-07-24 | 1 189 818 |

Ověřeno 2026-07-31 přes `npm view pg-boss license version time.modified`.

**Co `singletonKey` garantuje a co ne (KONVENCE, čtěte dřív, než na něj postavíte ochranu)**

> `singletonKey` zabraňuje tomu, aby ve frontě existovaly **dva souběžné joby** se stejným klíčem. **Negarantuje**, že job proběhne právě jednou. Job, který spadne, vyprší (`expireInSeconds`), nebo jehož worker zemře, se podle `retryLimit` spustí **znovu**, a to i tehdy, když jeho první běh už stihl vedlejší efekty.

Z toho plyne pravidlo bez výjimky: **každý pg-boss job musí být idempotentní.** Nikde v produktu nesmí být job, jehož druhý běh napáchá škodu. Není to doporučení, je to podmínka správnosti, a nikde to dosud nebylo napsané.

Jak se idempotence dosahuje, podle typu jobu:

| Typ jobu | Mechanismus |
|---|---|
| Zápis řádků (materializace, fan-out) | `ON CONFLICT DO NOTHING` nad unikátním indexem, včetně partition key |
| Změna stavu | podmíněný `UPDATE ... WHERE status = <očekávaný>` a kontrola počtu ovlivněných řádků |
| Volání ven (webhook, provider) | ochrana na straně příjemce (`OE-Event-Id`), nebo deterministický identifikátor (`Message-ID`) |
| Výpočet a přepočet | z definice idempotentní, stačí přepsat výsledek |

**Konvence jobů**

| Věc | Pravidlo |
|---|---|
| Název fronty | `<domena>.<akce>`, například `contacts.import`, `platform.webhook_deliver` |
| Vytvoření fronty | `createQueue` při startu workeru, idempotentní |
| Schéma | `PGBOSS_SCHEMA`, výchozí `pgboss`, oddělené od aplikačního |
| `retryLimit` a `retryBackoff` | explicitně na frontě, nespoléhat na výchozí hodnoty |
| `expireInSeconds` | explicitně, výchozích 15 minut je pro krátké joby moc |
| Dead letter | fronta `<domena>.<akce>.dlq` u všeho, co smí trvale selhat |
| Souběžnost | `localConcurrency` z `WORKER_CONCURRENCY` |
| Payload | jen identifikátory a malá metadata, **nikdy osobní údaje ani obsah e-mailů**, protože payload leží v databázi a jde do zálohy |
| Migrace pg-boss | běží při `boss.start()`, tedy mimo náš migrační runner. Verze pg-boss se proto smí měnit jen spolu s vydáním, ne za běhu |

**Node, nové oproti hlavní specifikaci**

| Balíček | Verze | Licence | Poslední aktualizace | Stažení za týden | K čemu |
|---|---|---|---|---|---|
| `hono` | 4.12.33 | MIT | 2026-07-31 | 53 647 152 | router veřejného API |
| `@hono/zod-openapi` | 1.5.1 | MIT | 2026-07-15 | 1 569 796 | OpenAPI ze zod schémat |
| `zod` | 4.4.3 | MIT | 2026-05-04 | 246 441 398 | validace, zdroj pravdy pro OpenAPI |
| `@node-rs/argon2` | 2.0.2 | MIT | 2025-05-04 | 857 824 | Argon2id, prebuilt i pro musl |
| `pg` | 8.22.0 | MIT | 2026-06-29 | 39 271 308 | ovladač Postgresu pro Drizzle i pg-boss |
| `rate-limiter-flexible` | 11.2.0 | ISC | 2026-06-08 | 3 028 927 | rate limiting, backend memory i postgres |
| `pino` | 10.3.1 | MIT | 2026-02-09 | 41 654 348 | strukturované logování |
| `uuid` | 14.0.1 | MIT | 2026-06-20 | (součást top 10 npm) | generování UUIDv7 v aplikaci |
| `drizzle-kit` | 0.31.10 | MIT | 2026-07-22 | 14 653 581 | generování migrací |
| `lucide-react` | aktuální | ISC | | | ikony |

**Node, vývojové a CI**

| Balíček | Verze | Licence | Poslední aktualizace | Stažení za týden |
|---|---|---|---|---|
| `typescript` | 7.0.2 | Apache-2.0 | 2026-07-31 | (top 10) |
| `vitest` | 4.1.10 | MIT | 2026-07-24 | 85 985 847 |
| `playwright` | 1.62.1 | Apache-2.0 | 2026-07-31 | (top 50) |
| `testcontainers` | 12.0.4 | MIT | 2026-06-29 | 5 424 625 |
| `turbo` | 2.10.7 | MIT | 2026-07-29 | 20 415 901 |
| `oxlint` | 1.76.0 | MIT | 2026-07-27 | 13 177 835 |
| `prettier` | 3.9.6 | MIT | 2026-07-21 | (top 20) |
| `license-checker` | 25.0.1 | BSD-3-Clause | 2022-06-19 | (stabilní, bez vývoje) |
| `pnpm` | 11.18.0 | MIT | | |

**Go**

| Modul | Licence | Poslední commit | Poznámka |
|---|---|---|---|
| `github.com/jackc/pgx/v5` | MIT | 2026-07-26 | ovladač Postgresu |
| `github.com/google/uuid` | BSD-3-Clause | 2024-11-14 | UUIDv7; repozitář je stabilní bez nového vývoje, funkčně hotový |
| `github.com/caarlos0/env` | MIT | 2026-07-07 | načtení konfigurace z prostředí |
| `github.com/osteele/liquid` v1.8.1 | MIT | 2026-02-27 | Liquid parser, filtry si registrujeme vlastní |
| `github.com/prometheus/client_golang` | Apache-2.0 | 2026-07-24 | volitelné metriky |
| `github.com/google/go-licenses` | Apache-2.0 | 2026-07-09 | CI brána, nástroj, ne závislost binárky |
| standardní knihovna: `crypto/hkdf`, `crypto/aes`, `crypto/cipher`, `crypto/hmac`, `crypto/sha256`, `encoding/base64` | BSD-3-Clause | | HKDF ve stdlib od Go 1.24 |

**Vědomě odmítnuté**

| Balíček | Důvod |
|---|---|
| `postgres` (postgres.js) | licence `Unlicense`; je permisivní, ale mimo dohodnutý whitelist a `pg` je stejně potřeba kvůli pg-boss |
| `czech-inflection` | LGPL v2.1, viz kapitola 9 hlavní specifikace |
| `pa11y` | LGPL-3.0-only, druhý reálný úlovek licenční brány. Přístupnost testujeme přes `axe-core` (MPL-2.0), což jako vývojová závislost projde, protože se nedistribuuje s produktem. |
| jakýkoliv hostovaný rate limiter, feature flag nebo error tracker | porušil by pravidlo o nulové komunikaci s cizím cloudem |
| `jsonwebtoken` a JWT sessions | zbytečná složitost, viz 3.2 |
| `bcrypt` | slabší než Argon2id a má limit 72 bajtů na vstup |
| `golang-migrate/migrate` | licence v GitHub API hlášená jako `NOASSERTION`, a migrace stejně vlastní TypeScript strana |

---

## 10. Požadavky na ostatní části

| ID | Komu | Co potřebuji | V jakém tvaru | Proč |
|---|---|---|---|---|
| P2-1 | část 2 | Výčet polí kontaktu, která smí být kořenem merge tagu `contact.*` | seznam v `packages/contracts/src/liquid/contact-fields.ts` jako typovaný union | validátor Liquid subsetu podle 4.10.2 musí odmítnout neexistující pole |
| P2-2 | část 2 | Formát `contacts.locale` a pravidlo, jak se určuje jazyk kontaktu | dvoupísmenný kód nebo NULL | výběr jazyka systémových e-mailů podle 3.9 |
| P2-3 | část 2 | Registrace vlastních chybových kódů a názvů auditních akcí | zápis do `packages/core/errors/registry.ts` a `.../audit.ts` | jednotnost katalogu a testu na duplicity |
| P2-4 | část 2 | Definice payloadů událostí `contact.created`, `contact.subscribed`, `contact.unsubscribed` | JSON schéma v `packages/contracts/webhooks/` | fan-out infrastruktura je moje, obsah váš |
| P3-1 | část 3 | Systémové e-mailové šablony jako blokový JSON, po jazycích, se seedováním v migraci a s upgradem při nové verzi | soubory `packages/emails/system/<name>.<locale>.json` plus mechanismus seedu | 3.9 slibuje pozvánky a reset hesla v jazyce adresáta |
| P3-2 | část 3 | Potvrzení, že kompilovaná šablona obsahuje **jen** konstrukce z Liquid subsetu 4.10.2, a že kompilace vrací seznam použitých cest | funkce `compileTemplate` s návratovým typem obsahujícím `usedPaths: string[]` | bez toho neumím naplnit `render_data` a nemám co validovat |
| P3-3 | část 3 | Kam se ukládají assety a jaká je jejich URL v odeslaném e-mailu | rozhodnutí o `UPLOADS_DIR` versus externí úložiště | ovlivňuje obsah zálohy a Dockerfile |
| P4-1 | část 4 | Použití DDL a stavů z 4.10.1 beze změny; doplnění vlastních sloupců je vítané | odkaz na 4.10.1, ne vlastní verze | dva různé popisy outboxu jsou horší než jeden |
| P4-2 | část 4 | Výchozí hodnota `AMBIGUOUS_DISPATCH_POLICY` a text, který uvidí uživatel | rozhodnutí plus UI hláška cs a en | mechanismus mám, politika je vaše |
| P4-3 | část 4 | Potvrzení, že sender vystačí s granty z 4.10.1; případný další objekt nahlásit | seznam tabulek a operací | role je bezpečnostní hranice, nesmí se rozšiřovat mlčky |
| P4-4 | část 4 | Formát `sending_providers.config_encrypted` jako JSON, který se vejde do obálky 4.10.4 s kontextem `sending_provider` | JSON schéma per typ provideru | Go strana musí vědět, co po dešifrování dostane |
| P5-1 | část 5 | Použití formátu tokenů z 4.10.3 beze změny; sémantiku a expiraci `identity` tokenu vlastníte vy | odkaz na 4.10.3 | tokeny vyrábí Go, ověřuje TypeScript |
| P5-2 | část 5 | Mechanismus jednorázovosti `nonce` u identity tokenu | tabulka nebo jiný úložný mechanismus s retencí | formát nonce mám, úložiště je vaše |
| P5-3 | část 5 | SSE infrastruktura včetně chování při odpojení a limitu souběžných spojení | popis plus komponenta indikátoru stavu | layout dodávám já, obsah vy |
| P5-4 | část 5 | Retenční politika `web_events` a `message_events` pro job odpojování partition | počet měsíců a konfigurační proměnná | partitioning je moje infrastruktura |
| všem | 2 až 5 | Registrace repository modulů do `isolation.matrix.test.ts` | jeden řádek v registru | generický test izolace pokryje i vaši doménu |

---

## 11. Rozpory s hlavní specifikací

**~~R1. PostgreSQL 17 versus 18.~~ UZAVŘENO: poslední produkční verze, dnes 18.**

**Rozhodnutí zadavatele:** projekt cílí na **poslední produkční (stabilní) verzi PostgreSQL**, což je k 2026-07-31 **18**. Rozhodnutí je zapsané jako pravidlo, ne jako číslo. Hlavní specifikace byla opravena z 17 na tohle pravidlo (kapitola 3.2). Až bude produkční verzí 19, cílem je 19.

Původní argumentace, která k tomu vedla, zůstává pro doložení: hlavní specifikace, kapitola 3.2, uváděla PostgreSQL 17. Navrhoval jsem **18**. Důvod: primární klíče jsou UUIDv7 (viz 2.1). Funkce `uuidv7()` je součástí jádra až od PostgreSQL 18 (ověřeno v release notes k 18.0, autor Andrey Borodin, podle RFC 9562). Na 17 by ID musela generovat výhradně aplikace, což znamená, že každý `INSERT` v ruční migraci, každý seed a každý ladicí příkaz by potřeboval vlastní generátor. PostgreSQL 18.4 je k 2026-07-31 aktuální stabilní verze a oficiální image `postgres:18-alpine` existuje. Cena změny je nulová, protože v MVP 0 zatím žádná instalace neběží.

Záložní varianta pro 17 (všechny `DEFAULT uuidv7()` nahradit generováním v aplikaci a v ruční migraci použít `gen_random_uuid()`) **se nepoužije**, rozpor je uzavřený ve prospěch 18.

**R2. Filtr `escape` v Liquid subsetu.**

Hlavní specifikace, kapitola 4.5, vyjmenovává povolené filtry `default, upcase, downcase, date, escape`. Kontrakt 4.10.2 zavádí **automatické escapování** všech výstupů v HTML kontextu, čímž se `escape` stává no-op.

Důvod: bez automatického escapování by kontakt se jménem `<script>` nebo `Kovář & syn` rozbil HTML, a spoléhat na to, že uživatel napíše `| escape` u každého merge tagu, je nereálné. Zároveň nelze mít obojí, protože `escape` nad už escapovanou hodnotou vyrobí `&amp;amp;`.

Zvolené řešení zachovává výčet filtrů z hlavní specifikace (šablona s `| escape` projde a udělá správnou věc), takže formálně o rozpor nejde, ale sémantika filtru je jiná, než jakou by čekal někdo znalý Liquidu. Proto je to tady napsané nahlas. Alternativa, kterou jsem zamítl: `escape` vyhodit ze seznamu a zavést `raw` pro vypnutí escapování. Zamítnuto proto, že `raw` je vstupenka pro XSS v e-mailu odeslaném na sto tisíc adres.

**R3. `date` filtr bez názvů měsíců.**

Hlavní specifikace uvádí filtr `date` bez omezení formátu. Kontrakt povoluje pět formátů a žádný z nich neobsahuje slovní název měsíce nebo dne.

Důvod je stejný jako u vokativu v kapitole 6.3 hlavní specifikace: lokalizační data v senderu znamenají druhou implementaci téhož, která se rozejde. Kdo potřebuje „1. srpna 2026", nechá si hodnotu naformátovat aplikací při materializaci. Je to omezení, které uživatel uvidí, a je potřeba o něm vědět předem.

**R4. Sender potřebuje `SELECT` na `campaigns`, `workspaces` a `campaign_links`.**

Hlavní specifikace, kapitola 5, uvádí, že sender může běžet s uživatelem s právy jen na `messages`, `campaigns` a `sending_providers`. Kontrakt 4.10.1 přidává `workspaces` (kvůli kontrole měkkého smazání v claim dotazu) a `campaign_links` (kvůli přepisu odkazů, kde sender potřebuje `link_id`).

Není to rozšíření hranice směrem ke kontaktům, obě tabulky neobsahují osobní údaje. Ale je to odchylka od textu a patří sem.

**R5. `messages` nemá jednoduchý primární klíč.**

Hlavní specifikace píše `messages(id, ...)` a partitioning po měsících. V PostgreSQL musí primární klíč partitionované tabulky obsahovat partitioning key, takže je to `PRIMARY KEY (id, created_at)`. Důsledek: každý dotaz na jednu zprávu potřebuje i `created_at`, jinak se prohledají všechny partition. Kontrakt to řeší tím, že claim dotaz vrací `created_at` spolu s `id` a sender ho nosí s sebou. Části 4 a 5 na to musí myslet u odkazů na zprávu z událostí.

**R6. Kapitola 9 hlavní specifikace uvádí `next-intl` bez zmínky o `proxy.ts`.**

Next.js 16 přejmenoval `middleware.ts` na `proxy.ts` a exportovanou funkci na `proxy`; edge runtime v `proxy` není podporovaný a runtime je vždy Node.js. Není to rozpor s rozhodnutím, jen věc, kterou je nutné napsat, protože většina návodů na `next-intl` na internetu popisuje starý název a hackathonový tým na to narazí v první hodině.

---

## 12. Otevřené otázky

| ID | Otázka | Kdo rozhoduje | Doporučení |
|---|---|---|---|
| O1 | **Název produktu.** Ovlivňuje jmenný prostor balíčků (`@openengage/*`), název Docker image, prefix API klíčů (`oe_live_`), prefix tokenů (`t1`), název globálního objektu SDK a všechny domain separator řetězce v kryptografii (`openengage/v1/...`). Změna po hodině 0 znamená přepis kontraktů a všech testovacích vektorů. | člověk, před hodinou 0 | Pokud padne rozhodnutí do dvou hodin, cena je nulová. Potom rychle roste. Doporučuji rozhodnout jako úplně první bod hackathonu. |
| ~~O2~~ | ~~**Go, nebo Rust pro sender.**~~ Všechny čtyři kontrakty jsou napsané jazykově neutrálně (binární formáty, HKDF, AES-GCM, SQL), takže rozhodnutí neblokovalo mě, ale blokovalo track B2. | **uzavřeno** | **Go.** Rozhodl zadavatel. Důvody: kompilace v jednotkách sekund místo minut, výrazně větší základna přispěvatelů pro open-source projekt, a výkonová výhoda Rustu se nemá o co opřít, protože strop určuje kvóta Amazonu, ne jazyk. Track B2 je odblokovaný. Odůvodnění v kapitole 3.3 hlavní specifikace. |
| O3 | **Ukládání assetů v self-hosted nasazení.** Adresář `/data/uploads` znamená, že škálování na víc replik `MODE=web` vyžaduje sdílený svazek. Alternativa je ukládat obrázky do Postgresu jako `bytea` (jednoduchá záloha, horší výkon) nebo volitelné S3. | člověk, ovlivňuje část 3 | `/data/uploads` pro MVP 0, protože jedna replika stačí. Rozhodnutí zapsat do dokumentace, aby nikdo nečekal, že tři repliky budou fungovat bez sdíleného svazku. |
| O4 | **TypeScript 7 versus 5.9.** TypeScript 7.0.2 (nativní kompilátor) je od 2026-07-31 pod tagem `latest`. Je rychlejší, ale ekosystém pluginů a typových nástrojů (`tsd`, ESLint typed rules, Drizzle generika) na něj nemusí být připravený. | tým, v hodině 0 | Zkusit 7.0.2 v prvních třiceti minutách. Když cokoliv z `drizzle-kit`, `@hono/zod-openapi` nebo `vitest` selže, přepnout na 5.9.3 bez diskuse. Hackathon není místo na ladění kompilátoru. |
| ~~O5~~ | ~~**`AMBIGUOUS_DISPATCH_POLICY` výchozí hodnota.**~~ Mechanismus popisuje 4.10.1. | **uzavřeno** | **`fail` pro SES, `retry` pro obecné SMTP.** Původní doporučení `retry` pro oba providery se opíralo o deterministický `Message-ID`, který měl duplikáty odchytit na straně příjemce. Nález K3 části 4b ukázal, že **Amazon SES `Message-ID` vždy přepisuje vlastní hodnotou**, takže na hlavním provideru ta pojistka vůbec neexistuje a duplikát by dorazil jako dva různé e-maily. U obecného SMTP naše hlavička projde, takže tam `retry` platí dál. |
| O6 | **Rate limiting při víc replikách bez Redisu.** Backend `postgres` u `rate-limiter-flexible` znamená zápis do databáze na každý požadavek chráněného endpointu. U ingestion endpointu s 500 událostmi za sekundu to je 500 zápisů navíc. | člověk, až bude potřeba škálovat | MVP 0: `memory`, jedna replika. Až přijde potřeba víc replik, je to okamžik, kdy se Redis nebo Valkey vyplatí, přesně jak předjímá kapitola 3.5 hlavní specifikace. |
| O7 | **Retence auditního logu 24 měsíců** je můj odhad, ne právní stanovisko. Obsahuje IP adresy, tedy osobní údaje. | **čeká na právníka** | Návrh zůstává: 24 měsíců jako výchozí a konfigurovatelnost `AUDIT_RETENTION_MONTHS` zdůraznit v dokumentaci ke GDPR. Produkt otázku nezavírá, čeká se na právní posouzení. |
| O8 | **Chování při `MODE=all` a pádu jednoho procesu.** Zvolil jsem ukončení celého kontejneru, aby restart obnovil konzistentní stav. Alternativa je restart jen spadlého potomka, což udrží web naživu i při opakovaně padajícím senderu. | tým | Ukončit kontejner. Supervizor uvnitř kontejneru je zdroj situací, ve kterých healthcheck lže. |
