# Část 4b: Sender

Vlastník: subagent `part4b-sender`
Datum: 2026-07-31
Rozvíjí kapitoly hlavní specifikace: 3.1, 3.3, 3.5, 4.1, 4.2, 4.5, 6.6
Stav: koncept

---

## 0. Pro netechnického recenzenta

### Co tahle součástka dělá

Představte si, že marketér klikne na tlačítko "Odeslat" u kampaně pro padesát tisíc lidí. V ten okamžik se do databáze zapíše padesát tisíc řádků, jeden na každého příjemce. Každý řádek říká: "tomuhle člověku se má poslat tenhle mail, zatím se neposlal."

Sender je program, který ty řádky bere jeden po druhém a mění je ve skutečné e-maily. U každého doplní jméno konkrétního člověka do textu, přepíše odkazy tak, aby šlo změřit kliknutí, přilepí povinné hlavičky pro odhlášení, poskládá z toho zprávu a předá ji Amazonu (nebo běžnému poštovnímu serveru) k odeslání. Pak si do databáze poznamená, že tenhle konkrétní mail je hotový.

Dělá to pořád dokola, dokud nedojdou řádky. U padesáti tisíc příjemců a rychlosti, kterou nám Amazon dovolí (typicky několik desítek zpráv za sekundu), to trvá zhruba dvacet minut až hodinu.

Tři pravidla, která nesmí porušit:

1. **Každý mail odejde právě jednou.** Ne nula, ne dvakrát.
2. **Nesmí odesílat rychleji, než mu poskytovatel dovolí.** Když překročí povolenou rychlost, poskytovatel začne zprávy odmítat a v horším případě zablokuje celý účet.
3. **Musí přežít vypnutí.** Když někdo v půlce rozesílky restartuje server, musí se po nastartování plynule dopočítat tam, kde skončil.

### Proč je zrovna tahle jedna součástka psaná v jiném jazyce

Celý zbytek nástroje (obrazovky, editor šablon, import kontaktů, reporty) je napsaný v TypeScriptu, což je jazyk, ve kterém se dnes staví většina webových aplikací. Sender je napsaný v Go a je to jediná výjimka v celém projektu. Vypadá to jako rozmar, ale má to tři konkrétní důvody.

**Důvod první: jiný charakter práce.** Zbytek aplikace je "široký a mělký". Má stovky obrazovek a funkcí, každá se používá občas, a hlavní požadavek je, aby se daly rychle měnit. Sender je "úzký a hluboký". Umí jedinou věc, ta se skoro nikdy nemění, ale musí ji udělat padesát tisíckrát po sobě bez chyby a bez toho, aby mu došla paměť. Tohle jsou dva odlišné inženýrské problémy a každý má jiné optimální řešení.

**Důvod druhý: uživatel dostane jeden soubor.** Program v Go se dá zkompilovat do jediného souboru o velikosti pár megabajtů, který nepotřebuje nic dalšího nainstalovaného. Nemá závislosti, které by mohly zestárnout nebo se pohádat mezi sebou. Pro nástroj, jehož hlavní slib zní "spustíte jeden příkaz a do pěti minut vám to běží", to má hodnotu. Jinak by odesílání záviselo na stejném velkém a proměnlivém běhovém prostředí jako zbytek aplikace, a když by se v něm něco pokazilo, přestaly by chodit maily.

**Důvod třetí, nejdůležitější: bezpečnostní přepážka.** Sender má vlastní přístup do databáze s velmi omezenými právy. Vidí jen tabulku odchozích zpráv a nastavení kampaně. **Na tabulku kontaktů se vůbec nedostane.** Kdyby v senderu byla chyba, nemůže poškodit ani vyzradit databázi zákazníků, protože k ní fyzicky nemá klíč. Tohle jde udělat právě proto, že je to samostatný program, ne funkce uvnitř aplikace.

**Co z toho má uživatel:** menší instalaci, odesílání, které nespadne, když se něco pokazí v aplikaci, a záruku, že nejcitlivější data (adresář kontaktů) jsou mimo dosah té části systému, která komunikuje se světem.

**Co to stojí:** dva jazyky znamenají dvě znalosti pro přispěvatele a čtyři místa, kde se obě strany musí domluvit na společném formátu. Ta domluva je sepsaná jako závazný kontrakt hned na začátku projektu (kapitola 4.5 hlavní specifikace) a hlídá ji sada automatických testů, které pouští obě implementace proti stejným vstupům a porovnávají výstup.

### Proč je tak důležité, aby se mail neodeslal dvakrát

Zdálo by se, že poslat někomu newsletter dvakrát je drobná nepříjemnost. Není. Má to tři úrovně následků, každou horší než předchozí.

**Úroveň první, důvěra.** Když někomu dorazí ten samý mail dvakrát, vypadá to, že se nástroj pokazil. Uživatel nástroje pak nedůvěřuje ani reportům. Když má poslat mail na deset tisíc lidí, bude se bát kliknout.

**Úroveň druhá, stížnosti.** Lidé, kterým přijde stejný mail dvakrát, výrazně častěji kliknou na "označit jako spam". Není to nadsázka, je to nejčastější důvod stížnosti vůbec.

**Úroveň třetí, zablokování účtu.** Poskytovatelé odesílání (Amazon SES, ale i Google a Seznam na straně příjemce) sledují podíl stížností. Amazon má hranici 0,1 procenta. Když ji překročíte, dostanete varování, a když ji překračujete opakovaně, Amazon vám odesílání zastaví. V ten okamžik firma nemůže poslat žádný mail, včetně potvrzení objednávky. **Duplicitní rozesílka umí tuhle hranici překročit sama o sobě.** Proto to není detail, ale existenční otázka.

### Co se stane, když spadne server uprostřed rozesílky

Tohle je nejzajímavější místo celého návrhu, takže si zaslouží vysvětlení bez žargonu.

Odeslání jednoho mailu se skládá ze dvou kroků, které nejdou udělat najednou: (1) předat zprávu Amazonu a (2) zapsat si do databáze, že je hotovo. Mezi těmi dvěma kroky je zlomek sekundy. Když v tom zlomku vypadne proud, vznikne stav, kdy mail možná odešel a možná ne, a **z databáze to nejde poznat**.

Nabízí se jednoduché řešení: po restartu to zkusit znovu. To je špatně, protože pokud mail odešel, právě jsme ho poslali podruhé.

Nabízí se opačné řešení: po restartu to vzdát. To je taky špatně, protože pokud neodešel, člověk ho nikdy nedostane.

Náš návrh dělá tři věci najednou:

**Za prvé, zúží to okno na nejmenší možnou míru.** Těsně před předáním zprávy Amazonu si sender do databáze poznamená "začínám odesílat tuhle konkrétní zprávu" a počká, až je poznámka opravdu uložená. Teprve pak zprávu předá. Díky tomu po restartu vždycky víme, do které ze dvou skupin řádek patří:

- Řádek **bez poznámky**: odesílání ani nezačalo. Bezpečně se zkusí znovu. Tohle je drtivá většina případů.
- Řádek **s poznámkou**: nevíme. Do téhle skupiny spadne nanejvýš tolik zpráv, kolik jich sender zpracovává současně, ve výchozím nastavení třicet dva. Ne padesát tisíc, ne tisíc. Třicet dva, a to jen při tvrdém pádu.

**Za druhé, u těch nejistých se nehádá, ale zeptá se Amazonu.** Ke každé zprávě přikládáme neviditelnou visačku s naším vlastním číslem zprávy. Amazon nám pak sám hlásí zpět, co se se zprávou stalo ("přijata", "doručena", "odmítnuta") a naši visačku v hlášení uvádí. Takže když dorazí hlášení o zprávě, u které jsme nevěděli, jestli odešla, máme odpověď a označíme ji za odeslanou. Nejistota se tím ve většině případů rozpustí sama.

U běžných poštovních serverů, které nic nehlásí zpět, tahle cesta neexistuje a rozhodnout se musí naslepo.

**Za třetí, zbytek se řídí jedním přepínačem, který si zvolí provozovatel.** Buď "raději poslat znovu" (riskuje se vzácný duplikát), nebo "raději neposlat" (v aplikaci se zobrazí "3 zprávy skončily v nejistém stavu" s tlačítkem "odeslat znovu"). Ať se zvolí cokoli, **druhý pokus je poslední**: zpráva, která skončí v nejistotě podruhé, se už nikdy automaticky neopakuje, aby nemohla kroužit donekonečna.

Naše doporučení je zvolit "raději neposlat" u Amazonu a "raději poslat znovu" u běžného poštovního serveru. Důvod je konkrétní: u běžného serveru umíme do zprávy vložit skryté pořadové číslo, podle kterého většina poštovních schránek duplikát sama zahodí. Ověřili jsme ale, že **Amazon tohle číslo přepisuje vlastním**, takže tam ta pojistka nefunguje a duplikát by dorazil.

Shrnuto jednou větou: **program nikdy neodešle znovu nic, u čeho nemá důkaz, že se to poprvé neodeslalo, s výjimkou jednoho jediného opakování, které si provozovatel může vypnout.**

### Kompromisy a co to znamená pro provoz

| Rozhodnutí | Co se tím získá | Co to stojí |
|---|---|---|
| Sender nevidí do tabulky kontaktů | Chyba v senderu nemůže poškodit ani vyzradit adresář | Aplikace musí do každého řádku zprávy předem uložit kopii dat, která šablona potřebuje. Zabere to místo, typicky pár set bajtů na příjemce. |
| Nejistá zpráva se opakuje nejvýš jednou, a i to jde vypnout | Zpráva nemůže kroužit donekonečna a duplikát je nanejvýš jeden | Při volbě "raději neposlat" může po tvrdém pádu několik lidí mail nedostat, dokud to uživatel nepotvrdí |
| Publikum se "zmrazí" ve chvíli odeslání | Seznam příjemců se uprostřed rozesílky nemění, počty v reportu sedí | Kdo se odhlásí v průběhu rozesílky, může ještě dostat jeden mail. Řeší se průběžnou kontrolou na straně aplikace, ale zprávy, které už sender vzal do práce, propadnou. Maximálně jich je tolik, kolik je velikost dávky. |
| Pauza kampaně dokončí rozpracovanou dávku | Nikdy se nic neztratí ani nezdvojí | Po kliknutí na "Pozastavit" ještě může odejít až 500 zpráv. Musí to být napsané v UI, aby to uživatele nepřekvapilo. |
| Rychlost se dělí mezi běžící sendery napevno podle konfigurace | Nepotřebuje se žádná další koordinační služba | Když někdo spustí víc senderů, než má nastaveno, poskytovatel začne odmítat. Sender to pozná a sám zpomalí, takže to nic nerozbije, jen to bude pomalejší. |

### Otázky pro recenzenta

Na tyhle otázky jde odpovědět bez znalosti kódu a jejich zodpovězení mění návrh:

1. **Má se výchozí volba u nejistých zpráv lišit podle poskytovatele?** Doporučujeme "raději neposlat" u Amazonu a "raději poslat znovu" u běžného poštovního serveru, protože pojistka proti duplikátům funguje jen u druhého z nich. Je přijatelné, aby se nástroj choval u dvou poskytovatelů různě, nebo je srozumitelnější jedno chování pro oba?
2. **Existuje typ zákazníka, pro kterého je chybějící mail horší než duplikát?** Například e-shop rozesílající slevové kódy s platností do půlnoci. Pokud ano, přepínač musí být viditelný v nastavení, ne jen v konfiguračním souboru.
3. **Pauza kampaně dokončí rozpracovanou dávku, tedy až 500 zpráv.** Chceme místo toho možnost "okamžité zastavení", které rozpracovanou dávku zahodí, i za cenu toho, že tyhle zprávy skončí jako nejisté?
4. **Testovací odeslání ve výchozím nastavení nezapočítává otevření a kliknutí.** Souhlasí to s očekáváním? Alternativa je počítat je a označit v reportu.
5. **Zprávy, u kterých selže doplnění dat do šablony**, se označí jako neodeslané a rozesílka pokračuje dál. Teprve když takto selže víc než pět procent z prvního tisíce zpráv, kampaň se pozastaví. Je pět procent správná hranice? Při kampani na padesát tisíc lidí to znamená, že se v nejhorším případě odešle padesát vadných mailů, než se to zastaví.
6. **Sender je jediná část systému, která má vlastní přístupové údaje do databáze.** Nastavení je o jeden krok složitější. Stojí bezpečnostní přínos za to i pro nejmenší nasazení, kde všechno běží v jednom kontejneru? Náš návrh říká ano, bez výjimky: když se oddělený přístup nepodaří, sender vůbec nenastartuje. Vypnout to nejde, protože tichá výjimka by tu ochranu zrušila, aniž by si toho kdokoli všiml.

---

## 1. Rozsah

### 1.1 Co tato část vlastní

Sender je samostatná binárka v Go (`apps/sender`), spouštěná jako `MODE=sender` v jedné sdílené Docker image (hlavní specifikace 4.1). Vlastní:

- Konzumaci outboxu `messages`: claim dávek přes `SELECT ... FOR UPDATE SKIP LOCKED`, timeout na uvolnění zaseknutých řádků, obnovu po restartu, reaper
- Idempotenci odeslání, tedy záruku, že se jedna zpráva nikdy neodešle dvakrát
- Fázi 2 renderu: Liquid interpolaci per příjemce nad `compiled_html`, `compiled_text`, `subject` a `preheader`
- Dosazení trackovacích tokenů do předpřipravených značek, vložení open pixelu, sestavení odhlašovacího odkazu
- Sestavení MIME zprávy a úplný seznam hlaviček
- Dispatch přes Amazon SES v2 a přes obecné SMTP
- Throttling, klasifikaci chyb, retry, backoff, circuit breaker
- Architekturu souběhu, graceful shutdown, health a metriky
- Konfiguraci senderu a jeho omezená databázová práva

### 1.2 Co tato část vědomě nevlastní

| Oblast | Vlastník |
|---|---|
| Životní cyklus kampaně, plánování, materializace publika do outboxu | 4a |
| Kompilace šablony (blokový JSON na HTML a text), extrakce merge tagů, validátor Liquidu | 3 |
| Konfigurace providerů, ověření domén, SPF/DKIM/DMARC, kvóty, sandbox | 4a |
| Příjem událostí od providera (SNS), normalizace, klasifikace bounců, suppression | 4a |
| Formát trackovacích tokenů (sender je pouze vyrábí podle cizí definice) | 5 |
| Formát šifrování credentials, outbox jako kontrakt, konvence schématu | 1 |
| Reporty, agregace, timeline | 5 |

### 1.3 Vztah k části 4a

4a je **producent** outboxu, 4b je **konzument**. Jediné rozhraní mezi nimi je tabulka `messages` a čtyři sloupce tabulky `campaigns`. Žádné HTTP volání, žádná sdílená knihovna, žádná fronta.

DDL tabulky `messages` popisuji já, protože claim dotaz a index musí být navržené společně. 4a si ho převezme beze změny a doplní jen to, co potřebuje pro materializaci.

---

## 2. Datový model

### 2.1 Tabulka `messages` (outbox)

**Zdroj pravdy je kontrakt 4.10.1 části 1.** Následující DDL je jeho převzetí plus dva sloupce, které kontrakt výslovně dovoluje doplnit ("Část 4 smí přidávat sloupce a indexy"). Sender do téhle tabulky nikdy nevkládá ani z ní nemaže řádky, pouze mění stav.

```sql
CREATE TABLE messages (
  -- KONTRAKTNÍ SLOUPCE (část 1, sekce 4.10.1). Neměnit název, typ ani sémantiku.
  id                  uuid        NOT NULL DEFAULT uuidv7(),
  workspace_id        uuid        NOT NULL,
  campaign_id         uuid        NOT NULL,
  contact_id          uuid,                     -- kontrakt má NOT NULL, viz rozpor K9
  email               text        NOT NULL,
  render_data         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status              text        NOT NULL DEFAULT 'pending',
  claimed_by          text,
  claimed_at          timestamptz,
  claim_expires_at    timestamptz,
  attempts            smallint    NOT NULL DEFAULT 0,
  dispatch_started_at timestamptz,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  provider_message_id text,
  sent_at             timestamptz,
  error_code          text,
  error_detail        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- DOPLŇKY ČÁSTI 4, kontrakt je povoluje
  is_test             boolean     NOT NULL DEFAULT false,
  ambiguous_count     smallint    NOT NULL DEFAULT 0,

  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_messages__status
    CHECK (status IN ('pending','claimed','sent','failed','skipped')),
  CONSTRAINT ck_messages__attempts CHECK (attempts >= 0 AND attempts <= 100),
  CONSTRAINT ck_messages__sent_has_timestamp
    CHECK (status <> 'sent' OR sent_at IS NOT NULL)
) PARTITION BY RANGE (created_at);
```

**`is_test`** odděluje testovací odeslání. Kontrolní otázka 19 ze zadání ho vyžaduje, kontrakt ho nemá.

**`ambiguous_count`** je čítač nejednoznačných odeslání. Kontrakt v próze požaduje, aby zpráva při druhém nejednoznačném průchodu vždy skončila na `failed`, ale rozpoznávat to podle `error_code` nefunguje, protože kterýkoliv další neúspěch `error_code` přepíše. Samostatný čítač to řeší jednoznačně. Viz rozpor K8.

**`error_code` a `error_detail` jsou `text`, ne `jsonb`.** Přebírám z kontraktu. `error_code` nese kód z katalogu 4.2, `error_detail` nese `"<kód providera>: <hláška>"` zkrácené na 1 000 znaků.

**Klíč `(id, created_at)`:** pořadí je z kontraktu a partitioning po měsících ho vyžaduje. Sender nosí `created_at` s sebou od claimu, protože ho vrací `RETURNING`, a používá ho v každém následném `WHERE`. Bez toho by dotaz prošel všechny partition.

### 2.2 Indexy

Přebírám z kontraktu 4.10.1 včetně názvů a přidávám dva vlastní.

```sql
-- KONTRAKTNÍ
CREATE INDEX idx_messages__claimable ON messages (next_attempt_at, id)
  WHERE status = 'pending';
CREATE INDEX idx_messages__stuck ON messages (claim_expires_at)
  WHERE status = 'claimed';
CREATE INDEX idx_messages__campaign_status ON messages (campaign_id, status);
CREATE UNIQUE INDEX uq_messages__campaign_contact
  ON messages (campaign_id, contact_id, created_at);

-- DOPLŇKY ČÁSTI 4

-- Testovací odeslání se claimuje napříč kampaněmi a má přednost.
-- Bez samostatného indexu by test čekal za probíhající kampaní.
CREATE INDEX idx_messages__test_claimable ON messages (next_attempt_at)
  WHERE status = 'pending' AND is_test = true;

-- Párování událostí od providera na naši zprávu. Vlastní 4a, sender sem jen zapisuje.
CREATE INDEX idx_messages__provider_message_id ON messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Heartbeat obnovuje claimy jedné instance. Viz rozpor K12.
CREATE INDEX idx_messages__claimed_by ON messages (claimed_by)
  WHERE status = 'claimed';
```

**Poznámka k `uq_messages__campaign_contact`.** Index obsahuje `created_at`, protože partitionovaná tabulka to vyžaduje. Tím ale přestává být zárukou, kterou jeho jméno a komentář v kontraktu slibují: dvě materializace téže kampaně v různých okamžicích mají různé `created_at` a obě projdou. Viz rozpor K6 a požadavek P4a.11.

**Fillfactor a autovacuum.** Řádek `messages` se během života nejméně třikrát aktualizuje (claim, marker, výsledek), což generuje mrtvé verze. Nastavení patří na **každou partition zvlášť**, protože se z rodiče na existující partition nepropíše. Zakládání partition vlastní `createMonthlyPartitions` z části 1, viz požadavek P1.3.

```sql
ALTER TABLE messages_y2026m08 SET (
  fillfactor = 70,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);
```

### 2.3 Co sender čte a nikdy nemění

Z tabulky `campaigns` čte a drží v cache (kapitola 3.15):

```
id, workspace_id, status, subject, preheader,
from_name, from_email, reply_to,
compiled_html, compiled_text, revision,
provider_id, track_opens, track_clicks
```

Z tabulky `sending_providers` čte `id, workspace_id, config_encrypted, quota_max_send_rate, verified_at`. Sloupec `quota_max_send_rate` aktualizuje 4a každých 15 minut z `GetAccount` a je **závazným zdrojem rychlosti** (3.11.1).

Dešifrovaný obsah `config_encrypted` má tvar dohodnutý s částí 4a. Celá konfigurace je uvnitř obálky, sender ji neskládá ze dvou zdrojů. Rozlišovač je pole `kind`, ne `type`.

```jsonc
// kind = "ses"
{ "kind": "ses", "region": "eu-central-1",
  "access_key_id": "AKIA...", "secret_access_key": "...",
  "configuration_set_name": "openengage-ws-7f3a",   // povinné, viz 3.9.3
  "sns_topic_arn": "arn:aws:sns:...",               // sender nepoužívá
  "max_send_rate": 50,                              // jen fallback, viz 3.11.1
  "max_24h_send": 50000 }                           // sender nepoužívá

// kind = "smtp"
{ "kind": "smtp", "host": "smtp.example.com", "port": 587,
  "username": "apikey", "password": "...",
  "encryption": "starttls",                         // starttls | tls | none
  "max_send_rate": 10, "max_connections": 4,
  "max_messages_per_connection": 100 }
```

Pole `insecure_skip_verify` a `allow_insecure_auth`, se kterými počítá 3.10.2, ve schématu 4a **nejsou**. Buď se doplní, nebo sender obě chování natvrdo zakáže. Viz požadavek P4a.22.

Z tabulky `workspaces` čte `id, deleted_at`, protože claim dotaz kontroluje měkké smazání projektu (kontrakt 4.10.1).

Tabulku `campaign_links` v běžném režimu **nečte**, protože přepis odkazů řeší předkompilovaná značka (kapitola 3.7). Potřebuje ji jen v režimu `track_clicks = false`, a i tam jen tehdy, pokud fáze 1 značky generuje, viz požadavek P3.2.

Sender nikdy nečte: `contacts`, `lists`, `list_subscriptions`, `suppressions`, `consents`, `web_events`, `users`, `sessions`, `api_keys`, `audit_log`, `segments`, `templates`.

**Zapisuje** na dvě místa mimo `messages`:

| Kam | Co | Kdy |
|---|---|---|
| `campaigns (status, pause_reason)` | pozastavení kampaně | circuit breaker, kapitola 3.13 |
| `message_events` (jen `INSERT`) | `render_warning` | chybějící hodnota v `render_data`, oříznutý cyklus (kontraktní politika 4.10.2) |
| `message_events` (jen `INSERT`) | `circuit_breaker_open` | sender otevřel pojistku a pozastavil kampaň (3.13) |

**Sender do `message_events` nikdy nezapisuje typy `open` a `click`**, přestože na to podle grantů právo má. Zapisuje je výhradně aplikace z trackovacích endpointů. Kdyby je psal i sender, rozešly by se unikátní počty v reportech. Požadavek části 5, přebírám ho beze změny.

Zápis do `message_events` je novinka oproti mému konceptu; grant na něj dává kontrakt 4.10.1. Schéma tabulky vlastní část 5, potřebuji od ní sloupce a povolené hodnoty `type`, viz požadavek P5.10.

Zápis do `campaigns` vyžaduje `UPDATE`, které kontraktní role **nemá** (má tam jen `SELECT`). Viz požadavek P1.10.

### 2.4 Databázová role senderu

**Kontraktní, přebírám z 4.10.1 části 1.** Založení role a přidělení práv jsou **dvě oddělené věci na dvou různých místech**, a to schválně.

**Založení role je mimo migrace.** Migrátor záměrně nemá `CREATEROLE` a heslo do verzovaného souboru nepatří. Roli zakládá `docker/initdb/10-roles.sql` u přibalené databáze, u externí databáze je to dokumentovaný ruční krok správce.

```sql
-- docker/initdb/10-roles.sql, NE migrace
CREATE ROLE openengage_sender LOGIN PASSWORD :'sender_password';
```

**Přidělení práv je v migraci** v `packages/db`, protože se týká tabulek, které migrátor vlastní, a protože se tím práva verzují společně se schématem. Nová tabulka tak nemůže zůstat s nesprávně nastavenými právy. Migrace je obalená tak, aby prošla i v testovacím prostředí, kde role neexistuje:

```sql
-- migrace v packages/db
DO $$
BEGIN
  GRANT USAGE ON SCHEMA public TO openengage_sender;

  GRANT SELECT, UPDATE ON messages          TO openengage_sender;
GRANT SELECT           ON campaigns         TO openengage_sender;
GRANT SELECT           ON sending_providers TO openengage_sender;
GRANT SELECT           ON campaign_links    TO openengage_sender;
GRANT SELECT           ON workspaces        TO openengage_sender;
  GRANT INSERT           ON message_events    TO openengage_sender;
  -- Žádná práva na contacts, web_events, users, sessions, api_keys, audit_log.

  ALTER DEFAULT PRIVILEGES FOR ROLE openengage_migrator IN SCHEMA public
    REVOKE ALL ON TABLES FROM openengage_sender;
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'role openengage_sender neexistuje, granty se přeskakují';
END $$;
```

Tohle rozdělení jsem měl v konceptu jako otevřenou otázku a část 1 ho potvrdila v uvedené podobě. Otázka je tím uzavřená a v kapitole 12 už není.

Sender **nemá** `DELETE` nikde a **nemá** `INSERT` do `messages`. Nepodléhá RLS, protože pracuje napříč workspaces; izolaci u něj zajišťuje to, že nemá přístup k ničemu, co by šlo mezi workspaces zaměnit.

Oproti mému konceptu jsou tady tři tabulky navíc, každá má důvod:

| Tabulka | Proč ji sender potřebuje |
|---|---|
| `workspaces` | claim dotaz kontroluje `w.deleted_at IS NULL`, aby se neposílalo z projektu, který uživatel smazal |
| `campaign_links` | rezerva pro režim `track_clicks = false`, viz 3.7.1 |
| `message_events` (jen `INSERT`) | zápis `render_warning` podle politiky 4.10.2 |

**Návrh na zpřísnění, viz rozpor K18.** `GRANT SELECT, UPDATE ON messages` dává senderu právo přepsat i `email` a `render_data`, což nikdy nepotřebuje. PostgreSQL umí sloupcové granty a stojí to jeden řádek navíc:

```sql
GRANT UPDATE (status, claimed_by, claimed_at, claim_expires_at, dispatch_started_at,
              attempts, next_attempt_at, provider_message_id, sent_at,
              error_code, error_detail, ambiguous_count, updated_at)
  ON messages TO openengage_sender;
```

**RLS: bez permisivní politiky sender nevidí ani jeden řádek.** Role `openengage_sender` nemá `BYPASSRLS` a nikdy nenastavuje kontext workspace, protože pracuje napříč projekty. Na tabulce s row level security by jí tedy každý `SELECT` vrátil **nula řádků**, claim dotaz by trvale vracel prázdnou dávku a nikdy by se neodeslalo nic. Chybu by přitom nic nenahlásilo: prázdná dávka je legitimní stav (3.2).

Řeší se permisivní politikou `sender_bypass` na **každé** tabulce, na kterou má sender grant, tedy `messages`, `campaigns`, `sending_providers`, `campaign_links`, `workspaces`, `suppressions` a `message_events`. Nález přišel od části 4a a vlastní ho část 1.

Důsledek pro testy, který je stejně důležitý jako oprava sama: **testovací scénáře `OB-01` až `OB-11` musí běžet pod rolí `openengage_sender`.** Kdyby běžely pod migrátorem nebo aplikační rolí, tuhle chybu by dokonale zamaskovaly, protože obě role RLS obcházejí. Promítl jsem to do akceptačních kritérií AK-20.5.

**Partitioning a práva.** Kontrakt uvádí, že nová partition je pro sender neviditelná, dokud jí migrátor nepřidělí granty, a že to `createMonthlyPartitions` dělá automaticky. Je to akceptační kritérium AK-20.2, protože na tom stojí celý bezpečnostní model a je to přesně ta věc, která se pokazí až v pátém měsíci provozu.

**Režim `MODE=all`.** Podle konfigurační tabulky 4.9 se `DATABASE_URL_SENDER` při `MODE=all` dopočítá z `DATABASE_URL` záměnou uživatele za `openengage_sender`. Role tedy musí existovat i v nejmenším nasazení. Když se připojení pod ní nepovede, sender **nenastartuje** a vypíše, že role chybí a jak ji založit. Tiché spadnutí zpět na aplikační roli by bezpečnostní hranici zrušilo, aniž by si toho kdokoliv všiml.

## 3. Doménová logika

### 3.1 Architektura procesu a souběh

Jeden proces, jedna binárka, následující goroutiny:

```
main
 ├─ konfigurace: načtení z env, validace, fail fast, exit code 78 (EX_CONFIG)
 ├─ pgxpool nad DATABASE_URL_SENDER: MaxConns = SENDER_CONCURRENCY + 4
 ├─ signal handler: SIGTERM, SIGINT  → zruší kořenový kontext
 ├─ recovery pass: jednorázově při startu (3.3)
 ├─ campaignPoller   1 goroutina, interval SENDER_POLL_INTERVAL_MS (1 000 ms)
 ├─ reaper           1 goroutina, interval 30 s (kontraktní hodnota)
 ├─ heartbeat        1 goroutina, interval SENDER_CLAIM_TTL_SECONDS / 3 (100 s)
 ├─ claimer          1 goroutina  ──► chan *Message (buffer 2 × SENDER_CONCURRENCY)
 ├─ dispatch worker  N goroutin, N = SENDER_CONCURRENCY (výchozí 32)
 └─ http server      1 goroutina: /healthz, /readyz na HEALTH_PORT, /metrics
```

**Proč právě takhle.** Jeden claimer znamená, že se dávky neberou souběžně a `SKIP LOCKED` prakticky nikdy nemusí uvnitř jednoho procesu nic přeskakovat. Souběh je až v dispatchi, kde je práce IO-bound (čekání na SES nebo SMTP). Při výchozích 32 workerech a typické latenci SES 80 až 250 ms je teoretická propustnost 128 až 400 zpráv za sekundu, tedy s rezervou nad běžnou kvótou SES.

**Souběžnost** řídí `SENDER_CONCURRENCY`, výchozí 32, rozsah 1 až 1024 (hodnoty z části 1, sekce 4.9). Sender při startu ověří, že se pgxpool dopočítá na `SENDER_CONCURRENCY + 4` a že to nepřekročí `max_connections` databáze; při 1024 workerech je to 1028 spojení, což běžný Postgres odmítne. Proto se při `SENDER_CONCURRENCY > 200` vypíše varování s doporučením postavit před databázi PgBouncer.

**Proč ne worker pool per kampaň.** Kampaně jsou téměř vždy jedna nebo dvě naráz. Sdílený pool s round robin claimem (3.2) dává stejnou férovost s desetinou složitosti.

Go rozhraní, bez implementace:

```go
// Dispatcher je jediná abstrakce nad providery. SES i SMTP implementují totéž.
type Dispatcher interface {
    // Dispatch odešle jednu hotovou MIME zprávu.
    // Vrací provider message ID a chybu klasifikovanou přes Classifier.
    Dispatch(ctx context.Context, msg *OutgoingMessage) (providerMessageID string, err error)
    Close() error
    Name() string // "ses" nebo "smtp", do metrik a chybových kódů
}

type MessageKey struct {
    ID        uuid.UUID
    CreatedAt time.Time // partition key, nosí se od claimu, viz 2.1
}

type OutgoingMessage struct {
    Key         MessageKey
    WorkspaceID uuid.UUID
    CampaignID  uuid.UUID
    From        mail.Address
    ReplyTo     *mail.Address
    To          string   // holá adresa, bez display name
    ReturnPath  string   // envelope MAIL FROM
    Raw         []byte   // hotová MIME zpráva včetně hlaviček
    Tags        []Tag    // jen SES
    ConfigSet   string   // jen SES
}

// Renderer provádí fázi 2 renderu. Jedna instance na worker, viz 3.6.
type Renderer interface {
    Render(ctx context.Context, data map[string]any) (*RenderedMessage, []RenderWarning, error)
}

type RenderedMessage struct {
    Subject, Preheader, HTML, Text string
}

type RenderWarning struct {
    Code string // render_warning kód podle 4.10.2 části 1
    Path string // cesta, která chyběla
}

// Classifier rozhoduje o osudu chyby. Viz 3.12.
type Classifier interface{ Classify(err error) Verdict }

type Verdict struct {
    Class        ErrorClass // Retryable | Permanent | Fatal
    Code         string     // kód z katalogu 4.2
    ProviderCode string     // syrový kód providera, jde do error_detail
    RetryAfter   *time.Duration
}
```

### 3.2 Claim dávky z outboxu

**Aktivní kampaně.** Každých `SENDER_POLL_INTERVAL_MS` se načte seznam kampaní k odbavení:

```sql
SELECT c.id, c.workspace_id, c.subject, c.preheader,
       c.from_name, c.from_email, c.reply_to,
       c.compiled_html, c.compiled_text, c.revision,
       c.provider_id, c.track_opens, c.track_clicks
FROM campaigns c
JOIN workspaces w ON w.id = c.workspace_id
WHERE c.status IN ('queueing', 'sending')
  AND w.deleted_at IS NULL AND c.deleted_at IS NULL
ORDER BY c.id;
```

**Odesílat jde už ve stavu `queueing`**, ne až od `sending`. Přebírám z připravované změny kontraktu. Materializace velkého publika trvá minuty a nemá smysl čekat s odesíláním, až doběhne celá.

**Dvoukrokový claim.** Původní kontraktní podoba měla filtr na běžící kampaň až v joinu, zatímco index `idx_messages__claimable` se řadí podle `next_attempt_at` napříč všemi kampaněmi. Jedna pozastavená kampaň s milionem `pending` řádků na začátku indexu by tak zastavila odesílání **všech ostatních**: skenování by procházelo její řádky, join by je zahazoval a dávka by se vracela prázdná. Proto se nejdřív zjistí seznam aktivních kampaní (dotaz výše) a teprve pak se claimuje **po jedné kampani** s `campaign_id = $4`, jak popisuje claim dotaz níže. Tenhle tvar jsem měl v dokumentu od začátku jako doplněk; připravovaná změna kontraktu ho potvrzuje a dělá z něj normu.

Claimer nad tímhle seznamem jede **round robin**: vezme jednu dávku z první kampaně, pak z druhé, a tak dokola. Kampaň, která nevrátí žádný řádek, vypadne z rotace do dalšího pollu.

**Claim dotaz.** Kontraktní znění z 4.10.1 části 1, s jednou opravou a jedním doplňkem.

```sql
WITH claimable AS (
  SELECT m.id, m.created_at
  FROM messages m
  JOIN campaigns c   ON c.id = m.campaign_id
  JOIN workspaces w  ON w.id = m.workspace_id
  WHERE m.status = 'pending'
    AND m.next_attempt_at <= now()
    AND m.campaign_id = $4          -- DOPLNĚK: round robin po kampaních
    AND m.is_test = false
    AND c.status = 'sending'
    AND w.deleted_at IS NULL
  ORDER BY m.next_attempt_at, m.id
  LIMIT $2
  FOR UPDATE OF m SKIP LOCKED       -- OPRAVA: zamykací klauzule patří ZA LIMIT
)
UPDATE messages m
SET status           = 'claimed',
    claimed_by       = $1,
    claimed_at       = now(),
    claim_expires_at = now() + make_interval(secs => $3),
    updated_at       = now()
FROM claimable cl
WHERE m.id = cl.id AND m.created_at = cl.created_at
RETURNING m.id, m.created_at, m.workspace_id, m.campaign_id, m.contact_id,
          m.email, m.render_data, m.attempts;
```

| Parametr | Zdroj | Výchozí |
|---|---|---|
| `$1` `claimed_by` | `SENDER_ID` | hostname a PID, max 64 znaků |
| `$2` velikost dávky | `SENDER_BATCH_SIZE` | 500 |
| `$3` TTL claimu v sekundách | `SENDER_CLAIM_TTL_SECONDS` | 300 |
| `$4` kampaň | z rotace campaignPolleru | |

**Oprava pořadí klauzulí.** Kontrakt uvádí `FOR UPDATE OF m SKIP LOCKED` **před** `LIMIT $2`. Tak to PostgreSQL nepřijme, gramatika `SELECT` má zamykací klauzuli až za `LIMIT`, `OFFSET` a `FETCH`. Podrobně v rozporu K1. Uvádím tady opravené znění, protože jinak by se z dokumentu nedalo stavět.

Poznámky, které nejsou samozřejmé:

- `FOR UPDATE OF m` uzamyká jen `messages`, ne `campaigns` a `workspaces`. Bez `OF m` by se zamykaly i řádky kampaně a dva sendery by se navzájem blokovaly. To je v kontraktu dobře odchycené.
- Vnitřní `SELECT` vrací jen `(id, created_at)`. `render_data` může být několik set bajtů a nemá smysl ho tahat dvakrát.
- Celý dotaz běží ve **vlastní krátké transakci**, která se okamžitě commituje. Zámky se drží milisekundy, ne po dobu odesílání dávky. Ochranu po commitu zajišťuje `claim_expires_at` a heartbeat, ne databázový zámek.
- `ORDER BY next_attempt_at, id` je deterministické a využívá `idx_messages__claimable`. Bez `id` by pořadí při shodném `next_attempt_at` (což je běžné, materializace zapisuje hromadně) nebylo stabilní.

**Doplněk `campaign_id = $4`.** Kontraktní dotaz kampaň nefiltruje a bere zprávy napříč všemi. Přidávám filtr ze dvou důvodů: aby šlo dělat férovou rotaci mezi souběžnými kampaněmi a aby se zprávy jedné kampaně zpracovávaly v souvislých blocích, což umožňuje cachovat zparsované šablony a `Dispatcher` na jednu kampaň. Bez toho by se každá zpráva v dávce mohla týkat jiné kampaně a jiného providera.

Kontraktní index `idx_messages__claimable (next_attempt_at, id) WHERE status = 'pending'` filtr podle `campaign_id` nepokrývá. Při jedné běžící kampani to nevadí (index scan podle `next_attempt_at` narazí na správné řádky hned), při mnoha souběžných kampaních by bylo lepší `(campaign_id, next_attempt_at, id)`. Nechávám kontraktní index a zaznamenávám to jako výkonovou poznámku, ne jako rozpor: měnit kontraktní index kvůli případu, který v MVP 0 nenastane, se nevyplatí.

**Krátká dávka je normální stav, ne chyba.** Claim může vrátit méně řádků, než kolik jich `LIMIT` žádá, a to ze dvou běžných důvodů: outbox kampaně dochází, nebo si zbytek vzal jiný sender. Sender takovou dávku **normálně zpracuje a jde znovu**. Konec práce na kampani poznává **jen z nuly vrácených řádků**, nikdy z počtu menšího než `SENDER_BATCH_SIZE`.

Žádná obezlička typu "žádej víc řádků a ořež je v aplikaci" se nepíše. Není proti čemu, a zaváděla by nedeterminismus do dotazu, který je jinak jednoduchý.

**`FETCH FIRST ... WITH TIES` je v claim dotazu zakázané** a nikde ho nepoužíváme. Kombinace `WITH TIES` se zamykacími klauzulemi má v PostgreSQL známé problémy, `LIMIT` ne.

Prohlášení kampaně za dokončenou nedělá sender, ale job `campaign.watchdog` části 4a, protože sender nevidí kampaň jako celek (P4a.9).

**Velikost dávky.** `SENDER_BATCH_SIZE`, výchozí **500**, rozsah 1 až 5 000.

Při kvótě 50 zpráv za sekundu je 500 zpráv 10 sekund práce. To je dost na amortizaci jednoho claim dotazu (jednotky milisekund) a zároveň dost málo na to, aby pauza kampaně zabrala do 10 sekund a aby při pádu zůstalo v nejistotě málo řádků.

**Testovací odeslání** se claimuje samostatně a přednostně, na začátku každého tiku:

```sql
WITH claimable AS (
  SELECT m.id, m.created_at
  FROM messages m
  JOIN campaigns c  ON c.id = m.campaign_id
  JOIN workspaces w ON w.id = m.workspace_id
  WHERE m.status = 'pending' AND m.is_test = true
    AND m.next_attempt_at <= now()
    AND w.deleted_at IS NULL
  ORDER BY m.next_attempt_at, m.id
  LIMIT 20
  FOR UPDATE OF m SKIP LOCKED
)
UPDATE messages m
SET status='claimed', claimed_by=$1, claimed_at=now(),
    claim_expires_at=now() + make_interval(secs => $3), updated_at=now()
FROM claimable cl
WHERE m.id = cl.id AND m.created_at = cl.created_at
RETURNING m.id, m.created_at, m.workspace_id, m.campaign_id, m.contact_id,
          m.email, m.render_data, m.attempts;
```

Všimněte si, že tenhle dotaz **nekontroluje `c.status = 'sending'`**. Je to záměr: testovací odeslání musí fungovat u kampaně ve stavu `draft`, jinak nemá smysl. Kontrola smazaného workspace zůstává.

### 3.3 Heartbeat, reaper a obnova po restartu

**Heartbeat.** Každých `SENDER_CLAIM_TTL_SECONDS / 3` (100 s) instance prodlouží claim všech zpráv, které drží:

```sql
UPDATE messages
SET claim_expires_at = now() + make_interval(secs => $2), updated_at = now()
WHERE status = 'claimed' AND claimed_by = $1;
```

Kontrakt uvádí navíc `AND id = ANY($3)`. Vypouštím to, protože primární klíč je `(id, created_at)` a podmínka jen nad `id` neumožní prořezání partition, takže dotaz sáhne na všechny. Instance přitom drží právě a jen to, co sama claimla, takže filtr podle `claimed_by` je sémanticky totožný a s indexem `idx_messages__claimed_by` je to jeden levný scan. Zdůvodnění v rozporu K12.

Bez heartbeatu by dávka 500 zpráv u pomalého providera mohla trvat déle než TTL claimu a reaper by ji sebral sám sobě.

**Reaper.** Běží v každé instanci senderu každých 30 sekund. Dva dotazy, a rozdíl mezi nimi je jádro celé idempotence.

```sql
-- A) Prokazatelně neodeslané: odesílání ani nezačalo, návrat do fronty je bezpečný.
--    Kontraktní znění, přebírám beze změny.
UPDATE messages
SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
    claim_expires_at = NULL, next_attempt_at = now(), updated_at = now()
WHERE status = 'claimed' AND claim_expires_at < now()
  AND dispatch_started_at IS NULL
RETURNING id;

-- B) Rozpracované: nikdy se neopakují automaticky bez rozhodnutí.
--    OPRAVENÉ znaménko a doplněný čítač, viz rozpory K2 a K8.
UPDATE messages
SET status = CASE WHEN ambiguous_count >= 1 OR $1 = 'fail'
                  THEN 'failed' ELSE 'pending' END,
    ambiguous_count = ambiguous_count + 1,
    error_code      = 'ambiguous_dispatch',
    error_detail    = 'dispatch started but result was never recorded',
    claimed_by = NULL, claimed_at = NULL, claim_expires_at = NULL,
    next_attempt_at = now(),
    updated_at = now()
WHERE status = 'claimed'
  AND claim_expires_at < now() - make_interval(secs => $2)   -- MINUS, ne plus
  AND dispatch_started_at IS NOT NULL
  AND provider_message_id IS NULL
RETURNING id;
```

**Dvě opravy proti kontraktu, obě podstatné:**

1. **Znaménko v dotazu B.** Kontrakt má `claim_expires_at < now() + make_interval(...)`. Přičtení posouvá práh do budoucnosti, takže dotaz zabírá **víc** řádků, ne méně, přesně opačně, než tvrdí jeho vlastní komentář. Při výchozích hodnotách by na každém tiku ukradl každou zprávu, kterou sender právě odesílá. Rozbor v rozporu K2. Správně je `now() - make_interval(...)`.
2. **Čítač `ambiguous_count`.** Kontrakt v próze chce, aby druhý nejednoznačný průchod vždy skončil na `failed`, ale normativní SQL to nedělá a rozpoznání podle `error_code` je nespolehlivé. Rozbor v rozporu K8.

`$2` je dvojnásobek `SENDER_CLAIM_TTL_SECONDS`, tedy 600 s. Nejednoznačná zpráva se uvolňuje později než běžná, aby se pomalu odpovídající provider nepletl s mrtvým senderem.

`$1` je `AMBIGUOUS_DISPATCH_POLICY`. **Výchozí hodnota je rozhodnutá a závisí na typu provideru:**

| Provider | Výchozí | Proč |
|---|---|---|
| SES | **`fail`** | SES `Message-ID` přepisuje, takže pojistka proti duplicitě neexistuje (K3). Duplicita u marketingové kampaně je horší než nedoručení: příjemce ji vidí, zvedá míru stížností, a právě míra stížností je to, kvůli čemu Amazon ruší účty. Nedoručená zpráva v padesátitisícové kampani je neviditelná a uživatel ji může doposlat. |
| SMTP | **`retry`** | Deterministický `Message-ID` projde a většina přijímajících serverů podle něj duplicitu zahodí. |

Sender čte hodnotu z konfigurace kampaně a předává ji jako parametr, sám ji neurčuje. Nejednoznačné zprávy dostávají `error_code = 'ambiguous_dispatch'` v obou režimech, takže je uživatel v reportu vidí bez ohledu na politiku.

Oba dotazy jsou idempotentní a `UPDATE` se serializuje řádkovým zámkem, takže souběh instancí nevadí.

**Obnova po restartu.** Reaper uvolní osiřelé claimy až po TTL, tedy 5 minut. Když ale sender startuje, o své předchozí inkarnaci ví jistě, že je mrtvá. Proto při startu, před spuštěním claimeru, běží jednorázový recovery pass, tedy dotaz A **bez časové podmínky** a se svým `claimed_by`:

```sql
UPDATE messages
SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
    claim_expires_at = NULL, next_attempt_at = now(), updated_at = now()
WHERE status = 'claimed' AND claimed_by = $1 AND dispatch_started_at IS NULL;
```

Dotaz B se při startu **nepouští**, nejednoznačné zprávy vždy čekají na plnou rezervu. Uvolnit je dřív by znamenalo zkrátit okno, ve kterém může dorazit odpověď providera.

**Podmínka funkčnosti:** `SENDER_ID` musí být stabilní přes restart. Výchozí hodnota podle části 1 je "hostname a PID", a PID se při restartu mění, takže **recovery pass ve výchozím nastavení nic nenajde** a kampaň se na 5 minut zadrhne. Není to nekorektnost, jen zbytečné čekání. Návrh na změnu je v rozporu K14; do té doby má operátor `SENDER_ID` nastavit ručně, chce-li rychlý restart.

**Co když dvě instance sdílejí stejné `SENDER_ID`.** Instance B při startu vrátí do fronty řádky, které drží živá instance A. Je to bezpečné, viz důkaz v 3.4.3. Následkem je jen zbytečná práce.

### 3.4 Idempotence: jak se zaručí, že se zpráva neodešle dvakrát

Tohle je nejdůležitější kapitola celé části 4b. Mechanismus je kontraktní (4.10.1 části 1), následující text ho rozepisuje do implementovatelné podoby a dokládá, proč funguje.

#### 3.4.1 Protokol odeslání jedné zprávy

Worker provádí přesně tuhle posloupnost. Každý krok označený "commit" je samostatná transakce, která se před dalším krokem musí potvrdit.

```
D0  limiter.Wait(ctx)                        počká na povolenku od throttleru
D1  UPDATE ... SET attempts = attempts + 1,
                  dispatch_started_at = now()
    WHERE id=$1 AND created_at=$2
      AND status='claimed' AND claimed_by=$3   ← MARKER, commit PŘED síťovým voláním
    ── rowcount = 0  → řádek už není můj, zprávu zahodit, NEODESÍLAT
    ── chyba (i nejednoznačná) → zprávu zahodit, NEODESÍLAT
D2  render → MIME → Dispatcher.Dispatch()      síťové volání
D3  zápis výsledku (jedna z variant a až d)
```

Kontrakt uvádí u D1 jen `SET attempts = attempts + 1, dispatch_started_at = now()`. **Podmínku `AND status='claimed' AND claimed_by=$3` doplňuji** a je nezbytná: je to jediné místo, kde worker ověří, že řádek pořád drží. Bez ní by mohl odeslat zprávu, kterou mu mezitím sebral reaper, a vznikla by duplicita. Důkaz v 3.4.3.

Varianty D3:

```sql
-- D3a  úspěch
UPDATE messages
SET status = 'sent', provider_message_id = $4, sent_at = now(),
    dispatch_started_at = NULL, error_code = NULL, error_detail = NULL,
    updated_at = now()
WHERE id = $1 AND created_at = $2 AND status = 'claimed';

-- D3b  opakovatelná chyba, ještě zbývají pokusy
--      dispatch_started_at se maže, protože o selhání máme důkaz
UPDATE messages
SET status = 'pending', dispatch_started_at = NULL,
    claimed_by = NULL, claimed_at = NULL, claim_expires_at = NULL,
    next_attempt_at = now() + $5::interval,
    error_code = $6, error_detail = $7, updated_at = now()
WHERE id = $1 AND created_at = $2 AND status = 'claimed';

-- D3c  trvalá chyba, nebo vyčerpané pokusy
UPDATE messages
SET status = 'failed', dispatch_started_at = NULL,
    error_code = $6, error_detail = $7, updated_at = now()
WHERE id = $1 AND created_at = $2 AND status = 'claimed';

-- D3d  fatální chyba pro celou kampaň (3.13): zpráva se vrací do fronty
--      beze změny počtu pokusů, protože chyba nebyla její vina
UPDATE messages
SET status = 'pending', dispatch_started_at = NULL,
    claimed_by = NULL, claimed_at = NULL, claim_expires_at = NULL,
    attempts = attempts - 1,
    next_attempt_at = now() + interval '5 minutes',
    error_code = $6, error_detail = $7, updated_at = now()
WHERE id = $1 AND created_at = $2 AND status = 'claimed';
```

Každý `WHERE` obsahuje `created_at`, jinak by dotaz prošel všechny partition (část 1, rozpor R5).

#### 3.4.2 Proč to funguje: úplný rozbor pádů

Sender může spadnout v libovolném okamžiku. Následující tabulka je vyčerpávající, tedy pokrývá všechny možné body přerušení.

| Kde sender spadl | Stav řádku v DB | Odešlo se? | Co udělá obnova |
|---|---|---|---|
| Před D1 | `claimed`, `dispatch_started_at IS NULL` | **Prokazatelně ne** | reaper A nebo recovery pass → `pending`, odešle se |
| Během D1, transakce nedokommitovala | `claimed`, `dispatch_started_at IS NULL` | Prokazatelně ne | totéž, `pending` |
| Během D1, transakce dokommitovala, ale klient to nezjistil | `claimed`, marker vyplněn | Prokazatelně ne (worker po chybě D1 neodesílá) | reaper B → `ambiguous_dispatch`. Konzervativní, ale bezpečné. |
| Mezi D1 a D2 | `claimed`, marker vyplněn | Ne, ale nedokazatelné | reaper B → `ambiguous_dispatch` |
| Během D2 | `claimed`, marker vyplněn | Nevíme | reaper B → `ambiguous_dispatch` |
| Mezi úspěšným D2 a D3a | `claimed`, marker vyplněn | **Ano** | reaper B → `ambiguous_dispatch` |
| Během D3 | `claimed`, marker vyplněn | podle výsledku D2 | reaper B → `ambiguous_dispatch` |
| Po D3 | terminální stav nebo `pending` | podle stavu | nic, řádek už není `claimed` |

**Invariant, na kterém všechno stojí:**

> Řádek se automaticky vrátí do stavu `pending` **bez značky `ambiguous_dispatch` pouze tehdy**, když `dispatch_started_at IS NULL`, tedy když databáze dokazuje, že síťové volání ani nezačalo.

Marker se zapisuje a commituje **před** síťovým voláním, takže "marker chybí" implikuje "volání neproběhlo". Opačně to neplatí (marker může být zapsaný, aniž se volalo), a právě tuhle asymetrii návrh záměrně používá: chybuje se ve prospěch neodeslání.

**Kolik zpráv může skončit jako nejednoznačných.** Nanejvýš `SENDER_CONCURRENCY` na instanci a na jeden pád, tedy při výchozích 32 nejvýš 32. Není to funkce velikosti kampaně.

#### 3.4.3 Důkaz, že souběh dvou senderů nezpůsobí duplicitu

Nejnebezpečnější scénář: instance A drží řádek a chystá se odesílat, reaper (vlastní nebo cizí) ho mezitím vrátí do fronty a instance C ho převezme.

1. Reaper vrací do `pending` **bez značky** jen řádky s `dispatch_started_at IS NULL` (dotaz A). Řádek s markerem projde jen dotazem B, a ten už řeší rozhodnutí o nejednoznačnosti.
2. Marker (D1) má ve `WHERE` podmínku `status='claimed' AND claimed_by=$me`.
3. Obě operace jsou `UPDATE` nad **stejným řádkem**, takže je PostgreSQL serializuje řádkovým zámkem. Jedna z nich proběhne první.

Případ (a): D1 instance A commituje první. Reaper A pak vidí `dispatch_started_at IS NOT NULL` a řádek nechá být. Instance C ho nikdy nedostane. **Jedno odeslání.**

Případ (b): reaper commituje první. Instance A poté spustí D1, ta najde `status='pending'` (nebo cizí `claimed_by`) a vrátí `rowcount = 0`. Instance A podle protokolu **neodesílá**. Zprávu odešle instance C. **Jedno odeslání.**

Třetí případ neexistuje, protože zámek řádku vylučuje prokládání. Duplicita by vznikla jen tehdy, kdyby A odeslala bez úspěšného D1, což protokol zakazuje.

**Důsledek:** dvě instance se stejným `SENDER_ID` jsou výkonnostní a diagnostický problém, ne problém korektnosti.

#### 3.4.4 Proč nestačí `Message-ID` ani idempotency key na straně providera

Kontrakt 4.10.1 uvádí jako zmírnění deterministický `Message-ID`. Je to užitečné, ale **u Amazon SES to neúčinkuje vůbec.**

Ověřeno v dokumentaci AWS ("Amazon SES header fields"), doslovné znění:

> If you provide a `Message-ID` header, Amazon SES overrides the header with its own value.

SES navíc nemá na `SendEmail` žádný idempotency token. Zmírnění tedy funguje jen na SMTP cestě, a i tam je to vlastnost přijímajícího serveru, ne záruka. Podrobně v rozporu K3.

Proto musí idempotence vzniknout u nás v databázi, ne u providera. To je přesně to, co dělá 3.4.1.

#### 3.4.5 Rozhodnutí o nejednoznačných zprávách

Řešení má **dvě části a obě jsou povinné**. První rozhodne, druhá většinu rozhodnutí zpětně opraví.

##### Část první: rozhodnutí podle politiky

| `ambiguous_count` | Politika | Výsledek |
|---|---|---|
| 1 (první výskyt) | `retry`, výchozí u SMTP | `pending`, odešle se znovu, riziko duplikátu tlumí deterministický `Message-ID` |
| 1 (první výskyt) | `fail`, **výchozí u SES** | `failed` s `error_code = 'ambiguous_dispatch'` |
| 2 a víc | kterákoliv | `failed`, vždy, aby zpráva nemohla cyklit |

##### Část druhá: zpětné smíření podle message tagu

**Tohle není doporučení, je to součást řešení.** Bez něj by výchozí politika `fail` u SES znamenala, že se po každém tvrdém pádu nedoručí až `SENDER_CONCURRENCY` zpráv, přestože většina z nich ve skutečnosti odešla.

Ke každé odeslané zprávě přikládáme message tag `oe_msg` s hodnotou `messages.id` (3.9.3). **SES ho vrací v každé události, i když `Message-ID` přepsal.** Právě v tom je jeho hodnota: přežije to, co původní problém způsobilo.

Pravidlo, které implementuje 4a:

> Když dorazí událost `Send`, `Delivery`, `Bounce`, `Complaint` nebo `Reject` s tagem `oe_msg` ukazujícím na zprávu ve stavu `failed` s `error_code = 'ambiguous_dispatch'`, aplikace ji převede na `sent`, doplní `provider_message_id` z události a nastaví `sent_at` na čas z události.

Tři omezení, která z toho dělají bezpečnou operaci:

1. **Opravují se výhradně řádky ve stavu `failed` s `error_code = 'ambiguous_dispatch'`.** Nikdy nic jiného. Zpráva, která selhala z jiného důvodu, se neopravuje.
2. **Nikdy se nemění stav `sent` na cokoliv jiného.** Cesta vede jedním směrem, od menší jistoty k větší.
3. **Neopravuje se řádek, který ještě drží sender** (`status = 'claimed'`). Vyhýbáme se tím závodu s živým senderem, který na tomtéž řádku možná právě píše výsledek. Cena je zpoždění nejvýš do doby, než reaper řádek uzavře, tedy dvojnásobek TTL claimu. Je to background smíření, ne cesta v uživatelské latenci.

##### Co když událost nedorazí nikdy

Musí být určeno, jak dlouho se čeká, jinak zpráva zůstane v nejistotě navždy.

| Fáze | Doba od pádu | Stav zprávy |
|---|---|---|
| Sender spadl uprostřed odesílání | 0 | `claimed`, marker vyplněn |
| Reaper zprávu uzavře | `2 × SENDER_CLAIM_TTL_SECONDS`, výchozí 10 minut | `failed`, `ambiguous_dispatch` |
| Okno pro zpětné smíření | **72 hodin** od `updated_at` | opravitelné na `sent` |
| Po uplynutí okna | | `failed` **konečně**, už se neopravuje |

**Proč 72 hodin.** Události SES dorazí v běžném provozu do několika sekund. Okno není dimenzované na běžný provoz, ale na výpadek: SNS opakuje doručení na HTTP endpoint řádově hodiny až dny a naše aplikace mohla být mezitím dole. Kontrola je jeden index lookup na příchozí událost, takže dlouhé okno nic nestojí. Kratší okno by naopak znamenalo, že výpadek aplikace přes víkend zbytečně prohlásí odeslané zprávy za neodeslané.

**U SMTP zpětná cesta neexistuje**, protože zpětný kanál není. Zprávy tam skončí jako `failed` s `ambiguous_dispatch` hned a natrvalo. Právě proto je u SMTP výchozí politika `retry`: tam pojistka proti duplicitě funguje a nedoručení není potřeba riskovat.

##### Co uživatel uvidí v reportu

Karta v reportu kampaně se zobrazí jen tehdy, když je počet nenulový.

| Situace | Text cs | Text en |
|---|---|---|
| Do 72 hodin, ještě se může opravit | U {n} zpráv zjišťujeme, jestli odešly. Server se restartoval uprostřed odesílání. Většina se do pár minut vyjasní sama. | We are checking whether {n} messages were sent. The server restarted mid-send. Most of these resolve themselves within minutes. |
| Po 72 hodinách, konečné | {n} zpráv jsme neodeslali, protože po restartu serveru nešlo zjistit, jestli už odešly. Neriskovali jsme, že by někomu přišly dvakrát. | We did not send {n} messages because after a server restart we could not tell whether they had already gone out. We chose not to risk sending them twice. |
| Tlačítko | Odeslat těchto {n} znovu | Send these {n} again |
| Po kliknutí | Odesíláme znovu. Malá část příjemců může mail dostat podruhé. | Sending again. A small number of recipients may receive the email twice. |

Rozdíl mezi prvním a druhým řádkem je podstatný: v prvním se ještě nic nestalo a uživatel nemá co dělat, ve druhém je rozhodnutí na něm. Kdyby se zobrazoval jen druhý text, uživatel by zbytečně klikal na "odeslat znovu" u zpráv, které se za minutu vyjasní samy.

##### Návrh na doplnění kontraktu

Kontrakt 4.10.1 uvádí `sent` jako koncový stav a přechod `failed → sent` v tabulce nemá. Zpětné smíření ho ale potřebuje, jinak si ho někdo vyloží jako porušení kontraktu a implementuje ho někdo jiný jinak. Navrhuji doplnit do tabulky přechodů jeden řádek a k němu tři podmínky:

| Z | Do | Kdo | Podmínka |
|---|---|---|---|
| `failed` | `sent` | **aplikace** | výhradně při `error_code = 'ambiguous_dispatch'`, výhradně na základě události providera nesoucí message tag `oe_msg`, a výhradně do 72 hodin od `updated_at` |

Formulace omezení, tak jak by měla stát v kontraktu:

> Přechod `failed → sent` je povolený jako **jediná výjimka** z pravidla o koncových stavech. Smí ho provést pouze aplikace, pouze u zpráv s `error_code = 'ambiguous_dispatch'`, pouze na základě přijaté události providera, která nese message tag `oe_msg` odpovídající `messages.id`, a pouze v okně 72 hodin od `updated_at`. Sender tenhle přechod neprovádí nikdy a nemá na něj práva. Opačný směr, tedy `sent` na jakýkoliv jiný stav, zůstává zakázaný bez výjimky, včetně pozdního bounce; ten se zaznamenává výhradně do `message_events`.

Zdůvodnění pro kontrakt: bez téhle výjimky nemá výchozí politika `fail` u SES protiváhu a po každém tvrdém pádu by se natrvalo nedoručilo až `SENDER_CONCURRENCY` zpráv, přestože většina z nich odešla. S ní se většina nejistot rozpustí sama a bez rizika duplikátu.

#### 3.4.6 Idempotence proti duplicitám v samotném outboxu

Sender se brání duplicitnímu **odeslání**, ne duplicitním **řádkům**. Kdyby 4a materializovala publikum dvakrát, vzniknou dva legitimní řádky a sender pošle dva maily, protože z jeho pohledu jde o dvě různé zprávy.

Kontraktní index `uq_messages__campaign_contact (campaign_id, contact_id, created_at)` proti tomu nechrání, protože `created_at` se u dvou materializací liší. Rozbor v rozporu K6, návrh řešení v požadavku P4a.11.

### 3.5 Stavový diagram `messages`

Stavy jsou kontraktní (4.10.1 části 1). Šestý stav se nezavádí, nejednoznačnost nese `error_code`.

```
                      materializace (4a)
                             │
                             ▼
   (4a) skipped ◄──────── pending ◄──────────────────────────┐
                             │                               │
                             │ claim (sender, 3.2)           │ D3b retry
                             ▼                               │ D3d fatal
   (4a) failed ◄────────  claimed ───────────────────────────┤ reaper A
   (zrušení kampaně)         │                               │ reaper B, retry
                             │ D1 marker + D2 dispatch       │ recovery pass
                 ┌───────────┼───────────┐                   │
                 ▼           ▼           ▼                   │
               sent       failed      pending ───────────────┘
                                    (+ error_code =
                                       ambiguous_dispatch)
```

Tabulka přechodů. Sloupec "Kdo" říká, která komponenta přechod smí provést.

| Z | Do | Kdo | Podmínka |
|---|---|---|---|
| (vznik) | `pending` | 4a | materializace publika |
| `pending` | `claimed` | sender | claim dotaz 3.2 |
| `pending` | `skipped` | 4a | kontakt se mezitím odhlásil nebo je na suppression listu |
| `pending` | `failed` | 4a | zrušení kampaně |
| `claimed` | `sent` | sender | D3a, provider přijal zprávu |
| `claimed` | `failed` | sender | D3c, trvalá chyba nebo vyčerpané pokusy |
| `claimed` | `pending` | sender | D3b, D3d, reaper A, recovery pass |
| `claimed` | `skipped` | sender | dávková kontrola suppression po claimu, před krokem D0 (K5) |
| `claimed` | `pending` s `ambiguous_dispatch` | sender | reaper B, politika `retry`, první výskyt |
| `claimed` | `failed` s `ambiguous_dispatch` | sender | reaper B, politika `fail` nebo druhý výskyt |
| `failed` | `sent` | **4a, nikdy sender** | jediná výjimka z pravidla o koncových stavech. Jen při `error_code = 'ambiguous_dispatch'`, jen na základě události s message tagem `oe_msg`, jen do 72 h od `updated_at`. Návrh na doplnění kontraktu v 3.4.5. |
| `failed` | `pending` | 4a | uživatel klikl na "Odeslat znovu" |

**Zakázané přechody a proč:**

| Zakázáno | Důvod |
|---|---|
| `sent` → cokoliv | Zpráva odešla. **Stav je terminální a neměnný, včetně pozdního bounce.** Bounce, stížnost i doručení se zaznamenávají do `message_events`, nikdy se nepromítají zpátky do `messages.status`. Sender tenhle přechod nedělá a ani ho udělat nemůže. Moje oprava opožděnou událostí (3.4.5) jde opačným směrem, `failed → sent`, a stav `sent` tedy nikdy nemění. |
| `pending` → `sent` | Bez claimu a markeru není důkaz o odeslání. |
| `skipped` → cokoliv | Terminální, zpráva se vědomě neposlala. |
| `claimed` → `skipped` mimo dávkovou kontrolu | Přechod je povolený, ale **jen jako výsledek dávkové kontroly suppression po claimu** (K5), nikdy jako reakce na cokoliv jiného. Sender nikdy neoznačí `skipped` zprávu, kterou se pokusil odeslat. |
| `failed` → `sent` mimo `ambiguous_dispatch` | Jediná povolená oprava je doplnění jistoty u nejednoznačné zprávy. |

### 3.6 Fáze 2 renderu: Liquid interpolace

**Vstup.** `campaigns.compiled_html`, `compiled_text`, `subject`, `preheader`. Ve všech čtyřech zůstaly z fáze 1 nedotčené Liquid placeholdery z povoleného subsetu (kontrakt 4.10.2 části 1).

**Data.** Výhradně `messages.render_data`. Sender nesahá na `contacts`. Kořenové proměnné jsou kontraktní:

```
contact.*            pole kontaktu, snapshot z materializace (výčet vlastní část 2)
campaign.name        campaign.subject
workspace.name
unsubscribe_url      one_click_unsubscribe_url
preferences_url      webview_url
_context.timezone    _context.locale
```

**Co je v `render_data` a co si sender staví sám.** Tvar potvrzený s částí 4a: vnoření nejvýš dvě úrovně (`contact.custom.<key>`), `NULL` se zapisuje jako `null` a nevynechává se, strop 8 kB na zprávu. `email` v `render_data` **není nikdy**, je ve vlastním sloupci.

```json
{ "contact": { "first_name": "Jana", "first_name_vocative": "Jano",
               "greeting": "Dobrý den, Jano", "custom": { "city": "Brno" } } }
```

Odkazy v `render_data` **nejsou**, sender si je staví sám. Je to rozhodnutí části 4a a je správné: uložit 117znakový odhlašovací odkaz ke každé zprávě by u milionové kampaně znamenalo přes 100 MB v databázi navíc a druhou implementaci téhož HMAC na straně, která ho podle kontraktu 4.10.3 vyrábět nemá.

| Kořenová proměnná | Odkud sender bere vstupy |
|---|---|
| `unsubscribe_url`, `one_click_unsubscribe_url` | token typu `u`: `workspace_id`, `message_id`, `contact_id` z claim dotazu, `list_id` z `campaigns.unsubscribe_list_id` (nový sloupec, doplnila 4a), `issued_at` z hodin. `NULL` v `unsubscribe_list_id` znamená nulové UUID, tedy globální odhlášení. |
| `preferences_url`, `webview_url` | totéž, liší se jen cesta |
| `campaign.name`, `campaign.subject`, `workspace.name` | z cache kampaně (3.15) |
| `_context.timezone`, `_context.locale` | z cache kampaně |
| `contact.*` | výhradně z `render_data` |

Tím se **ruší nález K16** z předchozí revize: `list_id` sender má, takže token typu `u` vyrobit může.

**Kontexty renderu.** Ne všechny čtyři šablony se renderují stejně:

| Šablona | Engine | Proč |
|---|---|---|
| `compiled_html` | s escapováním | HTML kontext, kontraktní pravidlo |
| `compiled_text` | bez escapování | textový kontext |
| `subject` | **bez escapování** | předmět není HTML. `&amp;` v předmětu vidí každý příjemce. Potvrzeno s částí 4a. |
| `preheader` | bez escapování, **jen pro `render_data` a diagnostiku** | Kontrakt 5, bod 4.1.6.5: preheader je už zapečený v `html` jako první skrytý blok, takže escapování proběhne uvnitř `html`. Do těla ho sender nezapisuje. |

**Vlastních pět filtrů, ne vestavěné.** Kontrakt 4.10.2 rozhoduje, že se nepoužije ani jeden vestavěný filtr a obě strany registrují vlastní `default`, `upcase`, `downcase`, `date` a `escape` se shodnou definicí. Je to podstatně lepší řešení, než jaké jsem navrhoval v konceptu, a odstraňuje většinu rozdílů, které jsem našel průzkumem (rozbor v 13.4).

V Go se to dělá přes `engine.RegisterFilter(name, fn)`. Filtr `date` se implementuje jako **`switch` nad pěti konstantami z whitelistu**, ne jako obecný strftime; balíček `osteele/tuesday`, na který se `osteele/liquid` u vestavěného `date` opírá, tím není potřeba vůbec.

**Automatické escapování v HTML kontextu** je kontraktní. V Go existuje `engine.SetAutoEscapeReplacer(replacer)`. Předává se **vlastní** `Replacer` s přesně pěti náhradami z kontraktu, ne vestavěný `render.HtmlEscaper`: ten se opírá o Go `html.EscapeString`, který produkuje `&#34;` místo kontraktem předepsaného `&quot;`, a golden fixtures se porovnávají bajt po bajtu. Podrobně v rozporu K11.

Sender proto drží **dva engine**: jeden s replacerem pro HTML, druhý bez pro plain text a pro `subject`. Ne jeden přepínaný za běhu.

**Pořadí operací.** Podle kontraktu 5 (3.7.1) běží náhrada značek **před** interpolací:

```
1. náhrada značek v html a text
2. Liquid interpolace
3. sestavení MIME
```

Důsledek, který stojí za zdůraznění: protože se zdroj šablony liší u každého příjemce, **`ParseTemplate` běží na každou zprávu**, ne jednou na kampaň. Rozbor nákladů a náhradní cesta jsou v 3.7.1. Jednorázové parsování při načtení kampaně do cache zůstává, ale slouží už jen jako kontrola, že šablona je syntakticky v pořádku.

Šablony `subject` a `preheader` značky neobsahují, takže se u nich parsuje jednou na kampaň a per příjemce se jen vykonává.

```go
type campaignRenderer struct {
    subject, preheader, text *liquid.Template // engine bez escapování
    html                     *liquid.Template // engine s escapováním
}
```

Souběžná bezpečnost `*liquid.Template.Render` není v dokumentaci zaručená, proto se drží jedna sada **per worker**, ne per kampaň. Při 32 workerech je to paměťově zanedbatelné a je to bezpečné bez ohledu na to, jak se to v knihovně chová.

**Konfigurace engine, závazně:**

| Volání | Musí se |
|---|---|
| `engine.StrictVariables()` | **nevolat**, chybějící proměnná má být prázdný řetězec (kontraktní pravidlo 1) |
| `engine.LaxFilters()` | **nevolat**, neznámý filtr má být chyba |
| `engine.EnableJekyllExtensions()` | **nevolat**, povolilo by konstrukce, které LiquidJS odmítne |
| `engine.SetAutoEscapeReplacer(vlastní)` | volat jen na HTML engine |

Na všechna čtyři existuje test, který spadne, kdyby je někdo přidal.

**Chování za běhu.** Kontraktní politika z 4.10.2:

| Situace | Chování |
|---|---|
| Chybějící hodnota v `render_data` | prázdný řetězec, zpráva se **odešle**, do `message_events` se zapíše `render_warning` s cestou |
| Cyklus přes ne-pole | cyklus se neprovede, `render_warning` |
| Pole delší než 200 prvků | zkrátí se na prvních 200, `render_warning` |
| Syntaktická chyba | zpráva na `failed` s `error_code = 'render_failed'`, kampaň **se nezastaví** |
| Překročení 50 ms | zpráva na `failed` s `render_timeout` |
| Podíl selhání z důvodu renderu přesáhne 5 % z prvních `min(1000, velikost publika)` zpráv a zároveň jich je nejméně 10 | kampaň se pozastaví (3.13). Zpřesnění pochází z revize části 3: u kampaně na 200 příjemců by se práh „z prvních 1 000“ nikdy nespustil. Konkrétní čísla dolaďuje 4a. |

Poslední řádek nahrazuje můj původní práh 20 chyb za sebou. Kontraktní pravidlo je lepší, protože nereaguje na náhodný shluk.

**Jak se limity vynucují v Go:**

- **50 ms a velikost výstupu:** `engine.ParseAndFRender(w, ...)` s vlastním `io.Writer`, který kontroluje deadline a počet zapsaných bajtů. README `osteele/liquid` to uvádí jako doporučený postup.
- **200 iterací:** knihovna přerušit vestavěný `for` neumí. Řeší se **oříznutím polí v `render_data` před renderem**. Musí to obě strany dělat identicky, jinak se výstup rozejde u 201. prvku. Viz rozpor K15.
- **Časová zóna filtru `date`:** filtr v Go nedostane bindings, takže si `_context.timezone` nepřečte. Zóna se fixuje při vytvoření engine a sender drží cache engine podle zóny. Předpokládá to, že zóna je konstantní v rámci kampaně. Viz rozpor K10.

**Objem varování.** Kampaň na 50 000 příjemců, kde polovina nemá vyplněné pole, na které se šablona odkazuje, vyrobí 25 000 `INSERT` do `message_events` nesoucích tutéž informaci. Doporučuji varování agregovat na dvojici (kampaň, cesta) s počítadlem. Viz rozpor K17.

**Velikostní limity po interpolaci:**

| Limit | Hodnota | Při překročení |
|---|---|---|
| `subject` | 998 bajtů po zakódování | `failed`, kód `subject_too_long` |
| HTML část | 2 MiB | `failed`, kód `body_too_large` |
| Celá MIME zpráva | 9 MiB | `failed`, kód `message_too_large` |

Limit 9 MiB je konzervativně pod limitem SES, protože quoted-printable objem zvětšuje a mnoho přijímajících serverů odmítá nad 10 MB.

#### 3.6.2 Filtr `date`: vstupy, výstupy a past se signaturou

Kontrakt 4.10.2 definuje vstupy filtru jako "řetězec RFC 3339 s explicitní zónou, celé číslo (unix sekundy), nebo `"now"`. Cokoliv jiného → prázdný řetězec." Z pohledu Go implementace je potřeba tři věci napsat explicitně, protože z toho popisu nevyplývají.

**Signatura.** Vlastní filtr **musí** mít vstup typu `any`:

```go
// SPRÁVNĚ
engine.RegisterFilter("date", func(in any, format string) (string, error) { ... })

// ŠPATNĚ, spadne za běhu na každé zprávě
engine.RegisterFilter("date", func(t time.Time, format string) (string, error) { ... })
```

Vestavěný filtr v `osteele/liquid` má `func(t time.Time, format func(string) string)` a knihovna pro něj vstup převede sama přes `values/parsedate.go`. **Náš vlastní filtr tuhle konverzi nedostane**, protože si registrací vestavěný filtr přepisujeme (13.5) a s ním i jeho konverzní chování. Kdo signaturu opíše z knihovny, dostane chybu na každé zprávě, ne při startu. Je to nejpravděpodobnější implementační chyba v celém senderu.

**Jaké typy reálně dorazí.** `render_data` se dekóduje z `jsonb` s `decoder.UseNumber()` (K20), takže filtr může dostat:

| Skutečný typ v Go | Odkud | Chování filtru |
|---|---|---|
| `string` | datum jako řetězec RFC 3339 | parsovat, při chybě prázdný řetězec |
| `string` s hodnotou `"now"` | literál v šabloně | aktuální čas |
| `json.Number` | unix sekundy jako číslo v JSON | převést na `int64`, při chybě prázdný řetězec |
| `nil` | chybějící hodnota | **prázdný řetězec, nikdy chyba** (kontraktní pravidlo 1) |
| cokoliv jiného | pole, objekt, `bool` | prázdný řetězec |

**Žádná varianta nesmí vrátit chybu.** Chyba filtru by v `osteele/liquid` shodila celý render a zpráva by skončila jako `render_failed`, přestože kontrakt pro neplatný vstup předepisuje prázdný řetězec. Návratový typ `error` v signatuře zůstává jen kvůli tvarové kontrole knihovny a vrací se vždy `nil`.

**Implementace formátu je `switch` nad pěti konstantami**, ne obecný strftime:

| Formát z whitelistu | Layout v Go |
|---|---|
| `%d.%m.%Y` | `02.01.2006` |
| `%-d.%-m.%Y` | nejde přímo, `time.Format` nemá nepaddovanou variantu; složit z `t.Day()` a `int(t.Month())` |
| `%Y-%m-%d` | `2006-01-02` |
| `%d.%m.%Y %H:%M` | `02.01.2006 15:04` |
| `%H:%M` | `15:04` |

Druhý řádek je jediný, který potřebuje ruční sestavení, a je zároveň jediné místo, kde se implementace může rozejít s TypeScriptem. Patří na něj vlastní fixture s jednociferným dnem i měsícem (například 1. 8. 2026).

**Zóna** se aplikuje přes `t.In(loc)` před formátováním, kde `loc` je zafixovaná při vytvoření engine (K10). Chybějící `_context.timezone` znamená `UTC`.

#### 3.6.1 Zbytkové riziko rozchodu dialektů

Kontrakt 4.10.2 rozhodnutím o vlastních filtrech odstranil většinu rozdílů mezi LiquidJS a `osteele/liquid`, které jsem našel průzkumem (soupis v 13.4). Zbývají tři, všechny ověřené ve zdrojovém kódu `osteele/liquid` v1.8.1, a všechny popsané jako rozpory v kapitole 11.1:

| # | Zbytkové riziko | Závažnost |
|---|---|---|
| K4 | **Literály `blank` a `empty` v `osteele/liquid` neexistují.** Lexer zná jen `true`, `false` a `nil`. Kontraktní gramatika je ale povoluje a normativní pravidlo 4 na nich staví. `{% if contact.first_name == blank %}` by v náhledu a v odeslaném mailu vybralo jinou větev. | **Vážná.** Vyžaduje změnu kontraktu. |
| K11 | **Filtr `safe` se registruje automaticky a nejde odregistrovat.** `SetAutoEscapeReplacer` volá interně `AddSafeFilter()` a `Engine` nemá `UnregisterFilter`. Šablona s `{{ x \| safe }}` obejde automatické escapování, které kontrakt označuje za nevypnutelné. | Střední, mitigovatelná kontrolou v senderu. |
| K19 | **`upcase` nad `ß`.** Go `strings.ToUpper("ß")` vrací `ß` (simple mapping, jak kontrakt předepisuje), JavaScript `toUpperCase()` vrací `SS` (full mapping). Českých znaků se to netýká, ověřeno. | Nízká, ale patří do fixtures. |

Potvrzené shody, které stojí za zaznamenání, protože se na ně kontrakt spoléhá:

- **Truthiness.** README `osteele/liquid` uvádí doslova, že falešné jsou jen `false` a `nil`. Prázdný řetězec, `0` a prázdné pole jsou pravdivé. LiquidJS se s vypnutým `jsTruthy` chová stejně. Kontraktní pravidlo 2 platí.
- **Chybějící proměnná** se bez `StrictVariables()` vyhodnotí jako `nil` a vypíše jako prázdný řetězec, včetně cesty s chybějícím mezičlenem. Kontraktní pravidlo 1 platí.
- **Automatické escapování** je v knihovně podporované, takže kontrakt není nesplnitelný. To byla nejzávažnější věc, kterou jsem u tohohle kontraktu prověřoval.

### 3.7 Přepis odkazů, open pixel a odhlašovací odkaz

#### 3.7.1 Pátý kontrakt: předání zkompilované šablony

**Vlastní ho část 3**, definice je v `parts/03-obsah.md`, sekce 4.1. **Kontrakt je uzavřený z obou stran.** Ověřil jsem ho z pozice implementátora v Go a přijímám ho beze změny, včetně všech tří změn proti mému původnímu návrhu; část 3 zapracovala všechny čtyři moje připomínky. Tahle sekce popisuje, jak ho sender implementuje, a zaznamenává jeden důsledek, který v kontraktu není a měl by být.

##### Dvě značky

| Značka | Přesný tvar | Kde | Čím ji sender nahradí |
|---|---|---|---|
| Odkaz | `https://track.openengage.invalid/c/<link_id>` | celá hodnota `href` v HTML, samostatný nezalomený řádek v prostém textu | `<TRACKING_DOMAIN>/t/c/<click token typu c>` |
| Open pixel | `<!--OE_OPEN_PIXEL-->` | těsně před `</body>`, jen v HTML | `<img src="<TRACKING_DOMAIN>/t/o/<open token typu o>" width="1" height="1" alt="" style="display:none;max-height:0;overflow:hidden" />` |

`<link_id>` je UUID s pomlčkami, 36 znaků, tedy přesně to, co kontrakt 3 vyžaduje v payloadu click tokenu jako 16 bajtů. **Tím padá můj dřívější požadavek P5.8:** sender nemusí překládat pozici na UUID a nemusí tedy vůbec číst `campaign_links`. Je to lepší, než jsem žádal.

**Značka odkazu jako absolutní URL: přijímám a je to lepší než můj token.** Argument, který rozhodl, není čitelnost ani platnost URL, ale **chování při selhání**: doména `.invalid` je rezervovaná RFC 2606 a nikdy se nerozpustí, takže neproběhlá záměna dá inertní odkaz, ne funkční odkaz na cizí server. Můj `__OE_CLICK_3__` by se v prohlížeči choval jako relativní cesta na naši vlastní doménu.

**Pixel jako HTML komentář: přijímám a nemám proti tomu v Go žádnou výhradu.** Je to pořád jedna záměna pevného řetězce. Kritérium je opět selhání: neproběhlá záměna komentáře je neviditelná, neproběhlá záměna tokenu vytiskne příjemci do těla podtržítkový nesmysl. Jediná drobnost, kterou je dobré mít zapsanou: komentář **nesmí ležet uvnitř podmíněného komentáře pro Outlook**, protože vnořené HTML komentáře nejsou platné. Pozice těsně před `</body>` to splňuje.

##### Implementace záměny v Go

Naivní implementace je `strings.ReplaceAll` jednou na každý odkaz z `CompileMeta.links`. Při dvaceti odkazech a stokilobajtovém dokumentu to znamená dvacet průchodů, tedy 2 MB skenování na zprávu. Funguje to, ale je to zbytečné.

**Správná implementace je jeden průchod přes pevný prefix:**

```
1. hledej strings.Index(src[i:], "https://track.openengage.invalid/c/")
2. přečti následujících 36 znaků jako UUID, uuid.Parse
3. zapiš do strings.Builder úsek před značkou a za ni trackovací odkaz
4. počítej náhrady
```

Jeden průchod, složitost lineární k délce dokumentu, a jako vedlejší produkt **rovnou počet náhrad**, který se porovnává s `clickMarkerCount`. Neparsovatelné UUID za prefixem je chyba, ne tichý přeskok.

Pixel se nahrazuje `strings.Replace` s počtem **1**, ne `ReplaceAll`. Kontrakt garantuje právě jeden výskyt; kdyby jich bylo víc, druhý zůstane a zachytí ho kontrola zbytků.

##### Pořadí operací: náhrada před interpolací

```
1. náhrada značek (odkazy, pixel)
2. Liquid interpolace
3. sestavení MIME
```

**Přijímám změnu a moje původní zdůvodnění bylo chybné.** Tvrdil jsem, že při tomhle pořadí "by mohla interpolovaná data rozbít token uvnitř URL". To neplatí: značka je celá hodnota `href`, je to statický řetězec ve zkompilované šabloně a nahrazuje se za URL, která žádný Liquid neobsahuje. Není co rozbít.

Argument části 3 naopak platí. Při mém pořadí by kontakt, jehož vlastní pole obsahuje řetězec `https://track.openengage.invalid/c/<link_id>`, dostal po interpolaci do těla funkční trackovací odkaz. Validátor části 3 to zavřít nemůže, protože na data kontaktu nevidí, a import CSV od zákazníka je přesně to místo, odkud takový řetězec přijde. Obrácené pořadí tu díru zavírá z definice, protože v okamžiku interpolace už žádné značky neexistují.

Trackovací token je base64url, tedy `A-Za-z0-9-_`, takže do šablony nevnáší `{{`, `{%` ani jiný Liquid metaznak. Náhrada tedy nemůže vyrobit konstrukci, kterou by následné parsování vyhodnotilo.

##### Důsledek, který v kontraktu není: šablona se parsuje na každou zprávu

Tohle je jediná věc, kterou k pátému kontraktu doplňuji, a část 3 ji ve zdůvodnění přehlédla.

Kontrakt argumentuje tím, že "náhrada i interpolace běží obojí per zprávu, takže pořadí mezi nimi je volné". Interpolace skutečně běží per zprávu, ale **parsování ne**. Můj návrh v 3.6 volá `engine.ParseTemplate` **jednou na kampaň** a `Render` per příjemce, protože parsování je řádově dražší než vykonání.

Když se ale značky nahrazují ve zdrojovém řetězci **před** parsováním, liší se zdroj u každého příjemce (token nese `message_id`), a `ParseTemplate` tedy musí běžet na každou zprávu. Z jednoho parsování na kampaň se stává padesát tisíc parsování.

**Přesto změnu přijímám**, protože bezpečnostní argument váží víc než výkonnostní odhad. Náklad:

| Veličina | Odhad |
|---|---|
| Parsování šablony o 100 kB | 0,2 až 1 ms (scanner je generovaný Ragelem, dominuje průchod textem) |
| Při 50 zprávách za sekundu | 10 až 50 ms procesorového času za sekundu, tedy 1 až 5 procent jádra |
| Při 200 zprávách za sekundu | 4 až 20 procent jádra |

Je to zanedbatelné, ale je to **odhad, ne měření**. Zapsal jsem to jako otevřenou otázku O6 a je to první benchmark, který se v senderu napíše.

**Dvě náhradní cesty, kdyby se odhad ukázal jako špatný.** Obě jsou v kontraktu 4.1.3 zapsané předem, aby se o nich nediskutovalo pod tlakem, až něco ukáže benchmark.

**Cesta A (navrhla část 3, má přednost).** Pořadí zpět na `interpolace → náhrada`, ale po interpolaci se spočítají výskyty značky a porovnají s `clickMarkerCount`. Vrací parsování jednou na kampaň za cenu jednoho lineárního průchodu na zprávu a **inertní selhání zůstává**. Bezpečnost se z toho mění ze strukturální záruky na běhovou kontrolu, což je slabší, ale díra zůstává zavřená.

**Cesta B (moje, druhá v pořadí).** Kompilace by místo statické URL emitovala Liquid proměnnou (`href="{{ oe_link_<link_id> }}"`) a sender by ji dosazoval přes bindings. Také vrací parsování jednou na kampaň a injekce z dat kontaktu je stejně nemožná, protože kořenové proměnné vlastníme my a data kontaktu žijí pod `contact.*`. **Cena je ztráta inertního selhání**: chybějící proměnná se vyrenderuje jako prázdný řetězec, tedy `href=""`. Proto je druhá.

**Detail cesty A, který musí být přesný, jinak nefunguje.** Porovnání je `>`, ne `!=`.

Značka může ležet uvnitř `{% if %}`, který se pro daného příjemce vyhodnotí jako nepravda. Pak se do výstupu nedostane a **nižší počet je zcela legitimní**. Interpolace značky jen přidává, nikdy neubírá, takže injektáž se pozná výhradně podle vyššího počtu:

| Vztah | Význam |
|---|---|
| `count > clickMarkerCount` | injektáž z dat kontaktu, zpráva na `failed` s `marker_injection_detected` |
| `count < clickMarkerCount` | **legitimní**, značka byla uvnitř nesplněné podmínky |
| `count = clickMarkerCount` | běžný případ |

Kdyby se to napsalo jako `!=`, kampaň s podmíněným odkazem by selhávala u každého příjemce, který do podmínky nespadá. Část 3 to má ve své zprávě správně, ale v kontraktu to musí být explicitně, protože `!=` je přirozenější napsat.

**Pozor na záměnu se dvěma jinými kontrolami, které dělám dnes.** Pod přijatým pořadím (`náhrada → interpolace`) se počítá nad **zdrojem šablony**, který je pro celou kampaň statický, takže tam je správné `==` a kontroluje se jednou při načtení kampaně. Kontrola z cesty A by se počítala nad **vyrenderovaným výstupem** a musela by běžet u každé zprávy. Jsou to tři různé kontroly na třech různých místech a nesmí se slít do jedné.

**Kontrola parsování jednou na kampaň zůstává.** Při načtení kampaně do cache se šablona jednou zparsuje s náhradními URL stejného tvaru. Když parsování selže tady, je to chyba šablony a kampaň se pozastaví, místo aby padala zpráva po zprávě. Za běhu se pak selhání parsování bere jako `render_failed` jedné zprávy, ale nemělo by nastat.

##### Fixtures, které ověřuje Go strana

Kontrakt má 16 fixtur `CT-001` až `CT-016`. Go strana z nich ověřuje druhou půlku: že po náhradě nezbude `openengage.invalid`, že počet náhrad sedí, a **že náhrada nezměnila nic jiného**, tedy bajtový diff mimo nahrazené úseky.

Ten poslední test považuji za nejcennější v celé sadě, protože je to jediná strojová záruka, že sender nesáhne na markup laděný pro Outlook. Ověřuje ho `CT-014`, bajtový snapshot dokumentu se všemi typy bloků.

Dvě fixtury přibyly na základě mých připomínek:

| ID | Co ověřuje | Proč jsem o ni žádal |
|---|---|---|
| `CT-015` | `trackClicks = false` s cílovou URL `?a=1&b=2`: v `html` je `&amp;`, v `text` je `&` | Sender vkládá URL jako literální text a auto-escapování se jí netýká, protože platí jen pro výstup `{{ }}`. Kdyby ji neescapovala kompilace, neescapoval by ji nikdo. |
| `CT-016` | Kontakt, jehož pole obsahuje řetězec značky: po náhradě a interpolaci nesmí vzniknout trackovací odkaz navíc | Je to moje AK-6.22 z druhé strany, takže máme injekční scénář pokrytý oboustranně. |

##### Čtvrtá vrstva ochrany na straně senderu

Část 3 má tři vrstvy (validátor, pořadí operací, invariant I3). Přidávám čtvrtou a dělím ji na dvě podle toho, co se kontroluje:

| Kontrola | Kdy | Při neúspěchu |
|---|---|---|
| **Počet náhrad odpovídá `clickMarkerCount`** | **jednou při načtení kampaně do cache**, ne per zpráva | celá kampaň na `paused`, důvod `contract_mismatch` |
| Ve výstupu nezbyl řetězec `openengage.invalid` | per zpráva, `strings.Contains` nad `html` i `text` | zpráva na `failed`, kód `marker_not_replaced`, bez opakování |

**Počet značek je vlastnost zkompilované šablony, ne jednotlivé zprávy**, takže se kontroluje jednou při načtení kampaně, ne padesát tisíckrát. Je to zároveň lepší chování, než navrhuje kontrakt: kampaň se zastaví **dřív, než odejde první zpráva**, místo aby se zastavila až po ní. Souhlasím s částí 3, že neshoda počtu značek znamená nekompatibilní verze kompilace a senderu, a že to nemá řešit retry, ale člověk.

Kontrola zbytků zůstává per zpráva, protože je to jeden `strings.Contains` nad už existujícím řetězcem, tedy jednotky mikrosekund, a chytí třídu chyb, na kterou invarianty části 3 nedosáhnou.

##### Co ze 4.1.6 přebírám jako záruku

Kontrakt vyjmenovává šest vlastností, na které se sender může spolehnout. Tři z nich mi ruší práci, kterou jsem měl v dokumentu:

1. **`text` je zalomený na 78 znaků, ale řádek se značkou se nezalamuje nikdy a značka na něm stojí sama.** Přesně to jsem žádal v S6. Sender po náhradě text **nikdy nezalamuje** a nemusí řešit, kudy URL prochází.
2. **Preheader je zapečený v `html` jako první skrytý blok.** Interpoluji ho tedy jen kvůli `render_data` a diagnostice, **do těla ho nezapisuji**. Tím se ruší můj požadavek P3.8 i řádek "preheader se renderuje s escapováním" z tabulky kontextů v 3.6: escapování proběhne uvnitř `html`, kam ho zapekla kompilace.
3. **`html` je kompletní dokument** včetně `<!DOCTYPE html>`. Sender do něj nepřidává nic kromě dvou náhrad.

##### Chování v jednotlivých režimech

| Režim | Značka odkazu | Značka pixelu |
|---|---|---|
| `trackClicks = true` | nahradí se trackovacím odkazem | |
| `trackClicks = false` | **kompilace značku negeneruje**, v `href` je rovnou cílová URL | |
| `trackOpens = true` | | nahradí se `<img>` o rozměru 1 × 1 |
| `trackOpens = false` | | **kompilace komentář negeneruje**, `hasOpenPixelSlot = false` |
| `is_test = true` a `SENDER_TEST_TRACKING = false` | kompilace proběhne s `trackClicks = false` | totéž s `trackOpens = false` |

Poslední řádek je změna proti mému dřívějšímu návrhu, kde sender u testovacího odeslání nahrazoval značky původními URL. To by po něm chtělo znát původní URL, tedy číst `campaign_links`. Správně je zkompilovat testovací odeslání rovnou s vypnutým sledováním, což je práce části 4a při materializaci.

##### Odkazy, které se nesledují

Rozhoduje kompilace, sender jen nahrazuje to, co najde. Sender **nezná strukturu dokumentu**, takže je vůči všem těmto případům automaticky neutrální: kde kompilace značku nevloží, sender nic nemění.

`mailto:`, `tel:`, `href="#"`, `<a>` bez `href`, systémové tagy (`{{ unsubscribe_url }}` a spol.) a **všechny odkazy uvnitř bloku `html`** se nesledují. Souhlasím i s posledním bodem: hledat `href` v surovém uživatelském HTML by znamenalo regexovat cizí markup, tedy přesně to, čemu se celý kontrakt vyhýbá.

Produktový důsledek, který musí být vidět v editoru a ne jen v dokumentaci: **uživatel, který si vloží vlastní tlačítko do bloku `html`, u něj v reportu neuvidí ani jedno kliknutí.** Část 3 to řeší hláškou přímo u bloku, což považuji za dostatečné.

#### 3.7.2 Odhlašovací odkaz

`{{ unsubscribe_url }}` **vyrábí sender**, není v `render_data`. Sestaví token typu `u` podle kontraktu 4.10.3 ze vstupů uvedených v 3.6 a připojí ho k `TRACKING_DOMAIN`. Hodnota se dosadí na dvou místech: do těla zprávy přes merge tag a do hlavičky `List-Unsubscribe` (3.8.2). Obě místa dostanou **tentýž řetězec**, vyrobený jednou před renderem.

Když se token nepodaří sestavit (chybí `contact_id`, což je případ testovacího odeslání na volnou adresu), chová se sender takto:

| Situace | Chování |
|---|---|
| `is_test = false` a token nejde sestavit | trvalá chyba `unsubscribe_url_missing`, zpráva **neodejde**. Zpráva bez možnosti odhlášení odejít nesmí. |
| `is_test = true` | do těla i hlavičky se dosadí `{TRACKING_DOMAIN}/u/test`, což je stránka s vysvětlením, že šlo o testovací zprávu. Hlavička `List-Unsubscribe-Post` se **nepřidává**, aby si poštovní klient nemyslel, že jde o funkční one-click. |

### 3.8 Struktura MIME zprávy

#### 3.8.1 Kostra

```
Date: Fri, 31 Jul 2026 09:14:02 +0000
Message-ID: <0192f4c1-8a2e-7b13-9f45-2c6d8e0a1b33@mail.example.cz>
From: =?utf-8?B?SmFuIE5vdsOhaw==?= <newsletter@mail.example.cz>
To: <jana@example.cz>
Reply-To: <podpora@example.cz>
Subject: =?utf-8?B?TGV0bsOtIHbDvXByb2RlaiB6YcSNw610w6E=?=
MIME-Version: 1.0
List-Unsubscribe: <https://app.example.com/u/t1.AbCdEf...>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
Feedback-ID: 7f3a2b10:9c1d4e55:campaign:openengage
Precedence: bulk
Content-Type: multipart/alternative; boundary="----=_OE_9f2c8a41d05b7e63a1c4"

------=_OE_9f2c8a41d05b7e63a1c4
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Dobr=C3=BD den, Jano,
...

------=_OE_9f2c8a41d05b7e63a1c4
Content-Type: text/html; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

<!DOCTYPE html><html>...

------=_OE_9f2c8a41d05b7e63a1c4--
```

**`multipart/alternative`, ne `multipart/mixed`.** Kampaň nemá přílohy. Přidání `multipart/mixed` obalu bez přílohy jen zvětšuje zprávu a některé klienty mate.

**`quoted-printable`, ne `base64`.** Tři důvody: český text zůstane v surové zprávě z větší části čitelný (pomáhá při ladění), u převážně ASCII obsahu je výsledek menší než base64 (které zvětšuje o 33 procent vždy), a splňuje požadavek SES na 7bitový obsah. Řádky se lámou na 76 znaků měkkým zlomem `=`, takže se nikdy nepřekročí limit 998 oktetů na řádek z RFC 5322.

**Boundary.** `----=_OE_` plus 20 hexadecimálních znaků z `crypto/rand`. Generátor je injektovatelný, aby golden fixtures byly deterministické.

**Konec řádku je vždy CRLF.** Včetně prázdného řádku mezi hlavičkami a tělem.

#### 3.8.2 Úplný seznam hlaviček

| Hlavička | Vždy? | Hodnota | Poznámka |
|---|---|---|---|
| `Date` | ano | RFC 5322 date-time v UTC, `+0000` | SES ji přepíše vlastní hodnotou. U SMTP zůstává naše. Generuje se v okamžiku sestavení, ne claimu. |
| `Message-ID` | ano | `<{messages.id}@{doména z from_email}>` | UUID zaručuje globální jedinečnost podle doporučení RFC 5322 §3.6.4. **SES ji přepíše.** U SMTP zůstává a je to náš párovací klíč. |
| `From` | ano | `{RFC 2047 zakódovaný from_name} <{from_email}>` | Když `from_name` je prázdné, jen `<{from_email}>`. |
| `To` | ano | `<{messages.email}>` | Bez display name. Zobrazované jméno nepřináší doručitelnosti nic a přidává další místo, kde může personalizace selhat. |
| `Subject` | ano | interpolovaný předmět, RFC 2047 kódovaný, když není čistě ASCII | Kódování `B` (base64), protože český text má hodně non-ASCII znaků a `Q` by byl delší. Lámání na encoded-words po maximálně 75 znacích včetně obálky. |
| `MIME-Version` | ano | `1.0` | |
| `Content-Type` | ano | `multipart/alternative; boundary="..."` | |
| `Reply-To` | podmíněně | `<{campaigns.reply_to}>` | Jen když je `reply_to` neprázdné a liší se od `from_email`. |
| `List-Unsubscribe` | ano | `<{unsubscribe_url sestavený senderem}>` | Když je nakonfigurovaná i mailto adresa: `<https://...>, <mailto:...>`. HTTPS URI musí být **první**. |
| `List-Unsubscribe-Post` | podmíněně | `List-Unsubscribe=One-Click` | Přidává se **jen** když `List-Unsubscribe` obsahuje HTTPS URI. Jediná povolená hodnota podle RFC 8058. |
| `Feedback-ID` | podmíněně | `{campaign_id_short}:{workspace_id_short}:campaign:openengage` | Jen u SMTP a jen když `SENDER_FEEDBACK_ID=true`. U SES ji nastavuje Configuration Set přes message tagy, viz 3.9.3. Formát podle Google Postmaster Tools: nejvýše 4 pole oddělená `:`, poslední pole je identifikátor odesílatele. |
| `Precedence` | podmíněně | `bulk` | Ovládá `SENDER_PRECEDENCE_BULK`, výchozí `true`. Potlačuje automatické odpovědi typu "jsem na dovolené". Není to standardizovaná hlavička, ale u hromadné pošty je to dlouholetá praxe. |
| `X-OpenEngage-Test` | jen test | `1` | Umožňuje uživateli poznat testovací zprávu v inboxu. |

**Hlavičky, které sender vědomě nenastavuje:**

| Hlavička | Proč ne |
|---|---|
| `Return-Path` | Nastavuje ji provider z envelope MAIL FROM. Kdybychom ji nastavili v hlavičkách, u SES by se stejně přepsala. |
| `DKIM-Signature` | Podepisuje provider. SES podepisuje sám na základě ověřené identity, u SMTP podepisuje relay. Podepisovat v senderu by znamenalo držet privátní klíč v procesu, který nemá práva na nic citlivého, což by ten bezpečnostní model zbytečně narušilo. |
| `Auto-Submitted` | RFC 3834 popisuje automatické **odpovědi**, ne hromadnou poštu. Marketingový mail není auto-reply a označit ho tak je zavádějící. |
| `List-Id` | Publikum kampaně může být sjednocení několika seznamů a segmentů, takže neexistuje jedno správné ID seznamu. Zavedeme, až budou existovat opravdové listové kampaně. |
| `Bcc`, `Cc` | Jeden příjemce na zprávu. Vždy. |
| `Sender` | Nemáme případ užití, kdy by se lišil od `From`. |

**Pořadí hlaviček** je pevné a odpovídá pořadí v tabulce výše. Není to požadavek RFC, ale dělá to golden fixtures deterministické a diff čitelný.

#### 3.8.3 Kódování hlaviček podle RFC 2047

Pravidlo: hlavička, jejíž hodnota je čistě ASCII (bajty 32 až 126), se zapisuje doslova. Jinak se kóduje jako encoded-word.

```
=?utf-8?B?{base64 z UTF-8 bajtů}?=
```

Omezení, která se musí dodržet:

- Jeden encoded-word má nejvýše **75 znaků včetně** `=?utf-8?B?` a `?=`. Delší text se rozdělí na víc encoded-words oddělených CRLF plus mezera (folding).
- Dělit se smí **jen na hranici celého UTF-8 znaku**. Rozdělení vícebajtového znaku uprostřed je nejčastější chyba a projeví se jako rozsypaná diakritika v předmětu.
- V adresní hlavičce (`From`) se kóduje **jen display name**, nikdy adresa. Adresa musí zůstat čistě ASCII (u mezinárodních domén Punycode, což je vstupní požadavek na 4a při validaci `from_email`).

Testovací vektory (musí projít v CI):

| Vstup | Očekávaný výstup |
|---|---|
| `Letní výprodej` | `=?utf-8?B?TGV0bsOtIHbDvXByb2Rlag==?=` |
| `Newsletter` | `Newsletter` (bez kódování, je ASCII) |
| `Jan Novák` (display name) | `=?utf-8?B?SmFuIE5vdsOhaw==?=` |

#### 3.8.4 Soulad s RFC 8058 (One-Click Unsubscribe)

Ověřeno proti plnému znění RFC 8058. Povinnosti odesílatele, kapitola 3.1 a 4 RFC:

| Požadavek RFC | Doslovné znění | Jak ho plníme |
|---|---|---|
| Jedna hlavička každého druhu | *"places one List-Unsubscribe header field and one List-Unsubscribe-Post header field"* | MIME builder je přidává právě jednou. AK-6.6. |
| HTTPS URI je povinné | *"The List-Unsubscribe header field MUST contain one HTTPS URI. It MAY contain other non-HTTP/S URIs such as MAILTO:"* | `TRACKING_DOMAIN` je vždy HTTPS, takže sestavený odkaz taky. Mailto je volitelné a přidává se za něj. |
| Jediná povolená hodnota | *"The List-Unsubscribe-Post header MUST contain the single key/value pair `List-Unsubscribe=One-Click`"* | Konstanta v kódu, nikdy se neskládá. |
| URI musí samo o sobě identifikovat příjemce a seznam | *"MUST contain enough information to identify the mail recipient and the list ... any information about the message or recipient is encoded in the URI"* | Splňuje token typu `u`, který nese `contact_id` i `list_id`. POST nenese žádné další argumenty. |
| Neuhodnutelná složka v URI | *"The URI SHOULD include an opaque identifier or another hard-to-forge component"* | HMAC podpis tokenu. Chrání proti útoku, kdy někdo rozešle spam s odkazy na odhlášení z cizího seznamu. |
| **DKIM musí pokrývat obě hlavičky** | *"The List-Unsubscribe and List-Unsubscribe-Post headers MUST be covered by the signature and included in the `h=` tag"* | **Riziko, viz níže.** |

**Riziko, které je potřeba ověřit před hackathonem.** Podpis DKIM nevytváří sender, ale provider. RFC je v tomhle nekompromisní: když podpis obě hlavičky nepokrývá, *"the mail receiver SHOULD NOT offer a one-click unsubscribe for that message"*. Jinými slovy, tlačítko "Odhlásit" se v Gmailu vedle odesílatele vůbec neobjeví a splnění požadavků Google a Yahoo pro hromadné odesílatele tím padá.

Je proto potřeba **empiricky ověřit**, že Amazon SES do `h=` tagu svého DKIM podpisu zahrnuje `List-Unsubscribe` i `List-Unsubscribe-Post`. Ověření je triviální: poslat si jednu zprávu na Gmail a v jejím zdrojovém kódu si prohlédnout `h=` tag. Vlastní to 4a, protože DKIM je součást doručitelnosti. Kdyby se ukázalo, že SES tyhle hlavičky nepodepisuje, jediným řešením je podepisovat DKIM v senderu, což je otevřená otázka O7 a znamenalo by to změnu bezpečnostního modelu.

**Co z RFC platí pro endpoint, který požadavek přijímá** (vlastní část 2, uvádím kvůli úplnosti kontraktu):

- Přijímá `POST` s tělem `List-Unsubscribe=One-Click`. Typ obsahu je `multipart/form-data` (RFC to doporučuje) nebo `application/x-www-form-urlencoded` (RFC to připouští). **Endpoint musí zvládnout oba.**
- **Nesmí odpovědět přesměrováním.** RFC: *"The mail sender MUST NOT return an HTTPS redirect."* Přesměrovaný POST se v prohlížečích historicky mění na GET.
- Nesmí vyžadovat cookies ani přihlášení. RFC: *"The POST request MUST NOT include cookies, HTTP authorization, or any other context information."*
- Nesmí vyžadovat další potvrzení na stránce. Celý smysl one-click je, že odhlášení proběhne bez interakce. Potvrzovací stránka je porušením účelu, i když ji RFC neřeší doslova.
- Tentýž URI musí na `GET` zobrazit běžnou stránku s preferencemi. RFC to výslovně předpokládá: *"The target of the POST action is the same as the one in the GET action for a manual unsubscription."*

### 3.9 Dispatch přes Amazon SES

#### 3.9.1 Která operace se použije

Používáme **`sesv2.SendEmail` s obsahem typu `Raw`**, tedy `EmailContent{ Raw: &types.RawMessage{ Data: mimeBytes } }`.

Rozbor alternativ, protože je to otázka 10 ze zadání:

| Varianta | Co umí | Proč ji nepoužíváme |
|---|---|---|
| `SendEmail` + `Simple` | SES sestaví MIME sám. Od roku 2024 podporuje i `Message.Headers`, ale nejvýše **15 hlaviček** a **zakazuje** `From`, `To`, `Subject`, `Reply-To`, `Date`, `Message-ID`, `MIME-Version`, `Content-Type`, `Content-Disposition`, `Return-Path`, `Cc`, `Bcc` jako vlastní hlavičky. | Výstupní MIME by se lišil od toho, co posíláme přes SMTP. Vznikly by dvě různé podoby téhož mailu a dvě sady golden fixtures. To je přesně ta třída chyb, kterou chceme vyloučit. |
| `SendEmail` + `Template` | Šablonování na straně SES. | Vázalo by šablony na AWS a znemožnilo SMTP. Rozpor s hlavní specifikací. |
| `SendBulkEmail` | Až 50 příjemců na volání, výrazně vyšší propustnost. | Vyžaduje SES šablony (viz výše) a znemožňuje per příjemce jiné tělo, což je celý smysl personalizace. |
| **`SendEmail` + `Raw`** | Plná kontrola nad MIME. Configuration Set i message tagy fungují stejně jako u `Simple`. | **Zvoleno.** |

Klíčový argument: jeden MIME builder, jedna sada golden fixtures, bajtově stejná zpráva do SES i do SMTP.

Ztrácíme tím jen `Message-ID` a `Date`, protože ty SES přepisuje vlastními hodnotami bez ohledu na variantu. To je ověřený fakt z dokumentace SES ("Amazon SES header fields"), ne domněnka.

#### 3.9.2 Tvar volání

```go
input := &sesv2.SendEmailInput{
    FromEmailAddress: aws.String(from),          // "Jan Novák <newsletter@mail.example.cz>"
    Destination: &types.Destination{
        ToAddresses: []string{recipient},
    },
    Content: &types.EmailContent{
        Raw: &types.RawMessage{ Data: mimeBytes },
    },
    ConfigurationSetName: aws.String(cfg.ConfigurationSetName),
    EmailTags: []types.MessageTag{ /* viz 3.9.3 */ },
}
out, err := client.SendEmail(ctx, input)
// out.MessageId  →  messages.provider_message_id
```

- `FromEmailAddress` a `Destination` se předávají **explicitně**, i když jsou tytéž adresy v MIME hlavičkách. Určují envelope, ne hlavičky, a SES je pro raw obsah takhle používá.
- `out.MessageId` je hodnota, která se zapíše do `messages.provider_message_id`. Je to zároveň klíč, pod kterým dorazí události přes SNS, takže na něj 4a páruje.
- Timeout jednoho volání: `SENDER_DISPATCH_TIMEOUT_SECONDS`, výchozí **10 s**, přes `context.WithTimeout`.

#### 3.9.3 Message tagy

```go
EmailTags: []types.MessageTag{
    {Name: aws.String("oe_msg"),  Value: aws.String(msg.MessageID.String())},
    {Name: aws.String("oe_camp"), Value: aws.String(msg.CampaignID.String())},
    {Name: aws.String("oe_ws"),   Value: aws.String(msg.WorkspaceID.String())},
}
```

Ověřeno v dokumentaci: název i hodnota message tagu smí obsahovat **jen ASCII písmena, číslice, podtržítko a pomlčku**, nejvýše 256 znaků. Kanonický zápis UUID (`0192f4c1-8a2e-7b13-9f45-2c6d8e0a1b33`) tomu vyhovuje, protože pomlčka je povolená. Není potřeba žádné překódování.

K čemu tagy slouží:

1. **`oe_msg` je záchranná síť pro nejisté zprávy** (3.4.5). Bez něj by po pádu senderu nešlo spárovat událost se zprávou, u které se `provider_message_id` nikdy nezapsalo. Tohle je jeho hlavní důvod existence.
2. `oe_camp` a `oe_ws` umožňují 4a spárovat i událost, jejíž `oe_msg` už neexistuje, a dávají zdarma dimenze v CloudWatch metrikách SES.

**Configuration Set** se předává jako `ConfigurationSetName` a jeho jméno je součástí dešifrované konfigurace provideru. Configuration Set určuje, které události (`Send`, `Delivery`, `Bounce`, `Complaint`, `Reject`, `Open`, `Click`, `DeliveryDelay`) SES publikuje do SNS. Jeho založení a nastavení event destination vlastní 4a.

Když `configuration_set_name` v konfiguraci chybí, sender **odmítne kampaň odeslat** s fatální chybou `ses_configuration_set_missing`. Bez Configuration Setu nechodí události, tedy nefunguje suppression list ani smíření nejistých zpráv, a rozesílat bez toho je cesta k zablokování AWS účtu.

#### 3.9.4 Konfigurace AWS SDK

```go
awsCfg, _ := config.LoadDefaultConfig(ctx,
    config.WithRegion(c.Region),
    config.WithCredentialsProvider(
        credentials.NewStaticCredentialsProvider(c.AccessKeyID, c.SecretAccessKey, ""),
    ),
    config.WithRetryMaxAttempts(1),   // retry si řídíme sami, viz níže
)
client := sesv2.NewFromConfig(awsCfg)
```

**Vestavěný retry SDK vypínáme** (`WithRetryMaxAttempts(1)`). Důvody:

1. SDK by opakovalo volání uvnitř jednoho `Dispatch`, tedy **za našimi zády a bez zápisu do databáze**. Kdyby první pokus u SES uspěl a odpověď se ztratila, SDK by poslalo znovu a vznikla by duplicita, kterou bychom vůbec nezaznamenali. Přesně to, čemu se celou kapitolou 3.4 bráníme.
2. Náš vlastní retry (3.12) je viditelný v databázi, respektuje throttling a počítá se do `attempts`.

Credentials se **nečtou z prostředí ani z instance role**. Berou se výhradně z dešifrované konfigurace provideru, protože každý projekt má vlastní SES účet (hlavní specifikace 6.1). Statický credentials provider je tedy záměr, ne zjednodušení.

#### 3.9.5 Kvóty a sandbox

Sender kvóty **nezjišťuje**. Zjišťování kvót i detekci sandboxu vlastní 4a a výsledek zapisuje do konfigurace provideru jako `max_send_rate`. Sender ho jen čte. (V SES API v2 operace `GetSendQuota` z v1 neexistuje, kvóty se čtou z odpovědi operace na úrovni účtu. Přesný název operace a polí je věcí 4a, sender ji nevolá.)

Odůvodnění: kvóty se mění řádově v hodinách, sender by je zjišťoval zbytečně a přidal by si tím další AWS oprávnění. Když se kvóta změní, 4a přepíše konfiguraci a sender si jí všimne při dalším načtení do cache (do 60 s, viz 3.15).

Když sender narazí na chybu typu "překročena denní kvóta", řeší ji jako fatální pro kampaň (3.13), tedy kampaň pozastaví, a 4a to zobrazí uživateli.

### 3.10 Dispatch přes SMTP

#### 3.10.1 Pool spojení

SMTP připojení je drahé (TCP, TLS handshake, EHLO, AUTH), typicky 100 až 300 ms. Otevírat ho pro každou zprávu by propustnost srazilo na jednotky za sekundu.

```
pool velikosti SENDER_SMTP_MAX_CONNECTIONS (výchozí 4, rozsah 1 až 32)
 ├─ spojení se drží otevřené a mezi zprávami se resetuje příkazem RSET
 ├─ po SENDER_SMTP_MAX_MESSAGES_PER_CONN zprávách (výchozí 100) se zavře a otevře nové
 ├─ po 60 s nečinnosti se zavře
 └─ při jakékoliv chybě spojení se spojení zahodí, nevrací se do poolu
```

Limit zpráv na spojení je proto, že mnoho MTA (Postfix, Exim) má `smtpd_client_message_rate_limit` nebo obdobu a spojení po N zprávách samo zavře. Recyklovat ho preventivně je levnější než řešit chybu.

`SENDER_SMTP_MAX_CONNECTIONS` je nezávislé na `SENDER_CONCURRENCY`. Když je workerů víc než spojení, čekají na volné spojení v poolu. Rozumné je držet je stejné nebo mít spojení méně.

#### 3.10.2 TLS a autentizace

| `encryption` v konfiguraci | Chování | Typický port |
|---|---|---|
| `starttls` (výchozí) | Připojí se nešifrovaně, pošle `EHLO`, vyžádá `STARTTLS`. Když server `STARTTLS` neinzeruje, **spojení se zruší** s chybou `smtp_starttls_unavailable`. | 587 |
| `tls` | TLS hned od navázání spojení (implicit TLS). | 465 |
| `none` | Bez šifrování. | 25 |

Ověřování certifikátu serveru je **zapnuté vždy**, kromě případu, kdy je v konfiguraci explicitně `insecure_skip_verify: true`. Tuhle volbu smí nastavit jen 4a v UI, doprovodit varováním, a sender ji při startu zaloguje na úrovni WARN.

**Autentizace se nikdy neposílá po nešifrovaném spojení.** Když je `encryption: none` a zároveň jsou vyplněné `username` a `password`, sender odmítne odeslat s fatální chybou `smtp_insecure_auth_refused`. Přepíná se výslovným `allow_insecure_auth: true`.

Mechanismy: `PLAIN` a `LOGIN`, podle toho, co server inzeruje v `EHLO`. `CRAM-MD5` nepodporujeme, je zastaralý a prakticky se nevyskytuje u provozovatelů, které chceme podporovat.

#### 3.10.3 Timeouty a envelope

| Fáze | Timeout | Konfigurace |
|---|---|---|
| TCP connect | 10 s | `SENDER_SMTP_CONNECT_TIMEOUT` |
| TLS handshake | 10 s | součást connect timeoutu |
| Příkazy (EHLO, MAIL, RCPT) | 30 s | `SENDER_SMTP_COMMAND_TIMEOUT` |
| DATA (přenos těla) | 120 s | `SENDER_SMTP_DATA_TIMEOUT` |

Envelope:

- `MAIL FROM:<{return_path}>` kde `return_path` je z konfigurace provideru, a když chybí, použije se `from_email`.
- `RCPT TO:<{messages.email}>`, vždy právě jeden příjemce.

**Provider message ID u SMTP.** SMTP server v odpovědi na `DATA` obvykle vrací něco jako `250 2.0.0 Ok: queued as 4Wq8Zt2xVzz1KX`. Sender z odpovědi vytáhne poslední token a uloží ho do `provider_message_id` s prefixem `smtp:`. Když se nedá nic rozumného vytáhnout, uloží se `Message-ID` hlavička, kterou jsme sami vygenerovali, s prefixem `msgid:`. Tím je `provider_message_id` vždy vyplněné a 4a má na co párovat.

#### 3.10.4 Detekce bounců u SMTP

Sender jich detekuje jen jednu třídu: **synchronní odmítnutí během SMTP relace**. Když server na `RCPT TO` odpoví `550`, je to okamžitý hard bounce a sender ho zapíše jako `failed` s kódem `smtp_recipient_rejected` a `error.provider_code = "550"`.

Asynchronní bounce, tedy zpráva, kterou server nejprve přijme a teprve pak vrátí, sender nevidí vůbec. Řeší se čtením bounce mailboxu (fáze 2) nebo webhookem providera, a vlastní to 4a. Viz kapitola 10.

### 3.11 Throttling

#### 3.11.1 Algoritmus

**Token bucket** přes `golang.org/x/time/rate`, jeden limiter na `provider_id`, sdílený všemi workery v procesu.

```
limit  = provider.max_send_rate / SENDER_REPLICAS × SENDER_RATE_SAFETY
burst  = max(1, ceil(limit))
```

- **Závazným zdrojem rychlosti je sloupec `sending_providers.quota_max_send_rate`**, který 4a aktualizuje každých 15 minut z `GetAccount`. Sender ho čte a použije. Hodnotu `max_send_rate` z dešifrované obálky bere **jen tehdy, když je sloupec `NULL`**. Rozdělení je záměr části 4a: kvóta se tak dá měnit bez přešifrovávání konfigurace.
- Sender **nikdy nevolá `GetAccount` sám.** Při víc bězích senderu by to narazilo na rate limit SES API a je to práce aplikace.
- `SENDER_RATE_SAFETY` je výchozí **0,9**. Rezerva na to, že hodiny senderu a SES se přesně neshodují a že se počítá i doba doručení požadavku.
- `burst` rovný jedné sekundě limitu dovolí krátkou špičku po nečinnosti, ale ne dlouhou.

Worker volá `limiter.Wait(ctx)` jako krok D0, tedy **před markerem**. Čeká se před tím, než se cokoliv zapíše, takže čekající zpráva nezabírá stav v databázi.

#### 3.11.2 Dělení kvóty mezi víc senderů

MVP 0 dělí kvótu **staticky** podle konfigurační proměnné `SENDER_REPLICAS` (výchozí 1).

Proč ne dynamická koordinace: sdílený token bucket by potřeboval buď Redis (hlavní specifikace ho pro MVP 0 vylučuje), nebo zapisovatelnou tabulku, což by rozšířilo práva senderu. Cena statického dělení je malá, protože je samoopravné:

- **Nastaveno příliš vysoko** (běží méně senderů než `SENDER_REPLICAS`): odesílá se pomaleji, než by se mohlo. Nic se nerozbije.
- **Nastaveno příliš nízko** (běží víc senderů): provider začne vracet throttling chyby. Sender je klasifikuje jako opakovatelné, zpomalí (viz 3.11.3) a zprávy se doručí. Nic se neztratí.

Do UI patří poznámka, že po přidání repliky senderu se má `SENDER_REPLICAS` zvednout.

#### 3.11.3 Reakce na throttling (odpověď 429)

Na chybu klasifikovanou jako `Retryable` s příznakem throttling (u SES `TooManyRequestsException`, u SMTP kód `421` nebo `450 4.7.x`) reaguje sender **AIMD** (aditivní růst, multiplikativní pokles):

```
při throttlingu:   limit ← max(1.0, limit × 0.5)     okamžitě
každých 30 s bez
throttlingu:       limit ← min(target, limit × 1.2)  postupný návrat
```

Provádí se přes `Limiter.SetLimit()`, tedy za běhu, bez přerušení dispatchi. Dolní mez 1 zpráva za sekundu zajistí, že se odesílání nikdy nezastaví úplně.

Zpráva, která narazila na throttling, se vrací na `pending` přes D3b s krátkým backoffem (5 s plus jitter), **nezapočítává se do `attempts`** jako běžné selhání. Sníží se `attempts` zpět o jedna, protože throttling není chyba té zprávy.

Když provider v odpovědi pošle `Retry-After` (u SES v HTTP hlavičce, u SMTP se to nevyskytuje), respektuje se místo výpočtu.

Metrika `sender_rate_limit_current{provider}` ukazuje aktuální limit, takže je v Grafaně vidět, kdy sender škrtí sám sebe.

### 3.12 Klasifikace chyb, retry a backoff

#### 3.12.1 Tři třídy

| Třída | Co s ní | Dopad |
|---|---|---|
| `Retryable` | D3b, zpět na `pending` s backoffem | jedna zpráva |
| `Permanent` | D3c, `failed` | jedna zpráva |
| `Fatal` | D3d, zpět na `pending` bez započtení pokusu, plus circuit breaker | celá kampaň |

Rozdíl mezi `Retryable` a `Fatal` je zásadní. Když jsou v konfiguraci špatné přístupové údaje, každá z padesáti tisíc zpráv selže pětkrát a nadělá 250 tisíc zbytečných volání. `Fatal` tomu zabrání tím, že po několika stejných chybách kampaň pozastaví.

#### 3.12.2 Tabulka klasifikace, SES

| Chyba SDK / stav | Třída | Náš kód | Poznámka |
|---|---|---|---|
| `types.TooManyRequestsException` | Retryable (throttling) | `rate_limited` | Sníží lokální limit (3.11.3) |
| `types.InternalServiceErrorException` | Retryable | `provider_unavailable` | Chyba na straně AWS |
| HTTP 500, 502, 503, 504 | Retryable | `provider_unavailable` | |
| `context.DeadlineExceeded`, timeout, reset spojení, chyba DNS | Retryable | `network_error` | |
| `types.SendingPausedException` | Fatal | `sending_paused` | AWS pozastavil odesílání na účtu |
| `types.AccountSuspendedException` | Fatal | `account_suspended` | |
| `types.MailFromDomainNotVerifiedException` | Fatal | `mail_from_not_verified` | Chyba konfigurace, opakování nepomůže |
| `types.NotFoundException` na Configuration Set | Fatal | `ses_configuration_set_missing` | |
| HTTP 403, `AccessDenied`, `InvalidClientTokenId`, `SignatureDoesNotMatch` | Fatal | `provider_auth_failed` | Špatné credentials |
| `types.LimitExceededException` (denní kvóta) | Fatal | `ses_daily_quota_exceeded` | Kampaň se pozastaví, uživatel ji obnoví další den |
| `types.MessageRejected` | Permanent | `message_rejected` | Obsah nebo adresa odmítnuté SES |
| `types.BadRequestException`, HTTP 400 mimo výše uvedené | Permanent | `invalid_request` | |
| Lokální selhání validace adresy | Permanent | `invalid_recipient` | Nikdy nedojde k síťovému volání |
| Selhání dešifrování konfigurace provideru | **Fatal, nikdy Permanent** | `credentials_undecryptable` | Viz níže |

**Selhání dešifrování konfigurace nesmí být trvalá chyba.** Je to chyba **konfigurace instalace**, ne konkrétní zprávy: typicky někdo restartoval s jiným `SECRET_KEY` nebo odebral `SECRET_KEY_PREVIOUS` moc brzy. Kdyby se klasifikovala jako trvalá, označil by sender během několika minut celou kampaň, tedy klidně milion zpráv, jako neúspěšné a uživatel by je musel ručně obnovovat. Správné chování je vrátit zprávu na `pending` s backoffem (D3d) a pozastavit kampaň; rozdíl je milion nenávratně označených zpráv proti minutě zpoždění.

Totéž platí pro všechny chyby třídy `Fatal` obecně: **žádná z nich nesmí zprávu označit jako `failed`.** Třída `Fatal` zastavuje kampaň, ne jednotlivé zprávy. V protokolu 3.4.1 to zajišťuje varianta D3d, která vrací zprávu na `pending` a navíc snižuje `attempts` zpět, aby fatální chyba nespotřebovala pokus.

**Stav ověření.** Existence všech uvedených typů v balíčku `github.com/aws/aws-sdk-go-v2/service/sesv2/types` byla ověřena na pkg.go.dev k 2026-07-31. Balíček obsahuje navíc `AlreadyExistsException`, `ConcurrentModificationException`, `ConflictException` a `InvalidNextTokenException`, které se u `SendEmail` nevyskytují a klasifikaci nepotřebují. Všechny implementují `ErrorCode()` a `ErrorMessage()`, takže se dají rozlišit přes `errors.As` a `ErrorCode()` se zapisuje do `error.provider_code`.

Neověřené a k potvrzení při implementaci: **jestli SES rozlišuje překročení sekundové a denní kvóty různými typy chyb.** Předpokládám `TooManyRequestsException` pro sekundovou a `LimitExceededException` pro denní. Kdyby to tak nebylo, sender by denní kvótu považoval za throttling, donekonečna zpomaloval a kampaň by nikdy nepozastavil. Ověří se jednou zprávou nad vyčerpanou kvótou v sandboxu.

#### 3.12.3 Tabulka klasifikace, SMTP

Základní pravidlo: první číslice odpovědi. `4xx` je dočasné, `5xx` trvalé. Výjimky, které se v praxi vyplatí ošetřit zvlášť:

| Odpověď | Třída | Náš kód |
|---|---|---|
| `421` (service not available, closing) | Retryable (throttling) | `rate_limited` |
| `450`, `451`, `452` | Retryable | `smtp_temporary_failure` |
| `454` (TLS temporarily unavailable) | Retryable | `smtp_tls_temporary` |
| `4xx` ostatní | Retryable | `smtp_temporary_failure` |
| `530`, `534`, `535` (auth) | **Fatal** | `provider_auth_failed` |
| `550` na `RCPT TO` | Permanent | `smtp_recipient_rejected` |
| `550` na `DATA`, `552`, `554` | Permanent | `smtp_message_rejected` |
| `5xx` ostatní | Permanent | `smtp_permanent_failure` |
| chyba spojení, TLS, DNS | Retryable | `network_error` |
| `smtp_starttls_unavailable` | Fatal | `smtp_starttls_unavailable` |

`5xx` na `AUTH` je Fatal, ne Permanent, protože špatné heslo se týká všech zpráv, ne jedné.

#### 3.12.4 Backoff a počet pokusů

```
attempt 1 selhal → čeká   30 s
attempt 2 selhal → čeká    2 min
attempt 3 selhal → čeká    8 min
attempt 4 selhal → čeká   32 min
attempt 5 selhal → failed, kód max_attempts_exceeded
```

Formule: `base × factor^(attempts-1)` s `base = 30 s`, `factor = 4`, stropem `SENDER_MAX_BACKOFF_SECONDS` (výchozí 3 600).

**Jitter je povinný.** K vypočtené prodlevě se přičte náhodná hodnota z intervalu `<0, prodleva × 0,2>`. Bez něj by se po výpadku providera všech padesát tisíc zpráv pokusilo znovu ve stejnou vteřinu (thundering herd).

`SENDER_MAX_ATTEMPTS`, výchozí **5**, rozsah 1 až 20.

Throttling se do `attempts` nezapočítává (3.11.3). Fatální chyby také ne (D3d).

**Kam jde trvalé selhání.** Do `status='failed'` se strukturovanou chybou. Sender nic dalšího nedělá. Zapsání adresy na suppression list, upozornění uživatele a zobrazení v reportu vlastní 4a a 5, protože sender nemá práva na `suppressions` a nemá vidět do kontaktů.

### 3.13 Circuit breaker a pozastavení kampaně

Sender drží per kampaň dva nezávislé ukazatele:

| Ukazatel | Práh | Původ | Nuluje se |
|---|---|---|---|
| po sobě jdoucí `Fatal` chyby | 3 | `SENDER_FATAL_THRESHOLD` | jakýmkoliv úspěchem |
| podíl selhání renderu z prvních `min(1000, velikost publika)` zpráv, nejméně 10 selhání | 5 % | kontraktní 4.10.2, zpřesněno revizí části 3 | nenuluje se, počítá se jednorázově z okna |

Druhý ukazatel přebírám z kontraktu a nahrazuje můj původní návrh "20 chyb renderu za sebou". Kontraktní pravidlo je lepší, protože nereaguje na náhodný shluk a zároveň zastaví kampaň dřív, než se rozešle víc než padesát vadných mailů.

Při dosažení prahu sender:

1. Přestane claimovat pro tuhle kampaň (vypadne z rotace).
2. Vrátí všechny nedotčené claimnuté zprávy kampaně zpět na `pending`.
3. Zapíše:

```sql
UPDATE campaigns
SET status = 'paused',
    pause_reason = jsonb_build_object(
      'source', 'sender',
      'code', $1,
      'message', $2,
      'at', now()
    )
WHERE id = $3 AND status = 'sending';
```

4. Zaloguje na úrovni ERROR a zvýší metriku `sender_circuit_breaker_trips_total{code}`.

Podmínka `AND status = 'sending'` zajistí, že sender nepřepíše stav kampaně, kterou mezitím zrušil uživatel.

**Rozšíření práv bylo schváleno** (K21). Platí tři omezení, která musí být v kontraktu:

1. Grant je **sloupcový**, přesně `UPDATE (status, pause_reason)`, nikdy na celou tabulku.
2. Sender smí provést **jediný přechod: `sending → paused`**, a jen se současným zápisem `pause_reason`. Žádné jiné cílové stavy, žádné odpauzování. Obnovení kampaně je výhradně akce uživatele nebo aplikace.
3. Každé pozastavení se zapíše do auditu, aby uživatel v UI viděl, že kampaň zastavil nástroj a proč.

Podmínka `AND status = 'sending'` v dotazu níže vynucuje omezení 2 na úrovni databáze, ne jen v kódu.

**K omezení 3 mám věcnou překážku.** Kontraktní role senderu má u `audit_log` výslovně napsáno "žádná práva", a rozšiřovat ji o další tabulku je přesně to, čemu se u bezpečnostní hranice chceme vyhnout. Navrhuji proto zápis do auditu **nedělat ze senderu**, ale odvodit ho:

| Varianta | Hodnocení |
|---|---|
| `GRANT INSERT ON audit_log` senderu | Splní požadavek doslova, ale rozšiřuje hranici o třetí zapisovatelnou tabulku. Nedoporučuji. |
| **Sender zapíše `circuit_breaker_open` do `message_events`** (grant už má) **a `pause_reason` do `campaigns`; auditní záznam z toho vyrobí job `campaign.watchdog` části 4a** | Uživatel vidí totéž, hranice se nerozšiřuje. **Doporučuji.** |
| Auditní záznam se negeneruje, stačí `pause_reason` | Nesplňuje požadavek. |

Rozhodnutí patří orchestrátorovi, zapsal jsem ho jako P1.12 a P4a.24. Do rozhodnutí implementuji druhou variantu.

Zápis, kterým se kampaň pozastaví:

```sql
UPDATE campaigns
SET status = 'paused',
    pause_reason = jsonb_build_object(
      'source', 'sender',
      'code', $1,          -- kód z katalogu 4.2
      'detail', $2,
      'sender_id', $3,
      'at', now()
    )
WHERE id = $4 AND status = 'sending';
```

Sloupec `campaigns.pause_reason jsonb` v části 1 ani v hlavní specifikaci zatím neexistuje a musí se doplnit, viz P1.10.

Obnovení kampaně je vždy **ruční akce uživatele** v aplikaci. Sender kampaň sám nikdy neodpauzuje, protože netuší, jestli byla příčina odstraněna.

### 3.14 Graceful shutdown

Po `SIGTERM` nebo `SIGINT`:

```
1. Zaznamená se deadline = now + SHUTDOWN_GRACE_SECONDS (výchozí 25 s).
2. Claimer se okamžitě zastaví a zavře kanál. Žádné nové claimy.
3. campaignPoller a reaper se zastaví.
4. Heartbeat běží dál až do kroku 7. Bez toho by reaper jiné instance
   sebral rozpracované zprávy, které tahle instance ještě dokončuje.
5. Workery dojedou kanál:
     ├─ zprávy v kanálu, které ještě nemají marker → hromadně zpět na pending
     │    UPDATE messages SET status='pending', claimed_by=NULL, claimed_at=NULL,
     │           next_attempt_at=now(), updated_at=now()
     │    WHERE created_at = ANY($1) AND id = ANY($2) AND status='claimed'
     │      AND claimed_by = $3 AND dispatch_started_at IS NULL;
     └─ zprávy rozpracované (po D1) se dokončí normálně, včetně D3
6. Když se všichni workeři dokončí před deadlinem → čistý konec.
7. Na deadlinu se zruší kořenový kontext. Probíhající volání se přeruší.
   Řádky zůstanou claimed s markerem a reaper B je po 2x TTL označí ambiguous_dispatch.
8. Zavře se pool spojení SMTP, pgxpool, HTTP server. Proces končí kódem 0.
```

**Exit kód je 0 i při vypršení deadlinu.** Nenulový kód by v Dockeru a Kubernetes vypadal jako pád a spustil restart smyčku. Signálem je log na úrovni WARN a metrika `sender_shutdown_forced_total`.

`SHUTDOWN_GRACE_SECONDS` musí být menší než `stop_grace_period` orchestrátoru, jinak pošle `SIGKILL` dřív, než sender stihne dojet. Část 1 volí 25 s proti `stop_grace_period: 40s`, tedy 15 s rezervy. Přebírám obojí.

**Odpověď na "co s rozpracovanou dávkou":** zprávy, které se ještě nezačaly odesílat, se okamžitě a bezpečně vrátí do fronty, protože o nich máme důkaz. Zprávy v letu se dokončí. V nejhorším případě jich `SENDER_CONCURRENCY` skončí jako nejisté.

### 3.15 Cache kampaní a providerů

| Co | Klíč cache | Doba platnosti | Co při změně |
|---|---|---|---|
| Kampaň včetně zparsovaných šablon | `(campaign_id, revision)` | do změny `revision` nebo 15 min | Změna `revision` invaliduje záznam a šablony se přeparsují |
| Dešifrovaná konfigurace provideru | `provider_id` | 60 s | Po vypršení se načte a dešifruje znovu |
| `Dispatcher` (SES klient, SMTP pool) | `provider_id` + hash konfigurace | do změny hashe | Při změně se starý zavře a vytvoří nový |

`campaigns.revision integer` doplnila část 4a na můj návrh. Inkrementuje se při každé změně kterékoliv zmrazené vlastnosti kampaně, prakticky tedy jen ve stavu `draft`. Sender ho načte claim dotazem, který na `campaigns` stejně joinuje, a použije `(campaign_id, revision)` jako klíč cache. **Cache pak nepotřebuje TTL a nemůže zastarat**, což je proti mému původnímu návrhu s patnáctiminutovou platností jednodušší i spolehlivější.

Dešifrovaná konfigurace se drží v paměti, nikdy se nezapisuje na disk ani do logu. Struktura, která ji nese, má vlastní `String()` a `MarshalJSON()` vracející `"[redacted]"`, aby se heslo nemohlo dostat do logu omylem.

---

## 4. Rozhraní

### 4.1 Konfigurace

**Názvy a výchozí hodnoty přebírám z části 1, sekce 4.9.** Validuje se při startu, při chybě se vypíšou **všechny** problémy naráz a proces skončí s exit code **78** (`EX_CONFIG`), stejně jako TypeScriptová strana. Shodu hlídá test `config-parity` proti `packages/contracts/config.json`.

**Proměnné z části 1, které sender čte** (sloupec "Kdo" obsahuje `S`):

| Proměnná | Typ | Povinná | Výchozí | Poznámka pro sender |
|---|---|---|---|---|
| `DATABASE_URL_SENDER` | URL | ne | odvozeno z `DATABASE_URL` s uživatelem `openengage_sender` | při `MODE=sender` povinná |
| `SECRET_KEY` | string | **ano** | | čistý `<base64url>` bez paddingu, po dekódování přesně 32 B. Bez prefixu, viz poznámka pod tabulkou. |
| `SECRET_KEY_PREVIOUS` | string | ne | prázdné | až 5 položek, jen pro dešifrování |
| `MODE` | enum | ne | `all` | sender běží při `sender` a `all` |
| `SENDER_ID` | string | ne | hostname a PID | do `messages.claimed_by`, max 64 znaků |
| `SENDER_CONCURRENCY` | int | ne | 32 | 1 až 1024 |
| `SENDER_BATCH_SIZE` | int | ne | 500 | 1 až 5000 |
| `SENDER_CLAIM_TTL_SECONDS` | int | ne | 300 | 30 až 3600 |
| `SENDER_POLL_INTERVAL_MS` | int | ne | 1000 | 100 až 60000 |
| `SHUTDOWN_GRACE_SECONDS` | int | ne | 25 | 1 až 300 |
| `TRACKING_DOMAIN` | string | ne | odvozeno z `APP_URL` | **viz rozpor K7** |
| `HEALTH_PORT` | int | ne | 3001 | `/healthz`, `/readyz` |
| `LOG_LEVEL` | enum | ne | `info` | `trace` až `fatal` |
| `LOG_FORMAT` | enum | ne | `json` | `pretty` jen mimo produkci |
| `METRICS_ENABLED` | bool | ne | `false` | |
| `METRICS_TOKEN` | string | ne | prázdné | povinný při `METRICS_ENABLED=true`, min. 32 znaků |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL | ne | prázdné | prázdné = žádná telemetrie |
| `IMAGE_VERSION` | string | ne | z buildu | jen ke čtení |

**Poznámka k formátu `SECRET_KEY`.** Orchestrátor rozhodl, že platí **čistý base64url**, 32 bajtů po dekódování, a `key_id` patří výhradně do hlavičky šifrovací obálky a do tokenu. Řídím se tím a sender tak `SECRET_KEY` parsuje.

Zaznamenávám jen jednu věc k dořešení, aby nespadl test `config-parity`: **dokument části 1 dnes uvádí opak, a to na dvou místech**, v sekci 3.10 (*"`SECRET_KEY` | `<base64url>` nebo `<key_id>:<base64url>`"*) i v tabulce 4.9 (*"`[<key_id>:]<base64url>`"*). Části 1 to tedy musí projít s rozhodnutím, jinak budou Go a TypeScript parsovat tutéž proměnnou různě.

S tím souvisí jedna otázka, kterou rozhodnutí otevírá: `SECRET_KEY_PREVIOUS` nese explicitní `key_id` u každé položky. Když ho aktuální klíč nenese, musí být určeno, jaké `key_id` se razítkuje na nově vytvářené obálky. Implicitní `1` funguje jen do první rotace. Sender obálky nevytváří, takže se ho to týká jen nepřímo, ale parsovat proměnnou musí stejně jako aplikace. Zapsáno jako P1.13.

**Problém s `TRACKING_DOMAIN`.** Sender z ní staví `/t/o/<token>` a `/t/c/<token>`. Její výchozí hodnota se odvozuje z `APP_URL`, ale `APP_URL` sender podle tabulky 4.9 nedostává. Když ji operátor nenastaví, sender nemá z čeho odkazy postavit a nenastartuje. Návrh řešení v rozporu K7. Do rozhodnutí považuji `TRACKING_DOMAIN` pro `MODE=sender` za **povinnou** a při jejím chybění odmítám start s hláškou, která to vysvětluje.

**Proměnné, které do části 1 navrhuji doplnit.** Všechny mají výchozí hodnotu, takže bez nich sender funguje; potřebuje je provoz, který chce ladit odesílání.

| Proměnná | Typ | Výchozí | Validace a důvod |
|---|---|---|---|
| `SENDER_REPLICAS` | int | 1 | 1 až 100. Statické dělení kvóty provideru, viz 3.11.2. |
| `SENDER_RATE_SAFETY` | float | 0.9 | 0.1 až 1.0. Rezerva proti nepřesnosti hodin. |
| `SENDER_MAX_ATTEMPTS` | int | 5 | 1 až 20. |
| `SENDER_MAX_BACKOFF_SECONDS` | int | 3600 | 1 až 86400. |
| `SENDER_DISPATCH_TIMEOUT_SECONDS` | int | 10 | 1 až 300. Timeout jednoho volání provideru. Musí platit `SENDER_CLAIM_TTL_SECONDS > 4 ×` tato hodnota. |
| `SENDER_FATAL_THRESHOLD` | int | 3 | 1 až 100. Circuit breaker, viz 3.13. |
| `SENDER_SMTP_MAX_CONNECTIONS` | int | 4 | 1 až 32. |
| `SENDER_SMTP_MAX_MESSAGES_PER_CONN` | int | 100 | 1 až 10000. |
| `SENDER_SMTP_CONNECT_TIMEOUT_SECONDS` | int | 10 | |
| `SENDER_SMTP_COMMAND_TIMEOUT_SECONDS` | int | 30 | |
| `SENDER_SMTP_DATA_TIMEOUT_SECONDS` | int | 120 | |
| `SENDER_PRECEDENCE_BULK` | bool | `true` | Hlavička `Precedence: bulk`, viz 3.8.2. |
| `SENDER_FEEDBACK_ID` | bool | `true` | Hlavička `Feedback-ID` u SMTP. |
| `SENDER_TEST_TRACKING` | bool | `false` | Trackovat testovací odeslání. |

`AMBIGUOUS_DISPATCH_POLICY` v seznamu **není**, protože ji podle kontraktu vlastní část 4a a čte ji reaper. Sender ji jen předá jako parametr `$1` do dotazu B (3.3).

**Křížové validace při startu**, při porušení se nestartuje:

- `SENDER_CLAIM_TTL_SECONDS > 4 × (SENDER_CLAIM_TTL_SECONDS / 3)`, tedy heartbeat se stihne aspoň třikrát. Platí z definice, kontroluje se pro případ, že by se interval heartbeatu stal konfigurovatelným.
- `SENDER_CLAIM_TTL_SECONDS > 4 × SENDER_DISPATCH_TIMEOUT_SECONDS`.
- `SENDER_CONCURRENCY + 4` spojení se vejde do `max_connections` databáze; zjišťuje se dotazem `SHOW max_connections` při startu a při nevejití se vypíše varování, ne pád.
- `SHUTDOWN_GRACE_SECONDS` je menší než `stop_grace_period` v compose (40 s podle části 1). Sender to nemůže ověřit, je to poznámka v dokumentaci.
- `SECRET_KEY` se dekóduje na přesně 32 bajtů a není to ukázkový klíč z dokumentace.

**Tajemství ze souborů.** Každá proměnná přijímá variantu se sufixem `_FILE` (`SECRET_KEY_FILE=/run/secrets/secret_key`), při existenci obou vyhrává `_FILE`. Kontraktní chování z části 1, sekce 4.9, sender ho implementuje stejně.

### 4.2 Katalog chybových kódů

Zapisují se do kontraktních sloupců `messages.error_code` a `messages.error_detail`:

```
error_code   = "rate_limited"
error_detail = "TooManyRequestsException: Maximum sending rate exceeded (attempt 2, sender-0)"
```

`error_code` je vždy jeden z katalogu níže a je to jediné, na co se smí aplikace strojově spolehnout. `error_detail` je diagnostický text ve tvaru `"<kód providera>: <hláška> (attempt <n>, <sender_id>)"`, zkrácený na 1 000 znaků. Nikdy neobsahuje e-mailovou adresu ani obsah zprávy.

V konceptu jsem tady měl `jsonb`. Kontrakt 4.10.1 části 1 má dva `text` sloupce, takže strukturu přesouvám do kódu a detailu.

| Kód | Třída | Text pro uživatele (cs) | Text pro uživatele (en) |
|---|---|---|---|
| `rate_limited` | retryable | Poskytovatel dočasně omezil rychlost odesílání. Zkusíme to znovu. | The provider is throttling us. We will retry. |
| `provider_unavailable` | retryable | Poskytovatel je dočasně nedostupný. Zkusíme to znovu. | The provider is temporarily unavailable. We will retry. |
| `network_error` | retryable | Chyba sítě při odesílání. Zkusíme to znovu. | Network error while sending. We will retry. |
| `smtp_temporary_failure` | retryable | Server příjemce dočasně odmítl zprávu. Zkusíme to znovu. | The recipient server temporarily rejected the message. We will retry. |
| `smtp_tls_temporary` | retryable | Šifrované spojení se dočasně nepodařilo navázat. | The encrypted connection could not be established. |
| `provider_auth_failed` | fatal | Přístupové údaje k poskytovateli odesílání nejsou platné. Kampaň je pozastavená. | The sending provider credentials are invalid. The campaign is paused. |
| `sending_paused` | fatal | Amazon pozastavil odesílání na tomto účtu. | Amazon has paused sending on this account. |
| `account_suspended` | fatal | Účet Amazon SES je pozastavený. | The Amazon SES account is suspended. |
| `mail_from_not_verified` | fatal | Odesílací doména není u Amazon SES ověřená. | The sending domain is not verified with Amazon SES. |
| `ses_configuration_set_missing` | fatal | Configuration Set neexistuje. Bez něj nefungují statistiky ani suppression list. | The configuration set does not exist. Without it, statistics and the suppression list do not work. |
| `ses_daily_quota_exceeded` | fatal | Vyčerpali jste denní kvótu Amazon SES. Kampaň je pozastavená. | You have exhausted your Amazon SES daily quota. The campaign is paused. |
| `smtp_starttls_unavailable` | fatal | SMTP server nenabízí šifrované spojení. | The SMTP server does not offer an encrypted connection. |
| `smtp_insecure_auth_refused` | fatal | Odmítli jsme poslat heslo po nešifrovaném spojení. | We refused to send the password over an unencrypted connection. |
| `message_rejected` | permanent | Poskytovatel zprávu odmítl. | The provider rejected the message. |
| `smtp_recipient_rejected` | permanent | Server příjemce adresu odmítl. | The recipient server rejected the address. |
| `smtp_message_rejected` | permanent | Server příjemce zprávu odmítl. | The recipient server rejected the message. |
| `smtp_permanent_failure` | permanent | Zprávu se nepodařilo doručit. | The message could not be delivered. |
| `invalid_recipient` | permanent | Adresa příjemce není platná. | The recipient address is not valid. |
| `invalid_request` | permanent | Zpráva neprošla kontrolou poskytovatele. | The message failed the provider's validation. |
| `render_timeout` | permanent | Personalizace trvala příliš dlouho. | Personalization took too long. |
| `subject_too_long` | permanent | Předmět je po doplnění dat příliš dlouhý. | The subject is too long after personalization. |
| `body_too_large` | permanent | Tělo zprávy je příliš velké. | The message body is too large. |
| `message_too_large` | permanent | Zpráva je příliš velká. | The message is too large. |
| `marker_injection_detected` | permanent | Data kontaktu obsahovala vnitřní značku. Zprávu jsme neodeslali. Uplatní se jen v náhradní cestě A (3.7.1). | The contact data contained an internal marker. We did not send the message. Only applies in fallback path A (3.7.1). |
| `marker_not_replaced` | permanent | V odchozí zprávě zůstala nenahrazená vnitřní značka. Zprávu jsme neodeslali. | An internal marker was left unreplaced in the outgoing message. We did not send it. |
| `contract_mismatch` | fatal | Verze editoru a odesílací služby si neodpovídají. Kampaň je pozastavená. | The editor and the sending service are running incompatible versions. The campaign is paused. |
| `unsubscribe_url_missing` | permanent | Chybí odhlašovací odkaz. Zprávu jsme neodeslali. | The unsubscribe link is missing. We did not send the message. |
| `max_attempts_exceeded` | permanent | Vyčerpali jsme všechny pokusy o odeslání. | We exhausted all delivery attempts. |
| `credentials_undecryptable` | **retryable, ne trvalá** | Nastavení poskytovatele se nepodařilo dešifrovat. Nejspíš se změnil `SECRET_KEY`. | The provider configuration could not be decrypted. The `SECRET_KEY` has probably changed. |
| `ambiguous_dispatch` | kontraktní | Nevíme, jestli zpráva odešla. Server se restartoval uprostřed odesílání. | We do not know whether the message was sent. The server restarted mid-send. |
| `render_failed` | permanent | Personalizaci se nepodařilo doplnit. | Personalization could not be applied. |

Texty vlastní i18n katalog v aplikaci (část 1). Sender zapisuje jen `code`, nikdy přeloženou hlášku.

### 4.3 Metriky

Prometheus, endpoint `/metrics` na `HEALTH_PORT`, zapíná ho `METRICS_ENABLED` a chrání `METRICS_TOKEN` v hlavičce `Authorization` (konvence části 1).

| Metrika | Typ | Popisky | K čemu |
|---|---|---|---|
| `sender_messages_dispatched_total` | counter | `provider`, `result` (`sent`, `failed`, `retried`) | propustnost a chybovost |
| `sender_dispatch_duration_seconds` | histogram | `provider` | latence provideru, odhalí zpomalení SES |
| `sender_render_duration_seconds` | histogram | | zda Liquid není úzké hrdlo |
| `sender_claim_batch_rows` | histogram | | jestli claim vrací plné dávky |
| `sender_inflight` | gauge | | kolik zpráv je právě v letu |
| `sender_rate_limit_current` | gauge | `provider` | aktuální limit po AIMD úpravách |
| `sender_throttle_events_total` | counter | `provider` | kolikrát provider škrtil |
| `sender_reaper_requeued_total` | counter | | kolik řádků vrátil reaper do fronty |
| `sender_ambiguous_dispatch_total` | counter | `outcome` (`retried`, `failed`) | **kolik zpráv skončilo v nejistotě, klíčová metrika** |
| `sender_circuit_breaker_trips_total` | counter | `code` | jak často se kampaně pauzují |
| `sender_shutdown_forced_total` | counter | | kolikrát vypršel shutdown deadline |
| `sender_db_errors_total` | counter | `op` | chyby databáze podle operace |

Popisky nikdy neobsahují `campaign_id` ani `workspace_id`, protože by to vygenerovalo neomezenou kardinalitu.

### 4.4 Logování a health

Strukturovaný log přes `log/slog` ze standardní knihovny, výchozí formát JSON. Povinná pole u každého záznamu vztaženého ke zprávě: `message_id`, `campaign_id`, `workspace_id`, `sender_id`, `attempt`.

**Do logu nikdy nesmí:** e-mailová adresa příjemce, obsah `render_data`, obsah zprávy, dešifrovaná konfigurace provideru. Adresa se loguje jen jako `sha256(email)[:12]`, aby šlo dohledat konkrétní případ, aniž by log obsahoval osobní údaj.

| Endpoint | Kód 200, když | Použití |
|---|---|---|
| `/healthz` | proces běží | liveness probe, Docker `HEALTHCHECK` |
| `/readyz` | databáze odpovídá na `SELECT 1` do 2 s a konfigurace je platná | readiness probe |
| `/metrics` | vždy | Prometheus |

Žádný z endpointů nevyžaduje autentizaci a žádný nevrací data zákazníka. Port se v `docker-compose.yml` nepublikuje ven.

---

## 5. UI

Sender nemá vlastní obrazovky. Přesto se čtyři jeho stavy musí projevit v UI aplikace. Tohle je požadavek na 4a a 5, uvádím ho tady, protože bez něj by uživatel senderu nerozuměl.

| Situace | Kde | Text cs | Text en |
|---|---|---|---|
| Sender neběží, ale kampaň je `sending` | pruh nad průběhem kampaně | Odesílací služba neběží. Kampaň bude pokračovat, jakmile ji spustíte. | The sending service is not running. The campaign will continue once you start it. |
| Nejisté zprávy, okno ještě běží | karta v reportu kampaně | U {n} zpráv zjišťujeme, jestli odešly. Server se restartoval uprostřed odesílání. Většina se do pár minut vyjasní sama. | We are checking whether {n} messages were sent. The server restarted mid-send. Most of these resolve themselves within minutes. |
| Nejisté zprávy, konečné po 72 h | tamtéž | {n} zpráv jsme neodeslali, protože po restartu serveru nešlo zjistit, jestli už odešly. Neriskovali jsme, že by někomu přišly dvakrát. | We did not send {n} messages because after a server restart we could not tell whether they had already gone out. We chose not to risk sending them twice. |
| Nejisté zprávy, politika `retry` | tamtéž | U {n} zpráv jsme si nebyli jistí, jestli odešly, a poslali jsme je znovu. Malá část příjemců mohla dostat mail dvakrát. | For {n} messages we were not sure whether they were sent, so we sent them again. A small number of recipients may have received the email twice. |
| Tlačítko u nejistých | tamtéž | Zkusit odeslat znovu | Try sending again |
| Kampaň pozastavená senderem | stav kampaně | Kampaň jsme pozastavili: {důvod}. Po opravě ji můžete obnovit. | We paused the campaign: {reason}. You can resume it after fixing the issue. |
| Pauza během rozesílky | potvrzovací dialog | Odesílání se zastaví do několika sekund. Zprávy, které už jsou rozpracované (nejvýše {batch_size}), ještě odejdou. | Sending will stop within a few seconds. Messages already in progress (at most {batch_size}) will still go out. |

Prázdný stav, načítání a chyba u těchto prvků vlastní 4a, protože jsou součástí obrazovky kampaně.

---

## 6. Bezpečnost a soukromí

**Oddělení práv.** Kapitola 2.4. Sender nemá do `contacts` přístup na úrovni databáze, ne jen na úrovni kódu. Je to jediná komponenta systému s vlastní databázovou rolí a je to tak schválně.

**Dešifrování credentials.** Sender dešifruje `sending_providers.config_encrypted` podle kontraktu 4.10.4 části 1: obálka `enc:v1:`, AES-256-GCM, kontext `sending_provider`, `workspace_id` v AAD, klíč `HKDF(SHA-256, MASTER, "openengage/v1", "openengage/v1/credential-encryption", 32)`. Vektory jsem reprodukoval, viz 13.1.

Podle `key_id` v obálce se vybere `SECRET_KEY` nebo některý ze `SECRET_KEY_PREVIOUS`. Když `key_id` není znám, je to `crypto_unknown_key`; když neprojde tag, je to `crypto_auth_failed`. **Sender nikdy nezkouší klíče postupně** a chybu ven nikdy nerozlišuje podle příčiny, jak kontrakt požaduje. Selhání je fatální a kampaň se pozastaví.

`workspace_id` v AAD je návrh z tohohle dokumentu, který část 1 přijala. Znamená, že zašifrovanou konfiguraci nejde přenést mezi projekty: kdo by zkopíroval SES přístupy projektu A do řádku provideru projektu B, dostane `crypto_auth_failed`.

**Klíče v paměti.** Odvozený klíč i dešifrovaná konfigurace žijí jen v paměti procesu. Nezapisují se na disk, do logu ani do metrik. Struktury, které je nesou, mají přetížené `String()` a `MarshalJSON()`.

**Osobní údaje v logu.** Nikdy. Viz 4.4.

**Tokeny.** Sender vyrábí trackovací tokeny typu `o` (open) a `c` (click) podle kontraktu 4.10.3 části 1. Tokeny `i` (identity) a `u` (unsubscribe) vyrábí aplikace, protože sender nemá `list_id` ani mechanismus jednorázových nonce; viz rozpor K16. Token nikdy nezapisuje do databáze ani do logu, existuje jen jako součást odeslané zprávy.

Z formátu plyne jedna vlastnost, kterou je dobré znát: token nese `issued_at` z okamžiku odeslání, takže **dvě odeslání téže zprávy nesou různé tokeny**. U nejednoznačné zprávy opakované politikou `retry` to znamená, že se dvě otevření téhož mailu započítají jako dvě různá. Je to zanedbatelné, ale při ladění reportů to mate.

**Odchozí spojení.** Sender navazuje spojení výhradně na adresy z konfigurace provideru (SES endpoint odvozený z regionu, nebo `host:port` u SMTP). Nikdy nenavazuje spojení na adresu odvozenou z uživatelského obsahu. Nemá tedy SSRF plochu, na rozdíl od extrakce značky z webu v části 3.

**Odesílání bez odhlašovacího odkazu je zakázané.** Kapitola 3.7.2. Je to technická pojistka proti tomu, aby šlo z nástroje rozeslat něco, co nejde odhlásit.

**Sandbox procesu.** Binárka běží pod uživatelem bez rootu, s read-only kořenovým filesystémem. Nepotřebuje zapisovat nikam kromě `/tmp` a ani tam ne v běžném provozu. Detaily Dockerfile vlastní část 1.

---

## 7. Výkon

### 7.1 Kde jsou hranice

| Zdroj | Reálná hodnota | Poznámka |
|---|---|---|
| Kvóta SES | 14 zpráv/s v základu, po navýšení typicky 50 až 200/s | **Skutečný strop.** Všechno ostatní je nad ním. |
| Latence SES `SendEmail` | 60 až 250 ms | Určuje potřebnou souběžnost: 8 workerů × 5 volání/s = 40/s |
| Liquid interpolace | odhad 30 až 150 µs na zprávu | Šablona se parsuje jednou na kampaň, per zprávu se jen vykonává. **Ověřit benchmarkem**, viz kapitola 12. |
| Sestavení MIME | odhad 50 až 200 µs na zprávu | quoted-printable nad 100 kB HTML |
| Claim dávky 500 | jednotky ms | Částečný index nad `pending` |
| Marker + zápis výsledku | 2 round tripy na zprávu, 0,2 až 1 ms | Při 200 zprávách/s to je 400 dotazů/s, pro PostgreSQL nic |

**Závěr:** úzké hrdlo je kvóta providera, ne sender. To odpovídá odůvodnění volby Go v hlavní specifikaci 3.3.

### 7.2 Kde to praskne dřív

1. **Tabulka `messages` bez vacuum.** Každý řádek se aktualizuje nejméně třikrát. Bez agresivnějšího autovacuum (2.2) tabulka nabobtná a claim dotaz se zpomalí, protože částečný index bude plný mrtvých ukazatelů. Tohle praskne jako první.
2. **Plánování dotazu nad mnoha partition.** Claim dotaz nefiltruje podle `created_at`, takže PostgreSQL plánuje přes všechny partition. Při 12 partition to je zanedbatelné, při 120 (deset let) už ne. Retenční politika, která staré partition odpojuje, je proto výkonový požadavek, ne jen úklidový. Vlastní část 1.
3. **`render_data` u velkých kampaní.** Při 500 bajtech na zprávu a milionu příjemců je to 500 MB v jedné partition. Claim dotaz `render_data` tahá, takže síťový provoz mezi senderem a databází je při 200 zprávách/s zhruba 100 kB/s, což je v pořádku. Problém by nastal, kdyby se do `render_data` snapshotoval celý kontakt. Proto na tom trvám: **jen pole, která šablona opravdu používá** (hlavní specifikace, kapitola 5).
4. **Souběh mnoha instancí nad `SKIP LOCKED`.** Nad zhruba 10 souběžnými claimery začne `SKIP LOCKED` přeskakovat hodně řádků a dávky se zmenšují. Náš návrh má jeden claimer na proces, takže by to znamenalo 10 instancí senderu. Při kvótách, o kterých se bavíme, to nikdy nenastane.

### 7.3 Očekávané objemy

| Scénář | Počet zpráv | Odhadovaná doba při 50 zpráv/s |
|---|---|---|
| Testovací odeslání | 1 | do 2 s od kliknutí |
| Malá kampaň | 1 000 | 20 s |
| Demo z hackathonu | 5 000 | necelé 2 min |
| Střední kampaň | 50 000 | 17 min |
| Velká kampaň | 1 000 000 | 5,5 hodiny |

---

## 8. Akceptační kritéria

Každá věta musí jít převést na test.

### Claim a outbox

- **AK-4.1** Při 10 000 řádcích ve stavu `pending` a `SENDER_BATCH_SIZE=500` vrátí claim dotaz nejvýš 500 řádků a všechny mají `status='claimed'`, `claimed_by = SENDER_ID` a vyplněné `claim_expires_at`.
- **AK-4.2** Dvě instance senderu nad stejným outboxem si nikdy neclaimnou tentýž řádek. Test: 2 instance, 10 000 zpráv, po dokončení je součet odeslaných přesně 10 000 a žádný `provider_message_id` se neopakuje.
- **AK-4.3** Řádek ve stavu `claimed` s `claim_expires_at` v minulosti a `dispatch_started_at IS NULL` se po jednom běhu reaperu vrátí na `pending` bez značky `ambiguous_dispatch`.
- **AK-4.4** Řádek ve stavu `claimed` s vyplněným `dispatch_started_at` a `claim_expires_at` starším než dvojnásobek TTL dostane `error_code = 'ambiguous_dispatch'`. Při politice `retry` a `ambiguous_count = 0` skončí na `pending`, jinak na `failed`.
- **AK-4.5** Běžící dávka trvající déle než `SENDER_CLAIM_TTL_SECONDS` není reaperem sebrána, protože heartbeat obnovuje `claim_expires_at`.
- **AK-4.6 (regrese na K2)** Zpráva s běžícím heartbeatem a vyplněným `dispatch_started_at` **není reaperem nikdy uvolněna**, ani po deseti tikách reaperu. Tenhle test odhalí obrácené znaménko v podmínce a musí být v sadě `fixtures/outbox/scenarios.json` jako `OB-12`.
- **AK-4.7 (regrese na K1 a K23)** Oba kroky claim dotazu se proti reálnému PostgreSQL 18 **spustí bez syntaktické chyby**. Test nic netvrdí o výsledku, jen dotaz provede. Navrhuji ho zařadit jako `OB-00`, aby běžel první ze všech scénářů: obě dnešní syntaktické chyby v kontraktu by odhalil dřív, než na nich kdokoliv začne stavět.
- **AK-4.8** Kampaň přepnutá na `paused` uprostřed rozesílky přestane vracet řádky do 2 sekund; měkce smazaný workspace okamžitě.
- **AK-4.9** Testovací odeslání se claimne i u kampaně ve stavu `draft` a má přednost před běžnou dávkou.
- **AK-4.10** Sender pokoušející se o `DELETE FROM messages` nebo `INSERT INTO messages` dostane chybu oprávnění z PostgreSQL.

### Idempotence

- **AK-5.1** Sender zabitý signálem `SIGKILL` v náhodném okamžiku rozesílky na 1 000 příjemců a znovu spuštěný doručí každou zprávu **nejvýše jednou**. Měří se počtem volání mock provideru na jedinečné `messages.id`. Opakovat 20krát s náhodným časem zabití.
- **AK-5.2** V témž testu je součet zpráv ve stavech `sent` a `failed` roven 1 000. Žádná zpráva nezůstane trvale v `pending` ani `claimed`.
- **AK-5.3** V témž testu je počet zpráv s `error_code = 'ambiguous_dispatch'` nejvýše `SENDER_CONCURRENCY` na každé zabití.
- **AK-5.4** Mock provider, který zprávu přijme a pak simuluje ztrátu odpovědi (vrátí chybu spojení po úspěšném přijetí), nezpůsobí druhé odeslání při politice `fail`.
- **AK-5.5** Když se řádek mezi claimem a markerem (D1) změní na `pending` cizím zásahem, marker vrátí 0 řádků a mock provider **není zavolán vůbec**.
- **AK-5.6** Zpráva, která podruhé projde nejednoznačným stavem, skončí na `failed` **bez ohledu na politiku**. Ověřuje `ambiguous_count`, tedy opravu K8.
- **AK-5.7** Mezi dvěma nejednoznačnými průchody proběhne běžný opakovatelný neúspěch, který přepíše `error_code`. Zpráva přesto při druhém nejednoznačném průchodu skončí na `failed`. Bez `ambiguous_count` tenhle test spadne.
- **AK-5.8** Když aplikace zpracuje událost s tagem `oe_msg` ukazujícím na zprávu ve stavu `failed` s `error_code = 'ambiguous_dispatch'`, řádek přejde na `sent`. Naopak událost ukazující na `sent` řádek jeho stav **nikdy nemění**. (Test patří 4a, uvádím ho, protože ověřuje náš mechanismus.)
- **AK-5.9** Událost s tagem `oe_msg` ukazujícím na řádek ve stavu `claimed` jeho stav **nemění**, aby nevznikl závod s živým senderem.
- **AK-5.10** Událost, která dorazí později než 72 hodin od `updated_at`, řádek `failed` s `ambiguous_dispatch` už neopraví.
- **AK-5.11** Zpráva, která selhala z jiného důvodu než `ambiguous_dispatch`, se událostí s tagem `oe_msg` **neopraví nikdy**.

### Render a MIME

- **AK-6.1** Sada 40 golden fixtures Liquid subsetu z `packages/contracts` dá v Go bajtově stejný výstup jako v LiquidJS.
- **AK-6.2** Předmět `Letní výprodej začíná` se zakóduje jako `=?utf-8?B?...?=` a po dekódování dá původní řetězec včetně diakritiky.
- **AK-6.3** Předmět dlouhý 300 znaků s diakritikou se rozdělí na víc encoded-words, žádný nepřesáhne 75 znaků a žádný nerozdělí vícebajtový znak uprostřed.
- **AK-6.4** Sestavená zpráva má `Content-Type: multipart/alternative`, právě dvě části (`text/plain` a `text/html`), obě s `Content-Transfer-Encoding: quoted-printable` a `charset=UTF-8`.
- **AK-6.5** Žádný řádek sestavené zprávy nepřesáhne 998 oktetů.
- **AK-6.6** Zpráva obsahuje `List-Unsubscribe` s HTTPS URI na první pozici a `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Když HTTPS URI chybí, `List-Unsubscribe-Post` ve zprávě není.
- **AK-6.7** HTML obsahující `<!--[if mso]><table>...<![endif]-->` projde senderem **bajtově beze změny** kromě nahrazených značek. Ověřuje se bajtovým diffem mimo nahrazené úseky nad fixturou `CT-014`.
- **AK-6.19** Tlačítko s VML dvojčetem (fixtura `CT-007`) má po náhradě **týž trackovací odkaz** v `<v:roundrect href>` i v `<a href>`.
- **AK-6.20** Po náhradě neobsahuje ani `html`, ani `text` řetězec `openengage.invalid`. Když ano, zpráva skončí jako `failed` s kódem `marker_not_replaced` a **neodešle se**.
- **AK-6.21** Kampaň, jejíž počet nalezených značek neodpovídá `clickMarkerCount`, se pozastaví s důvodem `contract_mismatch` **dřív, než odejde první zpráva**.
- **AK-6.22** Kontakt, jehož vlastní pole obsahuje řetězec `https://track.openengage.invalid/c/<platné UUID>`, dostane ten řetězec v těle **doslova**, nikoli jako funkční trackovací odkaz. Ověřuje pořadí operací z kontraktu 5.
- **AK-6.23** Řádek prostého textu se značkou odkazu není po náhradě zalomený, i když výsledná URL přesáhne 78 znaků.
- **AK-6.8** Zpráva s `contact_id IS NULL` a `is_test=false` skončí jako `failed` s kódem `unsubscribe_url_missing` a **neodešle se**, protože bez `contact_id` nejde sestavit odhlašovací token.
- **AK-6.18** Odkaz v hlavičce `List-Unsubscribe` a odkaz dosazený za `{{ unsubscribe_url }}` v těle jsou **identický řetězec**.
- **AK-6.9** Při `track_opens=false` neobsahuje výsledné HTML žádný `<img>` na `/t/o/`.
- **AK-6.15 (regrese na K4)** Fixture `{% if contact.first_name == blank %}` s `first_name = ""` dá v Go i v LiquidJS **stejnou** větev. Tento test při dnešním znění kontraktu spadne a je to jeho účel.
- **AK-6.16 (regrese na K11)** Zkompilovaná šablona obsahující `| safe` je senderem odmítnuta ještě před renderem, s kódem `render_failed`.
- **AK-6.17** Automatické escapování v HTML kontextu produkuje `&quot;` pro `"`, ne `&#34;`. Ověřuje, že se nepoužil vestavěný `render.HtmlEscaper`.
- **AK-6.10** Liquid chyba u jedné zprávy neshodí kampaň: 1 000 zpráv, z toho 1 s vadnými daty, dá 999 `sent` a 1 `failed` s kódem `render_failed`.
- **AK-6.11** Když z prvních 1 000 zpráv kampaně selže na renderu víc než 5 %, kampaň přejde na `paused` s důvodem v `pause_reason`. Při 4 % zůstane `sending`.

### Dispatch

- **AK-9.1** Volání SES obsahuje `ConfigurationSetName` a tři message tagy `oe_msg`, `oe_camp`, `oe_ws`, jejichž hodnoty jsou kanonické UUID.
- **AK-9.2** `out.MessageId` z odpovědi SES se zapíše do `messages.provider_message_id`.
- **AK-9.3** Sender s prázdným `configuration_set_name` kampaň neodešle a pozastaví ji s kódem `ses_configuration_set_missing`.
- **AK-9.4** SMTP server, který na `EHLO` neinzeruje `STARTTLS` a konfigurace má `encryption: starttls`, vede na fatální chybu a **žádné heslo se po drátě neposílá**.
- **AK-9.5** SMTP pool se 4 spojeními odešle 1 000 zpráv na nejvýše `ceil(1000/100) + 4` navázaných spojení.
- **AK-9.6** SMTP odpověď `250 2.0.0 Ok: queued as ABC123` naplní `provider_message_id` hodnotou `smtp:ABC123`.

### Throttling a retry

- **AK-7.1** Při `max_send_rate = 10` a `SENDER_REPLICAS = 1` neodešle sender za 10 sekund víc než 100 zpráv (s tolerancí burstu 10).
- **AK-7.2** Při `SENDER_REPLICAS = 2` neodešle jedna instance za 10 sekund víc než 50 zpráv (s tolerancí).
- **AK-7.3** Po `TooManyRequestsException` klesne `sender_rate_limit_current` na polovinu a do 3 minut se vrátí zpět k cílové hodnotě.
- **AK-7.4** Zpráva odmítnutá throttlingem nezvýší `attempts`.
- **AK-8.1** Zpráva selhávající opakovatelnou chybou skončí po `SENDER_MAX_ATTEMPTS` pokusech jako `failed` s kódem `max_attempts_exceeded` a prodlevy mezi pokusy rostou geometricky.
- **AK-8.2** Trvalá chyba (`smtp_recipient_rejected`) ukončí zprávu na první pokus, `attempts = 1`.
- **AK-8.3** Tři po sobě jdoucí fatální chyby pozastaví kampaň a všechny claimnuté zprávy se vrátí na `pending`.

### Shutdown a provoz

- **AK-6.12** Po `SIGTERM` během rozesílky se všechny claimnuté zprávy bez markeru vrátí na `pending` do `SHUTDOWN_GRACE_SECONDS` a proces skončí kódem 0.
- **AK-6.13** Po `SIGTERM` se neclaimne žádná nová zpráva.
- **AK-6.14** Restart senderu s nezměněným `SENDER_ID` uvolní vlastní zaseknuté řádky bez markeru **okamžitě**, bez čekání na `SENDER_CLAIM_TTL_SECONDS`. Při výchozím `SENDER_ID` (hostname a PID) tenhle test neprojde, což je doklad k rozporu K14.
- **AK-19.1** Testovací odeslání se odešle i u kampaně ve stavu `draft`, do 2 sekund, a projde stejnou cestou renderu a MIME jako ostrá zpráva.
- **AK-19.2** Testovací zpráva při `SENDER_TEST_TRACKING=false` neobsahuje open pixel ani přepsané odkazy a nese hlavičku `X-OpenEngage-Test: 1`.
- **AK-20.1** Připojení rolí `openengage_sender` a pokus o `SELECT * FROM contacts` skončí chybou `permission denied for table contacts`.
- **AK-20.2** Táž role provede claim dotaz nad partitionovanou tabulkou `messages` úspěšně, bez explicitních grantů na jednotlivé partition.
- **AK-20.3** Táž role nemůže provést `UPDATE messages SET email = ...` ani `DELETE FROM messages`.
- **AK-20.5 (regrese na RLS)** **Všechny testovací scénáře `OB-01` až `OB-11` běží pod rolí `openengage_sender`**, ne pod migrátorem ani aplikační rolí. Test, který se připojí jinou rolí, je považovaný za neplatný. Bez tohohle pravidla by se chybějící politika `sender_bypass` v testech nikdy neprojevila, protože obě ostatní role RLS obcházejí.
- **AK-20.6** Claim dotaz pod rolí `openengage_sender` nad tabulkou s RLS vrátí neprázdnou dávku. Test musí selhat, když se politika `sender_bypass` odebere.
- **AK-20.7** Sender smí provést `UPDATE campaigns SET status='paused', pause_reason=...` jen ze stavu `sending`. Pokus o jakýkoliv jiný cílový stav nebo o zápis do jiného sloupce skončí chybou oprávnění.
- **AK-20.4** Sender s neplatným `SECRET_KEY` nenastartuje a v logu je uvedeno, která proměnná je špatně.

---

## 9. Závislosti

Vše ověřeno k **2026-07-31** přes GitHub API (`gh api repos/<owner>/<repo>`), tedy z primárního zdroje, ne z paměti. Povolené licence jsou MIT, Apache-2.0, BSD a ISC. LGPL a GPL jsou zakázané (hlavní specifikace, kapitola 9).

### 9.1 Přímé závislosti senderu

| Modul | Verze | Licence | Poslední commit | Hvězdy | Verdikt | K čemu |
|---|---|---|---|---|---|---|
| `github.com/aws/aws-sdk-go-v2` + `.../service/sesv2` | aktuální | **Apache-2.0** | 2026-07-31 | 3 621 | OK | Dispatch přes SES v2 |
| `github.com/wneessen/go-mail` | v0.8.1 | **MIT** | 2026-07-22 | 1 460 | OK | Sestavení MIME a SMTP klient |
| `github.com/osteele/liquid` | v1.8.1 | **MIT** | 2026-02-27 | 355 | OK s výhradou, viz 9.3 | Fáze 2 renderu |
| `github.com/jackc/pgx/v5` (+ `pgxpool`) | v5.10.0 | **MIT** | 2026-07-26 | 14 080 | OK | Přístup k PostgreSQL, pool spojení |
| `github.com/google/uuid` | v1.6.0 | **BSD-3-Clause** | 2024-11-14 | 6 122 | OK | Práce s UUID zpráv |
| `golang.org/x/time/rate` | modul `golang.org/x/time` | **BSD-3-Clause** | 2026-03-08 | 420 | OK | Token bucket throttling, `SetLimit` za běhu |
| `github.com/prometheus/client_golang` | v1.24.1 | **Apache-2.0** | 2026-07-24 | 6 012 | OK | Metriky |
| `github.com/caarlos0/env/v11` | v11.4.1 | **MIT** | 2026-07-07 | 6 272 | OK | Načtení a validace konfigurace z env |

Ze standardní knihovny, tedy bez závislosti: **`crypto/hkdf`** (odvození klíčů, je ve stdlib od Go 1.24 a stavíme na 1.26, takže `golang.org/x/crypto/hkdf` se **nepoužívá**), `crypto/cipher` a `crypto/aes` (AES-256-GCM), `crypto/hmac` a `crypto/sha256` (trackovací tokeny), `log/slog` (strukturované logování), `mime/quotedprintable`, `net/mail`, `encoding/base64`, `net/http` (health a metriky), `context`, `os/signal`.

Vědomě se nepoužívá `github.com/cenkalti/backoff` (v7.0.0, MIT, ověřeno). Náš backoff je pět řádků aritmetiky a musí se počítat proti hodnotě `attempts` uložené v databázi, ne proti stavu v paměti. Knihovna by tady nedávala nic.

### 9.2 Poznámky k `wneessen/go-mail`

Vybrán proto, že jako jedna z mála Go knihoven pro poštu umí **obojí**: sestavit MIME zprávu do bufferu bez odeslání (což potřebujeme pro `SendEmail` s raw obsahem u SES) i být plnohodnotným SMTP klientem s TLS a autentizací. Díky tomu je MIME builder v celém senderu **jeden jediný** a zpráva do SES i do SMTP je bajtově stejná.

Ověřit před implementací:

- že sestavená zpráva jde získat jako `[]byte` bez odeslání (metoda typu `WriteTo(io.Writer)`),
- že jde nastavit **libovolná** vlastní hlavička, konkrétně `List-Unsubscribe-Post`, `Feedback-ID` a `Precedence`, které nejsou v žádném standardním výčtu,
- že jde vynutit `quoted-printable` na obou částech a `charset=UTF-8`,
- že jde injektovat generátor boundary kvůli deterministickým golden fixtures.

Kdyby kterákoliv z těchto čtyř věcí nešla, sestavíme MIME vlastním kódem nad `mime/quotedprintable` a `net/textproto` ze standardní knihovny a `go-mail` použijeme jen jako SMTP klienta. Zpráva má pevnou a jednoduchou strukturu (dvě části, žádné přílohy), takže je to zvládnutelná varianta, ne katastrofa. Viz otevřená otázka O12.

### 9.3 Poznámka k `osteele/liquid`

Je to nejmenší projekt v seznamu (355 hvězd) a jediný, který nemá za sebou velkou organizaci. Zároveň je aktivně udržovaný (poslední commit únor 2026, není archivovaný) a licence MIT nám dovoluje ho v krajním případě forknout.

Mitigace, kterou zavádíme hned:

1. Liquid je za rozhraním `Renderer` (kapitola 3.1), takže výměna implementace se dotkne jednoho souboru.
2. Používáme z něj **jen pět filtrů a čtyři tagy** z dokumentovaného subsetu. Čím menší plocha, tím snazší náhrada.
3. Golden fixtures z `packages/contracts` jsou nezávislé na knihovně a při výměně fungují dál jako přejímací test.

Alternativy pro případ, že by projekt usnul, jsou v otevřené otázce O13.

### 9.4 Licenční brána

`go-licenses check ./...` s whitelistem `MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC` běží v CI jako blokující job. Kontroluje **celý strom závislostí**, ne jen přímé závislosti. `github.com/aws/aws-sdk-go-v2` tahá desítky podmodulů a všechny jsou Apache-2.0, ale kontrolovat se to musí automaticky, ne důvěrou.

## 10. Požadavky na ostatní části

### 10.1 Na část 1 (platforma a kontrakty)

| # | Co potřebuji | V jakém tvaru | Proč |
|---|---|---|---|
| ~~P1.1~~ | **VYŘEŠENO.** Kontrakt 4 je úplný. Layout obálky, HKDF parametry, AAD s `workspace_id` i vektory jsem reprodukoval nezávislou implementací, viz 13.1. | | |
| P1.2 | Chování při rotaci `SECRET_KEY` | Buď dvojice starý a nový klíč po přechodnou dobu, nebo re-encrypt při startu aplikace. | Sender musí vědět, jestli má při selhání dešifrování zkusit druhý klíč, nebo hlásit `credentials_undecryptable`. |
| P1.3 | **Kontrakt 1, konvence schématu** | Potvrzení, že `messages` je `PARTITION BY RANGE (created_at)` po měsících, kdo zakládá partition a jaká je retence. | Claim dotaz a fillfactor se nastavují na partition, ne na rodiče. |
| P1.4 | Řešení vyhledání zprávy podle samotného `id` | Buď `id` jako UUIDv7 s odvoditelnou partition, nebo doporučení, že aplikace při párování událostí přidá do `WHERE` i rozsah `created_at`. | S PK `(created_at, id)` prochází vyhledání podle `id` všechny partition. Týká se to hlavně 4a, ale konvence je tvoje. |
| P1.5 | Založení role `openengage_sender` | Kde přesně: entrypoint image, samostatný skript, nebo migrace. Migrace nemá právo na `CREATE ROLE` a heslo do ní nepatří. | Bez odpovědi je nasazení senderu s omezenými právy nedokumentované. |
| P1.6 | **Vyřešit K7:** sender staví trackovací odkazy z `TRACKING_DOMAIN`, jejíž výchozí hodnota se odvozuje z `APP_URL`, kterou ale podle 4.9 nedostává | Buď `APP_URL` přidat senderu, nebo udělat `TRACKING_DOMAIN` povinnou pro `MODE=sender`. Plus určit, jestli hodnota obsahuje schéma a koncové lomítko. |
| P1.7 | **Kontrakt 2, Liquid subset: zákaz nebo uzavření filtru `date`** | Buď filtr `date` ze subsetu vyřadit, nebo povolit jen uzavřený výčet formátovacích řetězců, které jsou v obou implementacích ověřeně shodné. | Viz kapitola 3.6.1 a 12. Je to nejpravděpodobnější místo rozchodu dialektů. |
| P1.8 | Golden fixtures pro Liquid v `packages/contracts` | Adresář s trojicemi `template.liquid`, `data.json`, `expected.txt`. CI je pouští v Go i v Node a porovnává bajt po bajtu. | Bez toho je záruka z hlavní specifikace 4.5 jen slib. |
| P1.12 | **Rozhodnout, jak vzniká auditní záznam o pozastavení kampaně senderem.** Doporučuji: sender zapíše `circuit_breaker_open` do `message_events` a `pause_reason` do `campaigns`, auditní řádek z toho vyrobí job části 4a. Alternativa je `GRANT INSERT ON audit_log` senderu, což ale rozšiřuje bezpečnostní hranici o třetí zapisovatelnou tabulku. | Omezení 3 u schváleného K21 vyžaduje auditní záznam, ale kontraktní role má u `audit_log` výslovně "žádná práva". |
| P1.13 | Po rozhodnutí o čistém `SECRET_KEY` bez prefixu **opravit dokument části 1 na dvou místech** (sekce 3.10 a tabulka 4.9), které dnes uvádějí `[<key_id>:]<base64url>`, a určit, jaké `key_id` se razítkuje na nové obálky. | Jinak budou Go a TypeScript parsovat tutéž proměnnou různě a spadne `config-parity`. |
| P1.10 | **Vyřešit K21:** `GRANT UPDATE (status, pause_reason) ON campaigns` pro roli senderu a nový sloupec `campaigns.pause_reason jsonb` | Bez toho nemůže sender pozastavit kampaň, což vyžaduje jak circuit breaker (3.13), tak kontraktní pravidlo o 5 % selhání renderu z 4.10.2. |
| P1.11 | Doplnit `SENDER_REPLICAS`, `SENDER_RATE_SAFETY`, `SENDER_MAX_ATTEMPTS` a další z tabulky v 4.1 do seznamu konfiguračních proměnných | Všechny mají výchozí hodnotu, takže nic neblokují, ale patří do jednoho seznamu s ostatními, aby fungoval test `config-parity`. |
| P1.9 | Opravy K1 (pořadí `LIMIT` a `FOR UPDATE`), K2 (znaménko v reaperu) a K8 (čítač nejednoznačných) v kontraktu 4.10.1 | Bez K1 se dotaz nespustí, bez K2 se kampaň rozsype během první minuty. Podrobně v 11.1. |

### 10.2 Na část 4a (kampaně a outbox)

| # | Co potřebuji | Proč |
|---|---|---|
| P4a.1 | Převzít DDL `messages` z kapitoly 2.1 **včetně** nových sloupců `dispatch_started_at`, `is_test` a `updated_at` | Bez `dispatch_started_at` neexistuje ochrana proti dvojímu odeslání. |
| P4a.2 | **Vyřešeno.** Sloupec `campaigns.revision` je doplněný a vrací ho claim dotaz. Sender ho používá jako klíč cache. | |
| P4a.3 | Nový sloupec `campaigns.pause_reason jsonb` | Sender do něj zapisuje důvod, proč kampaň pozastavil (3.13). |
| P4a.4 | **Struktura `render_data`** podle 3.6 (vnořený `contact`, dvě úrovně, `null` se nevynechává) a hotové `contact.greeting` | Sender nečte kontakty. Co v `render_data` není, neexistuje. Odkazy si staví sender sám, ty tam nedávej. |
| P4a.20 | Sloupec `campaigns.unsubscribe_list_id uuid` a jeho načtení claim dotazem | Bez něj sender nesestaví token typu `u`. Potvrzeno v naší výměně. |
| P4a.21 | Merge tagy použité v `subject` a `preheader` musí být v `compiled_fields`, aby se jejich hodnoty dostaly do `render_data` | Jinak se předmět vyrenderuje s prázdnými místy. |
| P4a.24 | Z `message_events` s kódem `circuit_breaker_open` a z `campaigns.pause_reason` vyrobit auditní záznam, aby uživatel v UI viděl, že kampaň zastavil nástroj a proč | Sender do `audit_log` zapisovat nemá a nemá tam ani grant. Viz P1.12. |
| P4a.22 | Doplnit do SMTP konfigurace `insecure_skip_verify` a `allow_insecure_auth` (obojí `false` jako výchozí), nebo potvrdit, že je sender natvrdo zakáže | Bez nich se sender nepřipojí k serveru se samopodepsaným certifikátem, což je u interních relayů běžné. |
| ~~P4a.25~~ | **BEZPŘEDMĚTNÉ.** Token nese `message_created_at`, takže část 5 partition nedohledává vyříznutím času z UUIDv7, ale přímým zásahem do primárního klíče. Vyhledávací okno zmizelo a s ním i riziko jeho vyčerpání u dlouhé materializace. |
| P4a.26 | Testovací odeslání materializovat s **vypnutým sledováním** (`trackOpens = false`, `trackClicks = false` při kompilaci), když je `SENDER_TEST_TRACKING = false` | Sender u testu značky nenahrazuje původními URL, protože ty nezná. Správné místo je kompilace, ne sender. |

#### Odpovědi na dvě otázky části 4a

**1. Souhlasím s `retry`, ale tvoje první podmínka je na SES nesplnitelná.** Podmiňuješ ji tím, že `Message-ID` opakovaného pokusu bude identické s prvním. Sender ho skutečně odvozuje deterministicky z `message_id` bez čísla pokusu, takže z jeho strany identické je. Jenže **Amazon SES ho přepisuje vlastní hodnotou**, doslovné znění dokumentace AWS je v rozporu K3. Na SES tedy příjemce naše `Message-ID` nikdy neuvidí, dvě odeslání dostanou dvě různé hodnoty a pojistka, na kterou svoji podmínku vážeš, nefunguje.

Návrh: `retry` u SMTP (tam pojistka funguje), `fail` u SES. Kdyby se trvalo na jedné hodnotě pro obojí, pak `fail`, protože nesplněná podmínka u hlavního provideru váží víc.

Tvoje druhá podmínka, viditelnost počtu nejednoznačných případů, je splněná: metrika `sender_ambiguous_dispatch_total{outcome}` a v databázi `error_code = 'ambiguous_dispatch'` s čítačem `ambiguous_count`.

**2. Nejdelší doba mezi claimem a zápisem výsledku.** Konkrétní čísla, ne princip:

| Veličina | Hodnota |
|---|---|
| Jedna zpráva, claim až zápis výsledku, p99 | **do 15 s** (timeout volání provideru 10 s plus zápisy do DB) |
| Poslední zpráva dávky, claim až zápis výsledku | `SENDER_BATCH_SIZE / efektivní rychlost`, protože poslední zpráva čeká ve frontě throttleru |
| Při kvótě 50/s a dávce 500 | 10 s |
| Při kvótě 14/s (výchozí produkční SES) a dávce 500 | 36 s |
| **Při kvótě 1/s (SES sandbox) a dávce 500** | **500 s, tedy přes 8 minut** |

Poslední řádek je ten, který ti rozbije prahy. Tvůj práh 5 minut by v sandboxu hlásil planý poplach na každé dávce. Doporučuji práh `max(15 min, SENDER_BATCH_SIZE / quota_max_send_rate × 2)`.

Sender se v tom případě nezasekává, dávku normálně dojede a heartbeat mu ji drží. Kdyby ti to vadilo, druhá cesta je zmenšit `SENDER_BATCH_SIZE` při nízké kvótě, ale hlásit to jako anomálii je levnější.
| P4a.5 | Garance, že po přechodu kampaně do `sending` se `compiled_*`, `subject`, `preheader`, `from_*`, `reply_to` a `provider_id` **nemění** jinak než přes `revision` | Jinak by různí příjemci dostali různé verze a nešlo by to dohledat. |
| P4a.6 | Potvrzení, že `subject` a `preheader` jsou také Liquid šablony | Sender je interpoluje. Hlavní specifikace to neříká. |
| P4a.7 | **Zpětné smíření podle message tagu `oe_msg`** přesně podle 3.4.5: událost opraví `failed` s `ambiguous_dispatch` na `sent`, jen u tohoto kódu, jen do 72 hodin, nikdy u řádku ve stavu `claimed`. Plus dvojí text v reportu podle toho, jestli okno ještě běží. | **Není to volitelné.** Bez toho nemá výchozí politika `fail` u SES protiváhu a po každém tvrdém pádu se natrvalo nedoručí až `SENDER_CONCURRENCY` zpráv, přestože většina odešla. Výchozí politika je rozhodnutá: `fail` u SES, `retry` u SMTP. |
| P4a.8 | Párování událostí přes message tag `oe_msg`, nejen přes `provider_message_id` | `provider_message_id` u nejistých zpráv chybí. Tag je jediná cesta, jak je vyřešit. |
| P4a.9 | Uzavření kampaně (`sending → sent`) periodickým jobem, který kontroluje, že nezbyl žádný řádek ve stavu `pending` ani `claimed` | Sender vidí jednotlivé zprávy, ne kampaň jako celek. Neúplná dávka ze `SKIP LOCKED` není známkou konce (3.2). |
| P4a.10 | Re-check suppression a odhlášení průběžným jobem, který překlápí `pending → skipped` | Sender nemá práva na `suppressions` ani `contacts`, takže tuhle kontrolu při odeslání **dělat nemůže**. Je to odpověď na otázku 3 ze zadání a musí být v tvojí části, jinak tam vznikne mezera. |
| P4a.11 | Materializace nastaví všem řádkům jedné kampaně **stejné `created_at`** z `campaigns.materialized_at` a doplní `UNIQUE (created_at, campaign_id, contact_id)` | Jinak `UNIQUE` neplatí přes hranici měsíce a dvojitá materializace projde. |
| P4a.12 | JSON schéma dešifrované konfigurace provideru pro `type='ses'` a `type='smtp'` | Návrh mám v 13.4. Potřebuji potvrzení nebo úpravu. |
| P4a.13 | Konfigurace provideru musí obsahovat `max_send_rate` a `configuration_set_name`, obojí povinně | Bez rychlosti sender nemůže throttlovat, bez Configuration Setu nechodí události. |
| P4a.14 | Přijetí katalogu chybových kódů z kapitoly 4.2 a jeho použití v UI | Sender zapisuje jen `code`, překlad je na aplikaci. |
| P4a.15 | Pauza kampaně = `UPDATE campaigns SET status='paused'`. Sender do 5 s přestane brát nové dávky, rozpracovanou dávku dokončí. Musí to být v potvrzovacím dialogu napsané. | Odpovídá to textu v kapitole 5. |
| P4a.16 | Detekce asynchronních bounců u SMTP (bounce mailbox nebo webhook providera) | Sender vidí jen synchronní odmítnutí v SMTP relaci. Zbytek je tvůj. |
| P4a.17 | `messages.is_test = true` u testovacích odeslání a jejich vyloučení ze statistik | Sender je pouze odesílá se stejným kódem. Rozlišení v reportu je tvoje. |
| P4a.18 | **Empiricky ověřit, že SES podepisuje DKIM i hlavičky `List-Unsubscribe` a `List-Unsubscribe-Post`** (jsou v `h=` tagu) | RFC 8058 to vyžaduje. Když nejsou, Gmail tlačítko na odhlášení nenabídne a požadavky Google a Yahoo pro hromadné odesílatele nesplníme. Viz 3.8.4. Je to test na jednu odeslanou zprávu. |
| P4a.19 | Data v `render_data` posílat **výhradně jako ISO 8601 řetězce**, nikdy jako číselný timestamp | `osteele/liquid` číselné timestampy nepřijímá, LiquidJS ano. Viz rozdíl L4 v 3.6.1. |

### 10.5 Na část 2 (kontakty a souhlasy)

| # | Co potřebuji | Proč |
|---|---|---|
| P2.1 | Endpoint na `/u/<token>` přijímá token typu `u` podle kontraktu 4.10.3 a odvozuje z něj příjemce i seznam bez dalších parametrů | RFC 8058 to vyžaduje doslova, POST z poštovního klienta nenese žádné další argumenty. Token vyrábí sender. |
| P2.2 | Endpoint na tomhle URI přijímá `POST` s tělem `List-Unsubscribe=One-Click` v typu `multipart/form-data` **i** `application/x-www-form-urlencoded` | RFC 8058, kapitola 3.2. První je doporučený, druhý připuštěný, poštovní klienti používají oba. |
| P2.3 | Endpoint **neodpovídá přesměrováním**, nevyžaduje cookies ani přihlášení a nezobrazuje potvrzovací stránku | RFC 8058 to zakazuje výslovně. Přesměrovaný POST se v prohlížečích mění na GET. |
| P2.4 | Tentýž URI na `GET` zobrazí běžnou stránku s preferencemi | RFC 8058 s tím počítá a šetří to jeden endpoint. |

### 10.3 Na část 3 (obsah a šablony)

| # | Co potřebuji | Proč |
|---|---|---|
| ~~P3.1~~ | **VYŘEŠENO.** Pátý kontrakt je hotový (`03-obsah.md`, 4.1), ověřil jsem ho z pozice Go a přijímám beze změny. Kritéria S1 až S10 splňuje. | |
| ~~P3.2~~ | **VYŘEŠENO**, kontrakt 4.1.4 to tak má. |
| ~~P3.3~~ | **VYŘEŠENO**, kontrakt 4.1.6 bod 4: značka stojí v textu na samostatném nezalomeném řádku. |
| ~~P3.4~~ | **VYŘEŠENO** třemi vrstvami v 4.1.5 plus mojí čtvrtou v 3.7.1. |
| P3.5 | Validátor odmítne Liquid tag **uvnitř hodnoty `href`** | Dynamická URL se nedá zaznamenat do `campaign_links` a nešla by trackovat. Je to zároveň druhá polovina požadavku S5: interpolace nesmí být schopná značku vyrobit. |
| P3.6 | Potvrzení, že běhová Liquid chyba znamená **přeskočení jednoho příjemce**, ne zastavení kampaně | Je to vaše otázka 7. Moje odpověď je v 3.6 a potřebuji, aby se neshodovaly dvě různé verze. |
| P3.7 | Potvrzení, že neexistující proměnná se renderuje jako prázdný řetězec, bez strict mode | Musí to sedět s LiquidJS v náhledu. |
| ~~P3.8~~ | **VYŘEŠENO**, kontrakt 4.1.6 bod 5: preheader je zapečený v `html`, sender ho interpoluje jen pro `render_data` a diagnostiku. |
| ~~P3.9~~ | **VYŘEŠENO.** Cena parsování je v 4.1.3 včetně odhadu a včetně toho, že je to odhad, ne měření. Doplněny obě náhradní cesty. |
| ~~P3.10~~ | **VYŘEŠENO a šíře, než jsem se ptal.** Kompilace HTML-escapuje **každou** URL, kterou emituje přímo do `href`, tedy i `mailto:`, `tel:` a všechny netrackované odkazy. V prostém textu se neescapuje nic a `&` zůstává `&`. Fixtura `CT-015`. |
| ~~P3.11~~ | **VYŘEŠENO.** Porovnání `>` je v kontraktu explicitně včetně tabulky tří vztahů. Část 3 převzala i rozlišení tří kontrol na třech místech. |

### 10.4 Na část 5 (tracking)

Formát tokenů **nevlastní část 5, vlastní ho část 1** (kontrakt 4.10.3). Část 5 doplňuje sémantiku a ověřování. Moje původní požadavky P5.1 až P5.9 jsou tím vyřízené: sedm z nich zodpověděl kontrakt, dva se staly bezpředmětnými.

| # | Původní požadavek | Stav |
|---|---|---|
| ~~P5.1~~ | kanonický bajtový tvar payloadu | **VYŘEŠENO.** Pevný binární layout, žádný JSON, celý blok `type ‖ key_id ‖ payload ‖ mac` v jednom base64url bez teček. |
| ~~P5.2~~ | pole open a click tokenu | **VYŘEŠENO.** `type` je ASCII znak, ne číslo, což jsem předpokládal špatně. |
| ~~P5.3~~ | odvození HMAC klíče | **VYŘEŠENO**, klíč reprodukován (13.1). |
| ~~P5.4~~ | délka zkráceného MAC | **VYŘEŠENO**, 16 bajtů. |
| ~~P5.5~~ | verzní prefix | **VYŘEŠENO**, `t1`, kontrola před vším ostatním. |
| ~~P5.6~~ | tokeny bez expirace | **VYŘEŠENO**, open, click i unsubscribe neexpirují. |
| ~~P5.7~~ | golden fixtures | **VYŘEŠENO**, pět pozitivních a devět negativních vektorů. Po změně pole `issued_at` na `message_created_at` jsem **všech pět pozitivních vektorů přepočítal znovu a sedí bajt na bajt** včetně délek 74/96/106/117 a všech čtyř plných HMAC. |
| ~~P5.8~~ | `link_id` jako pozice, nebo UUID | **VYŘEŠENO**, UUID, a nese ho přímo značka z kontraktu 5. `campaign_links` nečtu vůbec. |
| ~~P5.9~~ | netrackované odkazy | **VYŘEŠENO** kontraktem 5, tabulka 4.1.4. |

Zbývající požadavky:

| # | Co potřebuji | Proč |
|---|---|---|
| P5.10 | **Schéma tabulky `message_events`**: sloupce, povinnost `created_at` kvůli partitioningu, povolené hodnoty `type` | Kontrakt 4.10.1 mi dává `INSERT` a kontrakt 4.10.2 po mně chce zapisovat `render_warning`. Bez schématu to nenapíšu. |
| P5.11 | Rozhodnutí, jestli se `render_warning` agreguje | Kampaň na 50 000 příjemců s jedním nevyplněným polem u poloviny z nich vyrobí 25 000 identických řádků. Doporučuji agregaci na dvojici (kampaň, cesta) s počítadlem. |
| P5.13 | **Podporuji tvůj požadavek na `payload_hex` u každého vektoru** a na doplnění hraničních případů (implicitní versus explicitní `key_id = 1`, `issued_at = 4294967295`, UUID samých `ff`, `key_id = 0`, nadbytečné bajty na konci) | Pořadí bajtů UUID je dnes popsané jen slovně. `payload_hex` je jediná věc, která zabrání tomu, aby se dvě implementace rozešly na endianitě, aniž by to kterýkoliv vektor odhalil. |
| P5.14 | Potvrzení, do kterých typů `message_events` sender **smí** zapisovat | Tvůj zákaz `open` a `click` beru a mám ho v 2.3. Potřebuji ale uzavřený výčet toho, co psát smím, ne jen výčet zákazů. Dnes zapisuji `render_warning` a `circuit_breaker_open`. |

**Poznámka k `issued_at` a k vyhledávání podle `message_id`.** Píšeš, že si partition dohledáváš vyříznutím času z UUIDv7 a hledáním v okně ±1 hodina. Chápu proč: primární klíč `messages` je `(id, created_at)` a token nese jen `message_id`.

Stojí za zaznamenání, že kdyby payload nesl místo `issued_at` hodnotu `messages.created_at`, měla bys partition určenou přesně a okno bys nepotřebovala. **Nenavrhuji to měnit**, protože vektory kontraktu 3 jsou už spočítané a ověřené a přepočítávat je kvůli tomuhle se nevyplatí. Levnější cesta ke stejné jistotě je požadavek P4a.25 níže: zaručit, že se čas v UUIDv7 neliší od `created_at` o víc, než kolik je tvoje okno.

Mimochodem, část 3 ve své zprávě uvádí payload click tokenu jako `... link_id(16) message_created_at(u32)`. Normativní znění v části 1, sekci 4.10.3, je `issued_at(u32)`. Na část 3 to nemá dopad, protože tokeny nevyrábí, ale ať se to nezakoření.

## 11. Rozpory

### 11.0 Revize zmrazeného kontraktu, druhý průchod

Prošel jsem kontrakt znovu po zmrazení (3 977 řádků). **Kontrakty 3 a 4 jsou opět bez nálezu**, viz 13.1 pro rozsah ověření. V kontraktu 1 zůstávají **čtyři nálezy z minulého kola neopravené** a přibyl **jeden nový**, který vznikl přepisem claim dotazu na dvoukrokový.

| Nález | Stav ve zmrazeném kontraktu | Řádek |
|---|---|---|
| **K1** zamykací klauzule před `LIMIT` | **NEOPRAVENO**, dotaz se nespustí | 2807 až 2809 |
| **K23** join na cíl `UPDATE` uvnitř `FROM` | **NOVÝ**, dotaz se nespustí | 2818 |
| **K2** znaménko v reaperu | **NEOPRAVENO**, krade zprávy živému senderu | 2905 |
| **K8** druhý nejednoznačný průchod | **NEOPRAVENO**, próza a SQL si odporují | 2899 a 2913 |
| **K12** heartbeat bez `created_at` | **NEOPRAVENO** | 2854 |
| **K3** `Message-ID` jako pojistka u SES | **NEOPRAVENO**, zdůvodnění výchozí politiky na SES neplatí | 2887 až 2893, 2912 |

K1, K23 a K2 jsou blokující: první dva znamenají, že se claim dotaz vůbec nespustí, třetí by rozsypal kampaň během první minuty. K3 není chyba kódu, ale chybné zdůvodnění, na kterém stojí volba výchozí politiky.

---

#### K23. BLOKUJÍCÍ, NOVÝ: druhý krok claim dotazu odkazuje na cíl `UPDATE` uvnitř `FROM`

Dvoukrokový claim je správné rozhodnutí a řeší hladovění kampaní. Jeho druhý krok se ale v PostgreSQL nespustí:

```sql
UPDATE messages m
SET ...
FROM claimable cl
JOIN campaigns c  ON c.id = m.campaign_id      -- ← chyba
JOIN workspaces w ON w.id = m.workspace_id     -- ← chyba
WHERE m.id = cl.id AND m.created_at = cl.created_at
  AND c.status IN ('queueing','sending')
```

Cílová tabulka `UPDATE` (zde alias `m`) **není součástí stromu spojení v klauzuli `FROM`**. Odkazovat na ni v podmínce `ON` proto nejde a PostgreSQL to odmítne:

```
ERROR:  invalid reference to FROM-clause entry for table "m"
HINT:   There is an entry for table "m", but it cannot be referenced from this part of the query.
```

Ve `WHERE` je odkaz na cíl v pořádku a běžný, v `ON` uvnitř `FROM` bez `LATERAL` ne. Je to tentýž druh chyby jako u `DELETE ... USING`.

**Návrh opravy:** přesunout spojovací podmínky do `WHERE`. Sémantika i plán zůstanou stejné, protože jde o vnitřní spojení.

```sql
UPDATE messages m
SET status           = 'claimed',
    claimed_by       = $1,
    claimed_at       = now(),
    claim_expires_at = now() + make_interval(secs => $3),
    updated_at       = now()
FROM claimable cl, campaigns c, workspaces w
WHERE m.id = cl.id AND m.created_at = cl.created_at
  AND c.id = m.campaign_id
  AND w.id = m.workspace_id
  AND c.status IN ('queueing','sending')
  AND c.deleted_at IS NULL
  AND w.deleted_at IS NULL
RETURNING m.id, m.created_at, m.workspace_id, m.campaign_id, m.contact_id,
          m.email, m.render_data, m.attempts;
```

**Vzorec, který se opakuje potřetí.** Stojí za to ho pojmenovat, protože všechny tři případy vypadaly v dokumentu správně a lišily se jen tím, že ochranu nic nevynucovalo.

| # | Ochrana | Co chybělo | Jak by se to projevilo |
|---|---|---|---|
| 1 | RLS s politikami `ws_isolation` | scénáře neurčovaly, **pod jakou databázovou rolí** běží | pod migrátorem projdou, v produkci vrací claim nula řádků a kampaň tiše stojí |
| 2 | `WHERE id = $1 AND status = 'sending'` u pozastavení kampaně | nic nevynucuje, aby sender **kontroloval počet ovlivněných řádků** | pozastavení tiše neproběhne a sender dál pálí pokusy proti rozbité konfiguraci |
| 3 | claim dotaz s `SKIP LOCKED` a joiny | nic nevynucuje, aby SQL **někdo spustil** | dvě syntaktické chyby přežijí zmrazení kontraktu |

Společné je, že ověřování hledalo **přítomnost** ochrany, ne její **účinnost**. Grep umí zjistit, že v dokumentu je `FOR UPDATE SKIP LOCKED`; neumí zjistit, že je ve špatném pořadí vůči `LIMIT`.

Praktický důsledek pro tuhle část: kritéria AK-4.6, AK-4.7, AK-20.5 a AK-20.6 nejsou testy funkcí, ale **testy toho, že ochrana funguje**. Každé z nich musí při odstranění příslušné ochrany spadnout, jinak samo nic negarantuje.

**Poznámka k dohledatelnosti obou chyb.** K1 i K23 jsou syntaktické, takže je odhalí **první spuštění proti reálné databázi**. To je dobrá zpráva a zároveň argument pro akceptační kritérium AK-4.7: test, který claim dotaz jen spustí a nic netvrdí o výsledku, by obojí chytil dřív, než na tom kdokoliv začne stavět. Doporučuji ho zařadit do scénářů `OB-*` jako `OB-00`, aby běžel první.

---

### 11.1 Rozpory s kontrakty části 1

Prošel jsem všechny čtyři kontrakty jako implementátor v Go. **Kontrakty 3 a 4 jsou bez nálezu**, ověřeno reprodukcí vektorů (13.1). Nálezy níže se týkají kontraktů 1 a 2. Neupravoval jsem soubor části 1; u každého nálezu je návrh opravy.

Řazeno podle závažnosti.

**Audit úplnosti primárního klíče.** Primární klíč `messages` je `(id, created_at)`, takže každý dotaz mířící na konkrétní zprávu musí nést obě složky, jinak projde všechny partition. Prošel jsem všechny dotazy kontraktu 4.10.1:

| Dotaz | Adresuje zprávu podle | Verdikt |
|---|---|---|
| claim | `m.id = cl.id AND m.created_at = cl.created_at` | **v pořádku** |
| reaper A (uvolnění) | hromadně přes `status` a `claim_expires_at`, konkrétní zprávu neadresuje | **v pořádku**, prořezání není potřeba, jede přes částečný index |
| reaper B (nejednoznačné) | totéž | **v pořádku** |
| uvolnění zbytku dávky při shutdownu | hromadně přes `claimed_by` | **v pořádku** |
| **heartbeat** | `id = ANY($3)` **bez `created_at`** | **chyba, viz K12** |
| kroky 1 a 3 protokolu odeslání | kontrakt je uvádí jen slovně, bez SQL | doplňuji je v 3.4.1 včetně `created_at` |

Jediná závada je tedy heartbeat. Ve svých Go typech nesu identitu zprávy jako dvojici `MessageKey{ID, CreatedAt}` (3.1), aby ji nešlo při refaktoru ztratit.

---

#### K1. BLOKUJÍCÍ: normativní claim dotaz je syntakticky neplatný

Kontrakt 4.10.1, "Claim dotaz (normativní, bajt za bajtem takto)":

```sql
  ORDER BY m.next_attempt_at, m.id
  FOR UPDATE OF m SKIP LOCKED
  LIMIT $2
```

V PostgreSQL musí zamykací klauzule stát **za** `LIMIT`. Gramatika `SELECT` v oficiální dokumentaci PostgreSQL 18 má pořadí:

```
[ ORDER BY ... ]
[ LIMIT { count | ALL } ]
[ OFFSET start [ ROW | ROWS ] ]
[ FETCH { FIRST | NEXT } [ count ] { ROW | ROWS } { ONLY | WITH TIES } ]
[ FOR { UPDATE | NO KEY UPDATE | SHARE | KEY SHARE } [ OF from_reference [, ...] ] [ NOWAIT | SKIP LOCKED ] [...] ]
```

Dotaz v uvedeném pořadí skončí chybou `syntax error at or near "LIMIT"`. Protože je označený jako závazný bajt za bajtem, opravit ho musí část 1, ne já potichu.

**Návrh opravy:** prohodit poslední dva řádky.

```sql
  ORDER BY m.next_attempt_at, m.id
  LIMIT $2
  FOR UPDATE OF m SKIP LOCKED
```

---

#### K2. BLOKUJÍCÍ: reaper nejednoznačných zpráv krade zprávy živému senderu

Kontrakt 4.10.1, druhý dotaz reaperu:

```sql
WHERE status = 'claimed'
  AND claim_expires_at < now() + make_interval(secs => $2)  -- prodloužená rezerva
  AND dispatch_started_at IS NOT NULL
  AND provider_message_id IS NULL
```

Komentář říká "prodloužená rezerva" a text pod tabulkou říká, že nejednoznačná zpráva se uvolňuje **později** než běžná. Uvedená podmínka dělá pravý opak: přičtením k `now()` se práh posouvá do budoucnosti, takže dotaz zabírá **víc** řádků, ne méně.

Konkrétní dopad při výchozích hodnotách:

| Krok | Hodnota |
|---|---|
| `SENDER_CLAIM_TTL_SECONDS` | 300 |
| Heartbeat nastavuje `claim_expires_at` | `now() + 300 s` |
| `$2` je dvojnásobek TTL | 600 s |
| Podmínka | `now() + 300 < now() + 600` |
| Vyhodnocení | **vždy pravda** |

Zároveň platí `dispatch_started_at IS NOT NULL` (nastavuje se v kroku 1, před voláním provideru) a `provider_message_id IS NULL` (zapisuje se až v kroku 3). Reaper běží každých 30 sekund.

Výsledek: **každá zpráva, kterou sender právě odesílá, je na nejbližším tiku reaperu prohlášena za nejednoznačnou**, vrácena na `pending` a označena `error_code = 'ambiguous_dispatch'`. Při politice `retry` se odešle znovu, tedy duplicitně. Při druhém průchodu skončí na `failed`. Kampaň by se rozsypala během první minuty a mechanismus, který má duplicitám bránit, by je sám vyráběl.

**Návrh opravy:** změnit znaménko.

```sql
  AND claim_expires_at < now() - make_interval(secs => $2)
```

Doporučuji zároveň doplnit testovací scénář, který to hlídá: `OB-12` "zpráva s běžícím heartbeatem a rozpracovaným dispatchem není reaperem nikdy uvolněna". Bez něj se stejná chyba může vrátit.

---

#### K3. BLOKUJÍCÍ: deterministický `Message-ID` u Amazon SES nefunguje

Kontrakt 4.10.1, zmírnění (a): "Sender vždy generuje `Message-ID: <oe.{base32_lower(...)}@{sending_domain}>`. Opakované odeslání téže zprávy má proto identický `Message-ID` a většina přijímajících MTA a poštovních klientů ho deduplikuje."

Ověřeno v dokumentaci AWS ("Amazon SES header fields"), doslovné znění:

> If you provide a `Message-ID` header, Amazon SES overrides the header with its own value.

Amazon SES je podle hlavní specifikace provider první třídy. Na něm tedy zmírnění **neúčinkuje vůbec**, protože příjemce naše `Message-ID` nikdy neuvidí. Dvě odeslání téže zprávy dostanou dvě různé hodnoty od SES a žádný přijímající server je nespáruje.

Důsledky, které z toho plynou:

1. Odůvodnění výchozí politiky `retry` ("duplikát navíc `Message-ID` často odchytí") na SES neplatí. Rozhodnutí o výchozí hodnotě `AMBIGUOUS_DISPATCH_POLICY` je podle P4-2 na části 4; s touhle znalostí doporučuji **`fail` jako výchozí u SES a `retry` u SMTP**, protože u SMTP zmírnění funguje.
2. Testovací scénář `OB-11` ("`Message-ID` u dvou pokusů téže zprávy je identický řetězec") projde na úrovni MIME builderu, ale netestuje nic, co by u SES mělo účinek. Doporučuji do něj doplnit poznámku, aby nevzbuzoval falešnou jistotu.
3. `Message-ID` má smysl generovat dál, protože u SMTP účinkuje a protože je to podle RFC 5322 povinná hlavička.

**Návrh opravy:** ponechat mechanismus, ale v kontraktu napsat, že u SES je neúčinný, a nechat výchozí politiku rozhodnout podle typu provideru.

---

#### K4. BLOKUJÍCÍ (zvýšeno): literály `blank` a `empty` v `osteele/liquid` neexistují

**Stav: část 3 nález potvrdila a zvýšila na blokující.** Do rozhodnutí je její validátor **odmítá**, takže je přísnější než kontrakt a přes kompilaci mi nic neprojde. Shodujeme se i na řešení: **vyřadit `blank` a `empty` z gramatiky** a nahradit je prostým `!= ""`, ne přidávat šestý filtr. Řetězec ze samých mezer má řešit část 2 ořezáním při zápisu kontaktu, což je stejně správnější místo.

Kontrakt 4.10.2, gramatika:

```
literal := string_literal | number | "true" | "false" | "nil" | "blank" | "empty"
```

a normativní pravidlo 4: "`blank` a `empty` se porovnávají jen operátory `==` a `!=`. `x == blank` je pravda pro `nil`, `""`, `"   "`, `[]`, `{}`."

Ověřeno ve zdrojovém kódu `osteele/liquid` v1.8.1, soubor `expressions/scanner.rl`, sekce konstant:

```
# constants
("true" | "false") => Bool;
"nil" => { tok = LITERAL; out.val = nil; fbreak; };
```

Lexer zná **jen** `true`, `false` a `nil`. Řetězce `blank` a `empty` se nerozpoznají jako literály, prolezou jako běžné identifikátory a vyhodnotí se jako vyhledání proměnné, které podle pravidla 1 vrátí `nil`.

Praktický dopad, protože tohle je přesně ten typ chyby, kvůli které kontrakty existují:

| Šablona | LiquidJS (náhled) | `osteele/liquid` (odeslání) |
|---|---|---|
| `{% if contact.first_name == blank %}Dobrý den{% else %}Dobrý den, {{ contact.first_name_vocative }}{% endif %}` s `first_name = ""` | první větev | **druhá větev** (`"" == nil` je nepravda) |
| totéž s `first_name = null` | první větev | první větev (shodou okolností) |

Uživatel by v náhledu viděl "Dobrý den" a odeslalo by se "Dobrý den, " s visící čárkou, tedy přesně ta chyba, kterou hlavní specifikace v kapitole 6.3 označuje za amatérskou.

Sada fixtures `LQ-3xx` podle kontraktu má `blank` a `empty` pokrývat, takže by to CI zachytilo. Zachytilo by to ale jako **neopravitelný červený test**, ne jako drobnost, protože oprava vyžaduje zásah do knihovny.

**Tři možná řešení, doporučuji třetí:**

1. Forknout `osteele/liquid` a doplnit dva literály do lexeru. Lexer je generovaný Ragelem, takže je to zásah do build pipeline. Nedoporučuji.
2. Předzpracovat šablonu před parsováním a nahradit `== blank` za volání vlastního filtru. Křehké.
3. **Vyřadit `blank` a `empty` z gramatiky** a zavést místo nich vlastní filtr `is_blank` (nebo povolit `{% if contact.first_name == "" %}` a `{% if contact.first_name %}`). Vlastní filtr je věc, kterou kontrakt už stejně používá u ostatních pěti, takže to nepřidává žádný nový princip. Sémantiku "prázdný nebo jen mezery" pak definuje kontrakt jednou a implementují ji obě strany.

Poznámka: pravidlo "falešné jsou jen `false` a `nil`" (pravidlo 2) je naopak **potvrzené**, README `osteele/liquid` to uvádí doslova a LiquidJS se s vypnutým `jsTruthy` chová stejně. Ten bod je v pořádku.

---

#### K5. VYŘEŠENO GRANTEM: přechod `claimed → skipped` senderem

**Stav: řeší se přidáním `GRANT SELECT ON suppressions`.** Tím původní námitka padá a **měním svoje stanovisko**: s tím grantem přechod implementovat budu, protože zmenší okno, ve kterém dostane mail někdo, kdo se mezitím odhlásil, z desítek sekund na jednotky.

Implementace, na které trvám, je **dávková, ne po zprávách**. Po claimu dávky 500 zpráv se pustí jeden dotaz:

```sql
SELECT lower(email) FROM suppressions
WHERE workspace_id = $1 AND lower(email) = ANY($2);
```

Zprávy, jejichž adresa se vrátí, se hromadně překlopí na `skipped` a z dávky vypadnou ještě před krokem D0. Jeden dotaz na dávku, ne 500 dotazů. Kdyby se to implementovalo po zprávách, přidalo by to round trip do horké cesty a propustnost by spadla na polovinu.

Původní znění nálezu zůstává níže, protože rozpor uvnitř kontraktu byl skutečný a je dobré vědět, proč se grant přidává.



Kontrakt 4.10.1, tabulka přechodů:

| Z | Do | Kdo | Podmínka |
|---|---|---|---|
| `claimed` | `skipped` | **sender** | kontrola suppression těsně před odesláním selhala |

Tatáž sekce ale definuje roli `openengage_sender` bez jakéhokoliv práva na `suppressions`, `contacts` a `list_subscriptions`, s komentářem "Žádná práva na contacts... Sender kontakty nečte, data má v render_data."

Sender tedy **nemá jak tu kontrolu provést**. Je to rozpor uvnitř jednoho kontraktu.

**Návrh opravy:** přechod z tabulky odstranit a `pending → skipped` (aplikací) ponechat jako jediný způsob, jak zprávu vyřadit. Průběžnou kontrolu odhlášení pak dělá job aplikace, který překlápí `pending → skipped`; zprávy, které sender už claimnul, propadnou a odešlou se. Je to odpověď na otázku 3 ze zadání a patří do části 4a, viz P4a.10.

Kdyby se trvalo na kontrole těsně před odesláním, musel by sender dostat `SELECT` na `suppressions` a dělat dávkový dotaz `WHERE email = ANY($1)` na celou dávku, ne jeden dotaz na zprávu.

**Část 4a s vyřazením souhlasí** a potvrdila, že bez toho její řešení funguje, jen s větším oknem: zprávy odhlášené během rozesílky ruší její job `revokePendingMessages` do 1 sekundy, claimnuté zprávy propadnou. Okno je tedy nejvýš doba zpracování jedné dávky. Zůstává tak jediné: odstranit ten přechod z kontraktní tabulky, aby nesliboval chování, které nikdo neimplementuje.

---

#### K6. VÁŽNÝ: `uq_messages__campaign_contact` negarantuje, co slibuje

Kontrakt 4.10.1:

```sql
-- Deduplikace publika: jeden kontakt dostane kampaň nejvýš jednou.
CREATE UNIQUE INDEX uq_messages__campaign_contact
  ON messages (campaign_id, contact_id, created_at);
```

`created_at` je v indexu proto, že partitionovaná tabulka to vyžaduje. Jenže `created_at` má `DEFAULT now()` a materializace vkládá řádky postupně, takže dvě materializace téže kampaně (dvojklik na "Odeslat", opakovaný job, ruční zásah) mají různé hodnoty `created_at` a **obě projdou**. Index zabrání jen doslovné duplicitě ve stejné mikrosekundě.

Komentář nad indexem tedy slibuje záruku, kterou index nedává, což je horší než index nemít, protože se na něj někdo spolehne.

**Návrh opravy:** doplnit do kontraktu požadavek, aby materializace nastavila **všem řádkům jedné kampaně stejné `created_at`**, převzaté z jedné hodnoty určené na začátku materializace (například `campaigns.materialized_at`). Pak celá kampaň leží v jedné partition, index je skutečnou zárukou a jako vedlejší efekt zmizí i riziko, že se kampaň rozpadne přes hranici měsíce. Druhá vrstva (advisory lock na `campaign_id`) patří do části 4a.

---

#### K7. VÁŽNÝ: sender nedostane adresu, ze které staví trackovací odkazy

Kontrakt 4.9, tabulka konfiguračních proměnných, sloupec "Kdo":

| Proměnná | Kdo | Výchozí |
|---|---|---|
| `APP_URL` | **W K** | povinná |
| `TRACKING_DOMAIN` | **W S** | odvozeno z `APP_URL` |

Sender má `TRACKING_DOMAIN`, ale **nemá `APP_URL`**. Když operátor `TRACKING_DOMAIN` nenastaví (což je běžný případ, protože je nepovinná), má se odvodit z `APP_URL`, kterou sender nemá. Sender pak nemá z čeho postavit `/t/o/<token>` ani `/t/c/<token>` a nemůže nastartovat.

Že jde o nedopatření a ne o záměr potvrzuje sama část 1: v průvodní zprávě píše "sender potřebuje `APP_URL` a `SECRET_KEY` a nic dalšího z mé konfigurace", zatímco tabulka 4.9 mu `APP_URL` nedává. Rozchází se tedy text a tabulka uvnitř jednoho dokumentu.

**Návrh opravy, kterákoliv varianta stačí:**

1. Přidat `APP_URL` do sloupce "Kdo" i pro `S`. Nejjednodušší a odpovídá tomu, co část 1 sama píše.
2. Nebo udělat `TRACKING_DOMAIN` povinnou pro `MODE=sender` a odvození z `APP_URL` provést v entrypointu image, ne v procesu senderu.

Ať se zvolí cokoliv, potřebuji navíc **rozhodnout tvar hodnoty**: `TRACKING_DOMAIN` je podle názvu doména (`events.shop.cz`), ale výchozí hodnota se odvozuje z URL. Sender potřebuje vědět, jestli hodnota obsahuje schéma, jestli může obsahovat cestu a jestli má koncové lomítko. Bez toho se odkazy v mailu rozejdou s tím, co ověřuje aplikace.

---

#### K8. VÁŽNÝ: pravidlo "podruhé vždy `failed`" není v normativním SQL implementované

Kontrakt 4.10.1, próza: "Zpráva, která už jednou prošla nejednoznačným stavem, se rozpozná podle `error_code = 'ambiguous_dispatch'` a při druhém výskytu jde vždy na `failed`, ať je politika jakákoliv. Bez toho by mohla trvale cyklit."

Normativní dotaz ale větví jen podle politiky:

```sql
SET status = CASE WHEN $1 = 'retry' THEN 'pending' ELSE 'failed' END,
    error_code = 'ambiguous_dispatch',
```

Rozpoznání druhého výskytu tam není. A rozpoznávat ho podle `error_code` ani nejde spolehlivě: mezi prvním a druhým nejednoznačným odesláním může proběhnout běžný opakovatelný neúspěch (`rate_limited`, `network_error`), který `error_code` přepíše. Značka se tím ztratí a zpráva může cyklit, přesně jak próza varuje.

**Návrh opravy:** samostatný čítač, který se nikdy nepřepisuje.

```sql
UPDATE messages
SET status = CASE WHEN ambiguous_count >= 1 OR $1 = 'fail' THEN 'failed' ELSE 'pending' END,
    ambiguous_count = ambiguous_count + 1,
    error_code = 'ambiguous_dispatch',
    ...
```

Sloupec `ambiguous_count smallint NOT NULL DEFAULT 0` mám ve svém DDL (2.1) jako doplněk části 4, protože kontrakt doplňování sloupců dovoluje. Do kontraktu by ale patřil, protože bez něj jeho vlastní pravidlo neplatí.

---

#### K9. STŘEDNÍ: `contact_id NOT NULL` znemožňuje testovací odeslání

Kontrakt 4.10.1 má `contact_id uuid NOT NULL`. Kontrolní otázka 19 ze zadání ale počítá s testovacím odesláním na libovolnou adresu, kterou zadá uživatel a která žádnému kontaktu neodpovídá.

Navíc `uq_messages__campaign_contact` by zabránil poslat dva testy téže kampaně témuž člověku, což je při ladění šablony úplně běžné.

**Návrh opravy:** `contact_id` udělat nullable a unikátní index změnit na částečný:

```sql
CREATE UNIQUE INDEX uq_messages__campaign_contact
  ON messages (campaign_id, contact_id, created_at)
  WHERE is_test = false AND contact_id IS NOT NULL;
```

`is_test` je doplněk části 4, takže by kontrakt musel buď ten sloupec převzít, nebo formulovat podmínku jinak.

---

#### K10. STŘEDNÍ: filtr `date` nemá v Go přístup k `_context.timezone`

Kontrakt 4.10.2: "Časová zóna výstupu se bere z `render_data._context.timezone`, chybí-li, `UTC`."

V LiquidJS filtr dostane kontext renderu a může si zónu přečíst. V `osteele/liquid` je filtr registrovaný na engine přes `RegisterFilter(name, fn)` a funkce dostane **jen svou hodnotu a argumenty**, ne bindings. Přečíst `_context.timezone` uvnitř filtru tedy nejde.

Není to neřešitelné, ale řešení má důsledek, který musí být v kontraktu napsaný: zóna se musí zafixovat **při vytvoření engine**, ne při renderu jedné zprávy. Sender proto drží cache engine podle časové zóny.

To je v pořádku, dokud je `_context.timezone` konstantní v rámci kampaně (typicky je to zóna projektu). **Kdyby se někdy stala vlastností kontaktu** (a je to lákavá funkce, "pošli v místním čase příjemce"), Go strana by musela vytvářet engine na každou zprávu, což je řádově dražší než render sám.

**Návrh opravy:** do kontraktu doplnit větu, že `_context.timezone` je konstantní pro celou kampaň a nesmí se lišit mezi příjemci. Kdyby se to mělo změnit, je to změna kontraktu, ne detail části 2.

---

#### K11. DROBNÉ (sníženo): automatické escapování tiše registruje filtr `safe`

**Stav: sníženo ze středního na drobné** po argumentu části 3. Její validátor propouští jen pět filtrů z kontraktu, takže se šablona s `{{ x | safe }}` vůbec neuloží, a invariant I1 navíc po renderu znovu parsuje každý `{{ }}` ve vygenerovaném HTML. Do `compiled_html` se `safe` nemůže dostat cestou, která nevede přes ruční zápis do databáze.

Obranu na své straně si ponechávám, ale **přesouvám ji z horké cesty**: `strings.Contains(html, "| safe")` se kontroluje **jednou při načtení kampaně do cache**, ne u každé zprávy. Náklad je tím nulový a pojistka zůstává.

Dobrá zpráva nejdřív: `osteele/liquid` metodu pro automatické escapování **má**, takže kontrakt 4.10.2 je v Go implementovatelný. Je to `Engine.SetAutoEscapeReplacer(replacer render.Replacer)`. Obě věci níže jsou řešitelné, ale musí být v kontraktu, protože obojí je past, do které spadne každý, kdo bude implementovat podle popisu.

**a) Nepoužívat vestavěný `render.HtmlEscaper`.** Kontrakt předepisuje přesně pět náhrad, mezi nimi `"` → `&quot;`. Vestavěný escaper v Go se opírá o `html.EscapeString`, který produkuje `&#34;`. Obojí je v prohlížeči rovnocenné, ale kontrakt vyžaduje shodu **bajt po bajtu** proti LiquidJS a golden fixtures. Sender proto musí předat **vlastní** `Replacer`. Napsal jsem to do 13.5, ale patří to do kontraktu, protože je to past, do které spadne každý, kdo bude implementovat podle popisu.

**b) `SetAutoEscapeReplacer` volá interně `AddSafeFilter()`,** tedy zaregistruje filtr `safe`, který zabalí hodnotu do `values.SafeValue`, a renderer takovou hodnotu escapováním neprožene. Šablona s `{{ x | safe }}` by tedy vložila do HTML neescapovanou hodnotu, což je tichá výjimka z pravidla "automatické escapování se vypnout nedá".

`Engine` nemá `UnregisterFilter`, takže filtr nejde odebrat. **Jde ale přebít**, a to čistě. Ve zdrojovém kódu `expressions/filters.go`:

```go
func (c *Config) AddSafeFilter() {
	if c.filters["safe"] == nil {     // ← zapíše se jen tehdy, když tam nic není
		c.ensureMapIsCreated()
		c.filters["safe"] = func(in interface{}) interface{} { ... }
	}
}
```

Registrace je podmíněná. Když si tedy **vlastní `safe` zaregistrujeme dřív**, než zavoláme `SetAutoEscapeReplacer`, vestavěný se nezapíše a náš zůstane. Náš `safe` hodnotu vrátí beze změny (nezabalí ji do `SafeValue`), takže escapování proběhne normálně a bypass přestane existovat.

```
1. engine.RegisterFilter("safe", <vrací vstup beze změny>)
2. engine.SetAutoEscapeReplacer(<náš replacer>)   // AddSafeFilter už nic nepřepíše
```

**Návrh opravy:** pořadí těch dvou volání zapsat do kontraktu jako závazné, protože obrácené pořadí tiše otevírá díru. Plus fixture ve skupině `LQ-5xx`, že `| safe` validátor odmítne, a akceptační kritérium AK-6.16.

---

#### K12. STŘEDNÍ: heartbeat prochází všechny partition

Kontrakt 4.10.1, heartbeat:

```sql
UPDATE messages
SET claim_expires_at = now() + make_interval(secs => $2), updated_at = now()
WHERE status = 'claimed' AND claimed_by = $1 AND id = ANY($3);
```

Primární klíč je `(id, created_at)`. Podmínka obsahuje `id`, ale ne `created_at`, takže planner nemůže prořezat partition a dotaz sáhne na všechny. Zároveň jediný použitelný index (`idx_messages__stuck`) je nad `claim_expires_at`, což tenhle dotaz nepoužívá. Při 24 partition a heartbeatu každých 100 sekund to není havárie, ale je to zbytečné a s rostoucí retencí to roste.

Je to tentýž problém, který si část 1 správně pojmenovala v rozporu R5 ("každý dotaz na jednu zprávu potřebuje i `created_at`"), jen na tenhle dotaz nebyl aplikovaný.

**Návrh opravy, dvě varianty:**

1. Předávat i pole `created_at` a párovat dvojice. Přesné, ale ošklivé v `ANY`.
2. **Jednodušší a doporučuji ji:** vypustit `id = ANY($3)` úplně a obnovovat všechny claimy téhle instance:

```sql
UPDATE messages
SET claim_expires_at = now() + make_interval(secs => $2), updated_at = now()
WHERE status = 'claimed' AND claimed_by = $1;
```

Instance drží jen to, co sama claimla, takže je to sémanticky totéž, a s částečným indexem nad `(claimed_by)` `WHERE status = 'claimed'` je to jeden levný scan.

---

#### K13. DROBNÉ: `base32_lower` není jednoznačně určený

Kontrakt 4.10.1: `Message-ID: <oe.{base32_lower(uuid_bytes(messages.id))}@{sending_domain}>`, a testovací scénář `OB-11` porovnává řetězec.

Nespecifikované je: která abeceda (RFC 4648 standardní, nebo Crockford, nebo hex-base32), a jestli se doplňuje padding. Go `encoding/base32` nabízí `StdEncoding`, `HexEncoding` a `RawStdEncoding` a dávají různé výsledky. 16 bajtů v base32 je 26 znaků plus 6 znaků paddingu.

**Návrh opravy:** doplnit jednu větu ("RFC 4648 standardní abeceda, bez paddingu, převedeno na malá písmena") a jeden testovací vektor, například pro `message_id = 0192f3a0-1c2d-7e41-8b2c-3d4e5f607182`.

---

#### K14. DROBNÉ: `SENDER_ID` s PID znemožňuje rychlou obnovu po restartu

Kontrakt 4.9: `SENDER_ID`, výchozí "hostname + PID".

PID se při restartu změní, takže sender po nastartování nepozná vlastní osiřelé claimy a musí čekat, až je uvolní reaper po `SENDER_CLAIM_TTL_SECONDS`, tedy 5 minut. Po každém restartu kontejneru se tedy kampaň na 5 minut zadrhne, i když je jinak vše v pořádku.

Kontrakt s tím počítá (tabulka "Restart s jiným `SENDER_ID`: staré claimy uvolní reaper"), takže o nekorektnost nejde, jen o zbytečné čekání.

**Návrh opravy:** výchozí hodnotu nechat jako hostname bez PID (v kontejneru je hostname stabilní a unikátní) a PID přidávat jen tehdy, když `MODE=all`, kde na jednom hostu běží víc procesů. Sender pak při startu jedním dotazem uvolní vlastní `dispatch_started_at IS NULL` claimy okamžitě.

Kdyby to bylo příliš, stačí do dokumentace poznámka, že operátor má `SENDER_ID` nastavit ručně, chce-li rychlý restart.

---

#### K15. DROBNÉ: limit 200 iterací nejde vynutit v knihovně

Kontrakt 4.10.2: "iterací v jednom `for`: 200. Při renderu se cyklus ukončí a zapíše se varování do `message_events`."

Ani `osteele/liquid`, ani LiquidJS neumí přerušit vestavěný `for` po N iteracích bez zásahu do tagu. Implementovatelné to je, ale jinak, než popis naznačuje: **pole v `render_data` se ořízne na 200 prvků ještě před renderem**. Výsledek je stejný, ale musí to obě strany dělat identicky, jinak se výstup rozejde u 201. prvku.

**Návrh opravy:** přeformulovat pravidlo na "pole delší než 200 prvků se před renderem zkrátí na prvních 200" a doplnit fixture `LQ-4xx` s polem o 201 prvcích.

---

#### K16. VYŘEŠENO: token typu `u` nemá kdo vyrobit

Kontrakt 4.10.3 uvádí typ `u` (unsubscribe) s payloadem `workspace_id, message_id, contact_id, list_id, issued_at` a v úvodu říká "Sender tokeny vyrábí, aplikace je ověřuje".

Sender ale `list_id` **nemá**. Není to sloupec `messages`, není v `RETURNING` claim dotazu a sender nemá práva na `list_subscriptions`. Vyrobit `u` token tedy nemůže.

**Vyřešeno v mezičase.** Část 4a doplnila sloupec `campaigns.unsubscribe_list_id uuid`, který sender načte jednou na kampaň claim dotazem. Ostatní vstupy (`workspace_id`, `message_id`, `contact_id`) vrací claim dotaz. Sender tedy token typu `u` vyrobit může a vyrábí ho.

Zůstává jediná drobnost k doplnění do kontraktu: **věta, kdo vyrábí který typ.** Sender vyrábí `o`, `c` a `u`; aplikace vyrábí `i`, protože ten potřebuje mechanismus jednorázových nonce, který sender nemá.

Zároveň je potřeba z kontraktu 4.10.2 vypustit `unsubscribe_url`, `one_click_unsubscribe_url`, `preferences_url` a `webview_url` z výčtu proměnných, které sender "najde v `render_data`". Nenajde, staví si je sám. Rozdíl je věcný, ne kosmetický: kdyby je 4a do `render_data` skutečně dala, byly by tam dvakrát a mohly by se lišit.

---

#### K17. DROBNÉ: sender má zapisovat do `message_events`, ale nezná jejich schéma

Kontrakt 4.10.1 dává senderu `GRANT INSERT ON message_events` a kontrakt 4.10.2 po něm chce zapisovat `render_warning`. Schéma tabulky vlastní část 5.

Potřebuji znát sloupce, povinnost `created_at` kvůli partitioningu a povolené hodnoty `type`. Zapsal jsem to jako požadavek P5.10.

Zároveň upozorňuji na objem: pravidlo "chybějící hodnota v `render_data` → `render_warning`" znamená u kampaně na 50 000 příjemců, kde jedna šablona odkazuje na pole, které polovina kontaktů nemá vyplněné, **25 000 insertů, které nesou stále tutéž informaci**. Doporučuji varování agregovat na úroveň kampaně a cesty (jeden řádek s počtem), ne na úroveň zprávy.

---

#### K22. BLOKUJÍCÍ, JIŽ SE ŘEŠÍ: předání zkompilované šablony nebylo kontraktem

Sender očekával značky `__OE_CLICK_<n>__` a `__OE_OPEN_PIXEL__`, které jsem si navrhl sám. Část 3 vyráběla `<!--OE_OPEN_PIXEL-->`, atribut `data-oe-link="<id>"` a v textu `[[oe:link:<id>]]`. Nikdy bychom se nepotkali: v odeslaných mailech by zůstaly viset značky, nefungovalo by sledování otevření ani kliknutí.

**Příčina je systémová.** Předání zkompilované šablony je rozhraní mezi TypeScriptem a Go přesně jako čtyři číslované kontrakty, ale mezi ně zařazené nebylo. Nekontrolovalo se, protože nebylo v seznamu. Můj vlastní výrok "kontrakty 3 a 4 jsou bez nálezu" byl pravdivý a přesto zavádějící, protože jsem prověřoval jen to, co bylo za kontrakt označené.

**Stav: řeší se.** Orchestrátor zavedl pátý kontrakt "Předání zkompilované šablony senderu", vlastní ho část 3. Můj původní návrh se značkou přímo v `href` byl přijat jako správný, protože atributová varianta by mě nutila parsovat HTML. Kritéria, podle kterých návrh posoudím, jsou S1 až S10 v sekci 3.7.1.

**Poučení, které patří do procesu, ne jen do tohohle dokumentu:** kontraktem musí být **každé** rozhraní mezi dvěma jazyky, ne jen to, co někdo předem očísloval. Kandidáti, které je při té příležitosti dobré prověřit stejným způsobem: schéma `message_events`, do kterého sender zapisuje (P5.10), a tvar `render_data` (P4a.4). Obojí je předání dat z TypeScriptu do Go a ani jedno dnes kontrakt není.

---

#### K21. VÁŽNÝ, ROZHODUJE SE ZVLÁŠŤ: sender nemá právo pozastavit kampaň

**Stav:** orchestrátor potvrdil věcnou správnost a rozhoduje o rozšíření práv samostatně, protože jde o bezpečnostní hranici. Do rozhodnutí sender kampaň nepozastavuje a chová se podle prozatímního postupu v 3.13.

Kontraktní role z 4.10.1 má na `campaigns` jen `GRANT SELECT`. Sender ale potřebuje kampaň pozastavit ve dvou situacích, které jsou obě součástí zadání:

1. **Circuit breaker** po opakovaných fatálních chybách (neplatné přístupy k provideru, pozastavený účet SES, neověřená doména). Bez něj by se každá z padesáti tisíc zpráv pokusila odeslat pětkrát a nadělala čtvrt milionu zbytečných volání.
2. **Kontraktní pravidlo 4.10.2**, že se kampaň pozastaví, když podíl selhání z důvodu renderu přesáhne 5 % z prvních tisíce zpráv.

Ani jedno nejde s právem jen na čtení.

Chybí zároveň sloupec, kam zapsat důvod. `campaigns.pause_reason` v části 1 ani v hlavní specifikaci není, a bez něj by uživatel viděl jen pozastavenou kampaň bez vysvětlení.

**Návrh opravy:** doplnit do kontraktní role sloupcový grant a do `campaigns` jeden sloupec.

```sql
GRANT UPDATE (status, pause_reason) ON campaigns TO openengage_sender;
ALTER TABLE campaigns ADD COLUMN pause_reason jsonb;
```

Sloupcový grant je tady důležitý: sender nesmí měnit `compiled_html`, `subject` ani nic dalšího.

Alternativa, kterou jsem zvážil a zamítl: sender by pozastavení jen signalizoval zápisem do `message_events` a kampaň by pauzoval job aplikace. Zamítám ji proto, že mezi signálem a reakcí by uběhly sekundy až desítky sekund, během kterých by sender dál pálil pokusy proti rozbité konfiguraci. Pozastavení musí být okamžité.

---

#### K18. NÁVRH: sloupcové granty na `messages`

Kontrakt dává `GRANT SELECT, UPDATE ON messages`. Sender ve skutečnosti potřebuje `UPDATE` jen na deseti sloupcích a nikdy nesmí sáhnout na `workspace_id`, `campaign_id`, `contact_id`, `email` a `render_data`.

PostgreSQL sloupcové granty umí. Není to rozpor, je to zpřísnění zdarma, které dává smysl u role, jejímž jediným smyslem je být bezpečnostní hranicí.

```sql
GRANT SELECT ON messages TO openengage_sender;
GRANT UPDATE (status, claimed_by, claimed_at, claim_expires_at, dispatch_started_at,
              attempts, next_attempt_at, provider_message_id, sent_at,
              error_code, error_detail, ambiguous_count, updated_at)
  ON messages TO openengage_sender;
```

---

#### K19. NÁVRH: `upcase` a německé `ß`

Kontrakt 4.10.2 definuje `upcase` jako "Unicode velká písmena podle simple uppercase mapping (bez speciálních pravidel pro turečtinu)".

Go `strings.ToUpper("ß")` vrací `ß`, JavaScript `"ß".toUpperCase()` vrací `SS`. Formulace "simple uppercase mapping" je správná a odpovídá chování Go; JavaScript se jí nedrží, protože používá full case mapping.

Českých znaků se to netýká, ověřeno: `ěščřžýáíé` se v obou převede shodně. Německé jméno v české databázi ale není nic výjimečného.

**Návrh opravy:** doplnit fixture `LQ-6xx` s `ß` a v definici filtru napsat explicitně, že se použije simple mapping, tedy že TypeScriptová strana **nesmí** použít prosté `toUpperCase()`, ale musí `ß` vyjmout. Jinak fixture spadne a nebude jasné, která strana je špatně.

---

#### K20. NÁVRH: dekódování čísel z `render_data`

Kontrakt 4.10.2, pravidlo 6: "celá čísla bez desetinné části, desetinná s tečkou a bez koncových nul".

V Go se `render_data` dekóduje z `jsonb`. Výchozí `encoding/json` mapuje všechna čísla na `float64`, takže celé číslo nad 2^53 ztratí přesnost a vypíše se jinak než v LiquidJS, kde `JSON.parse` dělá totéž, ale `BigInt` se do JSON stejně nedostane. Reálný případ: číslo objednávky nebo variabilní symbol uložený jako číslo, ne jako řetězec.

**Návrh opravy:** doplnit do kontraktu větu, že číselné hodnoty v `render_data` nad 2^53 musí být uložené jako řetězec, nebo že se v Go dekóduje s `json.Number` a v TypeScriptu se čísla neprocházejí přes `Number`. Plus fixture s `9007199254740993`.

---

### 11.2 Přicházející změny kontraktu a jejich dopad na sender

Orchestrátor předal části 1 patnáct změn. Následující se týkají senderu přímo a **už jsou v tomhle dokumentu zapracované**, aby nevznikly dvě verze. Až část 1 změny dokončí, projdu je znovu a potvrdím shodu.

| Změna | Kde je u mě zapracovaná | Dopad |
|---|---|---|
| **Permisivní politika `sender_bypass` na každé tabulce s grantem.** Role nemá `BYPASSRLS` a nikdy nenastaví kontext workspace, takže by pod RLS viděla **nula řádků**. Claim by trvale vracel prázdnou dávku a nikdy by se neodeslalo nic. | 2.4, AK-20.5 a AK-20.6 | **Nejzávažnější položka.** Chyba by se navíc neprojevila jako chyba: prázdná dávka je legitimní stav, takže by kampaň jen tiše stála. |
| Scénáře `OB-01` až `OB-11` musí běžet **pod rolí `openengage_sender`** | AK-20.5 | Pod migrátorem nebo aplikační rolí by předchozí chybu dokonale zamaskovaly, protože obě RLS obcházejí. |
| Dvoukrokový claim, aby pozastavená kampaň nezastavila ostatní | 3.2 | Tenhle tvar jsem měl od začátku jako doplněk (`campaign_id = $4`), změna z něj dělá normu. |
| `GRANT SELECT ON suppressions` | K5, 3.5 | **Měním stanovisko:** s grantem přechod `claimed → skipped` implementovat budu, dávkově jedním dotazem na dávku. |
| Odesílat jde už ve stavu `queueing` | 3.2 | Nemá smysl čekat, až doběhne materializace milionového publika. |
| `sent` je koncový stav, pozdní bounce zůstává jen v `message_events` | 3.5 | Beze změny pro mě. Moje oprava opožděnou událostí jde směrem `failed → sent`, takže stav `sent` nikdy nemění. |
| Selhání dešifrování konfigurace je **opakovatelná**, ne trvalá chyba | 3.12.2, katalog 4.2 | Rozšířil jsem to na pravidlo: **žádná chyba třídy `Fatal` nesmí zprávu označit jako `failed`.** Fatální chyba zastavuje kampaň, ne zprávy. |
| Tvar `message_events` se stane kontraktem | P5.10 | Vítám. Je to přesně ta třída díry jako K22: předání dat z TypeScriptu do Go, které kontraktem nebylo. |

### 11.3 Rozpory s hlavní specifikací

Následující nálezy platí proti hlavní specifikaci. **Většina z nich je částí 1 už vyřešena** a nechávám je tady jen pro doložení, že byly vzaty v potaz.

| # | Nález | Stav |
|---|---|---|
| R1 | `messages` v hlavní specifikaci nemá `dispatch_started_at`, bez kterého nejde po pádu rozlišit neodeslanou zprávu od nejisté | **Vyřešeno.** Kontrakt 4.10.1 sloupec zavádí. |
| R2 | Stavový výčet nepokrývá nejistý stav | **Vyřešeno jinak, než jsem navrhoval.** Kontrakt nezavádí šestý stav, ale `error_code = 'ambiguous_dispatch'` nad `pending` a `failed`. Přijímám, je to úspornější. |
| R3 | Navržený index `(status, next_attempt_at) WHERE status IN (...)` neodpovídá claim dotazu | **Vyřešeno.** Kontraktní `idx_messages__claimable` je správně. |
| R4 | Hlavní specifikace i zadání se ptají na `SendRawEmail`, ta ale v SES API v2 neexistuje | **Trvá.** V API v2 se raw posílá jako `SendEmail` s obsahem typu `Raw`. Volba raw obsahu je zdůvodněná v 3.9.1. |
| R5 | Sender má podle hlavní specifikace práva jen na `messages`, `campaigns` a `sending_providers`, ale má přepisovat odkazy | **Vyřešeno.** Kontrakt přidává `workspaces`, `campaign_links` a `message_events` a část 1 to sama uvádí jako svůj rozpor R4. |
| R6 | `campaigns` nemá sloupec pro verzi zkompilované šablony, sender nemá jak invalidovat cache | **Trvá.** Není v kontraktu ani v části 1. Viz P4a.2. |
| R7 | Hlavní specifikace uvádí PostgreSQL 17 | **Vyřešeno.** Část 1 navrhuje 18 kvůli `uuidv7()` a zdůvodňuje to. Senderu to vyhovuje. |
| R8 | Hlavní specifikace neřeší testovací odeslání v outboxu | **Trvá.** Viz K9. |

## 12. Otevřené otázky

Otázky, které nedokážu rozhodnout sám. Otázky vzniklé z rozporů s kontrakty jsou v 11.1 a nejsou tady zdvojené.

| # | Otázka | Kdo rozhoduje | Moje doporučení |
|---|---|---|---|
| ~~O1~~ | **ROZHODNUTO.** Výchozí `AMBIGUOUS_DISPATCH_POLICY` je **`fail` pro SES a `retry` pro SMTP**. Zdůvodnění opřené o deterministický `Message-ID` je vyhozené, protože na SES neplatí (K3). |
| O2 | Je přijatelné, aby se nástroj u dvou providerů choval v tomhle bodě různě? Alternativa je jedno chování pro oba a horší výsledek u jednoho z nich. | Produkt | Různě. Uživatel to uvidí jen jako jednu větu v nastavení providera. |
| O3 | Má existovat "okamžité zastavení" kampaně, které zahodí rozpracovanou dávku? | Produkt | Ne v MVP 0. Přidalo by stav, který je nutně nejistý, a řeší problém, který skoro nikdo nemá. |
| O4 | Je 5 % z prvních 1 000 zpráv správná hranice pro zastavení kampaně kvůli chybám renderu? | Produkt | Ano, přebírám z kontraktu. Znamená to, že v nejhorším případě odejde padesát vadných mailů. Nižší práh by reagoval na náhodný shluk. |
| O5 | Je `*liquid.Template.Render` z `osteele/liquid` bezpečné volat souběžně? | Ověřit čtením zdrojáku a testem s `-race` | Do ověření držet jednu sadu šablon per worker, což je bezpečné v obou případech. Při 32 workerech je to paměťově zanedbatelné. |
| O6 | **Jaká je skutečná doba parsování a interpolace šablony o 100 kB?** Kontrakt 5 vynutil náhradu značek před parsováním, takže se **parsuje na každou zprávu**, ne jednou na kampaň (rozbor v 3.7.1). | Benchmark, **první, který se v senderu napíše** | Odhad: parsování 0,2 až 1 ms, interpolace 30 až 150 µs. Při 50 zprávách za sekundu to je 1 až 5 procent jádra, tedy zanedbatelné. Je to ale odhad, ne měření, a kdyby byl špatný, náhradní cesta (značka jako Liquid proměnná) je popsaná v 3.7.1. |
| O7 | **Má sender podepisovat DKIM sám?** Dnes to nechává na provideru. | Doručitelnost, tedy 4a | Ne. Znamenalo by to držet privátní klíč v procesu, který jinak nemá k ničemu citlivému přístup, a zahodit tím půlku bezpečnostního přínosu oddělení. Rozhodnutí ale závisí na ověření P4a.18: pokud SES nepodepisuje `List-Unsubscribe`, jiná cesta nemusí být. |
| O8 | Má se posílat `Precedence: bulk`? Není to standardizovaná hlavička. | Doručitelnost, tedy 4a | Ano, výchozí zapnuto, konfigurovatelné. Potlačuje automatické odpovědi typu "jsem na dovolené", které by jinak plnily bounce mailbox. |
| O9 | Chceme podporovat SMTP servery bez `STARTTLS`? | Produkt a bezpečnost | Podporovat jen s výslovným `encryption: none` a nikdy neposílat heslo. Návrh je v 3.10.2. |
| O10 | Má sender exportovat metriku s `campaign_id` jako popiskem? Bylo by to užitečné, ale kardinalita je neomezená. | Provoz | Ne. Průběh kampaně je vidět v aplikaci, která na to má databázi. |
| O11 | **Umí `wneessen/go-mail` sestavit MIME do bufferu s libovolnými hlavičkami a injektovatelným boundary?** | Ověřit prototypem v první hodině implementace | Když ne, sestavit MIME vlastním kódem nad `mime/quotedprintable` a `net/textproto` a `go-mail` použít jen jako SMTP klienta. Struktura zprávy je jednoduchá, jsou to dvě části bez příloh. |
| O12 | **Co když `osteele/liquid` přestane být udržovaný?** Je to nejmenší závislost v seznamu (355 hvězd, jeden autor). | Technické, není akutní | Rozhraní `Renderer` plus subset o pěti filtrech a třech tazích znamená, že náhrada je práce na den. Reálnou náhradou je vlastní interpret nad naším subsetem, protože ostatní Go implementace Liquidu jsou menší nebo opuštěné. |
| O13 | **Podepisuje SES do `h=` tagu i `List-Unsubscribe` a `List-Unsubscribe-Post`?** RFC 8058 to vyžaduje, jinak Gmail tlačítko na odhlášení nenabídne. | 4a, ověření na jedné odeslané zprávě | Musí se ověřit před hackathonem. Je to test za pět minut a jeho negativní výsledek by změnil bezpečnostní model (viz O7). |
| O14 | Rozlišuje SES překročení sekundové a denní kvóty různými typy chyb? Předpokládám `TooManyRequestsException` a `LimitExceededException`. | Ověřit v sandboxu | Kdyby to tak nebylo, sender by denní kvótu považoval za throttling, donekonečna zpomaloval a kampaň by nikdy nepozastavil. |
| O15 | **Má být `SENDER_ID` stabilní přes restart?** Výchozí hodnota z části 1 obsahuje PID, takže není. | Část 1 | Ano, hostname bez PID, s PID jen při `MODE=all`. Umožní to okamžitou obnovu po restartu místo čekání 5 minut. Rozbor v K14. |

---

## 13. Sladění s částí 1

Část 1 byla dopsána po prvním konceptu téhle části. Tahle kapitola je záznam o tom, co jsem ověřil, co jsem převzal a co jsem změnil. Původní kapitola "Předpoklady o konvencích z části 1" je tím nahrazená, protože předpoklady už nejsou potřeba.

### 13.1 Co jsem ověřil numericky

Kontrakty 3 a 4 jsem **přepočítal nezávislou implementací** a porovnal s uvedenými vektory. Nejde o čtení, jde o reprodukci.

| Co | Výsledek |
|---|---|
| `MASTER` z `SECRET_KEY = AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8` | 32 B, `000102...1e1f`, sedí |
| `K_tracking-token` | `4a60b23f5ad33af512e8a70f9f09b43a37ef1909894df07295067f24d05bf6ca`, **sedí** |
| `K_credential-encryption` | `99d7e191906061a6b21d63fb792449c93ca147dc7324862c2963b0b6c70bdc6f`, **sedí** |
| `K_secret-key-fingerprint` | `2ca5cdfbdd8380aa5d9f621d6aec612d6e24035ba100a07ead8c776289532481`, **sedí** |
| open token, plné HMAC | `cc1d94f6...cc2eb0c`, **sedí** |
| open token, celý řetězec | `t1bwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2Bxgmpk8EDMHZT2j0CerDYAWCif7x3s`, **sedí bajt na bajt** |
| délky tokenů všech čtyř typů | 74, 96, 106, 117 znaků, **sedí**; všechny se dekódují, první bajt je `o`/`c`/`i`/`u`, druhý `0x01` |
| obálka credentials | 131 B, **sedí** |
| `header hex`, `aad hex`, `ciphertext hex`, `tag hex` | všechny **sedí** proti dekódovanému `stored` |
| délka plaintextu = délka ciphertextu | 84 B = 84 B, **sedí** (GCM nemá padding) |

**Závěr: kontrakty 3 a 4 jsou v Go implementovatelné přesně tak, jak jsou napsané, a testovací vektory jsou úplné a jednoznačné.** Z uvedených údajů jde napsat Go test bez jediného dohadu. Je to nejlépe zpracovaná část kontraktů.

Poznámky k Go implementaci, které nejsou překážkou, jen je dobré je vědět:

- `crypto/hkdf` je ve standardní knihovně od Go 1.24. Signatura `hkdf.Key(sha256.New, secret []byte, salt []byte, info string, keyLength int) ([]byte, error)` odpovídá pořadí argumentů v kontraktu. `info` je `string`, ne `[]byte`, což je jediná drobnost proti Node `crypto.hkdfSync`.
- AES-256-GCM je `crypto/aes` plus `crypto/cipher.NewGCM`. AAD se předává jako pátý argument `Open(dst, nonce, ciphertext, additionalData)`. Tag je v Go součástí `ciphertext`, ne samostatný argument, takže se z obálky předává `ciphertext || tag` v jednom kuse.
- Base64url bez paddingu je `base64.RawURLEncoding`, base64 standardní s paddingem je `base64.StdEncoding`. Kontrakt používá obojí a rozlišuje to správně.
- Porovnání MAC v konstantním čase je `hmac.Equal`, přesně jak kontrakt uvádí.
- `uuid.UUID.Bytes()` z `github.com/google/uuid` vrací 16 bajtů v síťovém pořadí podle RFC 9562, tedy přesně to, co kontrakt požaduje.

### 13.2 Co jsem převzal beze změny

| Oblast | Odkud |
|---|---|
| Konvence pojmenování tabulek, indexů a constraintů (`idx_`, `uq_`, `ck_`) | 2.1 |
| `text` + `CHECK` místo nativního enumu | 2.1 |
| UUIDv7 jako primární klíč, `uuid.NewV7()` v Go | 2.1 |
| `timestamptz` všude, databáze v UTC, `updated_at` nastavuje aplikace explicitně bez triggeru | 2.1 |
| `PARTITION BY RANGE (created_at)`, `PRIMARY KEY (id, created_at)`, měsíční okna, žádná `DEFAULT` partition | 2.1 |
| Kontraktní sloupce `messages` včetně `claim_expires_at`, `error_code`, `error_detail` | 4.10.1 |
| Stavy `pending`, `claimed`, `sent`, `failed`, `skipped` a jejich přechody | 4.10.1 |
| Mechanismus nejednoznačného odeslání pod názvem `ambiguous_dispatch` | 4.10.1 |
| Databázová role `openengage_sender` a její granty | 4.10.1, 3.12 |
| Vlastní filtry na obou stranách místo vestavěných | 4.10.2 |
| Automatické escapování v HTML kontextu, `escape` jako no-op | 4.10.2 |
| Whitelist pěti formátů filtru `date` | 4.10.2 |
| Binární formát tokenů, typy `o`, `c`, `i`, `u`, `key_id`, zkrácení MAC na 16 B | 4.10.3 |
| Obálka `enc:v1:` s kontextem a `workspace_id` v AAD | 4.10.4 |
| Odvození klíčů `HKDF(SHA-256, MASTER, "openengage/v1", <purpose>, 32)` | 3.10 |
| Konfigurační proměnné a jejich názvy | 4.9 |
| `SHUTDOWN_GRACE_SECONDS` 25 s, `stop_grace_period: 40s` | 3.12 |
| Health endpointy na `HEALTH_PORT`, `/healthz` a `/readyz` | 3.12 |
| PostgreSQL 18 místo 17 | 2.1 |

### 13.3 Co jsem ve svém dokumentu změnil

| Bylo v konceptu | Je teď | Důvod |
|---|---|---|
| `error jsonb` | `error_code text` + `error_detail text` | kontraktní sloupce |
| stav `indeterminate` | `error_code = 'ambiguous_dispatch'` nad stavy `pending` a `failed` | kontrakt řeší totéž bez šestého stavu |
| `claimed_at` jako vstup reaperu | `claim_expires_at` | kontrakt |
| vlastní názvy indexů `messages_*_idx` | `idx_messages__*` | konvence 2.1 |
| sloupcové `GRANT UPDATE` na `messages` | plné `GRANT SELECT, UPDATE` | kontrakt; zpřísnění navrhuji v 11.1 K18 |
| `APP_URL` jako základ trackovacích odkazů | `TRACKING_DOMAIN` | 4.9, s výhradou K7 |
| vlastní názvy `SENDER_CLAIM_TIMEOUT` a spol. | `SENDER_CLAIM_TTL_SECONDS`, `SENDER_POLL_INTERVAL_MS`, `SHUTDOWN_GRACE_SECONDS` | 4.9 |
| `SENDER_CONCURRENCY` výchozí 8 | výchozí 32 | 4.9 |
| vlastní návrh šifrovací obálky | kontraktní obálka `enc:v1:` | 4.10.4 |
| vlastní návrh formátu tokenů | kontraktní formát `t1` | 4.10.3 |
| sender nezapisuje do `message_events` | sender **zapisuje** `render_warning` | grant v 4.10.1 a politika v 4.10.2 |
| Liquid: pět vestavěných filtrů | pět **vlastních** filtrů registrovaných na obou stranách | 4.10.2 |
| `unsubscribe_url` a `webview_url` v `render_data` | sender si je **staví sám** z tokenu typu `u` | dohoda s 4a, ušetří přes 100 MB u milionové kampaně |
| `compiled_revision` s TTL cache 15 min | `campaigns.revision`, cache **bez TTL** | dohoda s 4a, cache nemůže zastarat |
| `max_send_rate` z dešifrované obálky | sloupec `sending_providers.quota_max_send_rate`, obálka jen jako fallback | dohoda s 4a, kvóta se mění bez přešifrovávání |
| chybové kódy s prefixem `ses_` | provider neutrální (`account_suspended`, `sending_paused`, `mail_from_not_verified`, `rate_limited`) | 4a je překládá do UI a stejné kategorie má i SMTP |
| `golang.org/x/crypto/hkdf` | **`crypto/hkdf` ze standardní knihovny** | část 1, stavíme na Go 1.26 |
| `fillfactor` na rodičovské tabulce | na **každé partition zvlášť** | úložné parametry na partitionované tabulce nejdou |
| krátká dávka jako důsledek chování `SKIP LOCKED` | krátká dávka jako **normální stav** (outbox dochází, jiný sender si vzal zbytek) | korekce od orchestrátora, `WITH TIES` je navíc zakázané |
| doporučení vyřadit filtr `date` | přijímám whitelist pěti formátů | 4.10.2 řeší problém lépe, viz 13.4 |

### 13.4 Proč je kontraktní řešení Liquidu lepší než moje původní

Můj koncept doporučoval filtr `date` vyřadit, protože `osteele/liquid` a LiquidJS mají různé výchozí formáty, různé implementace strftime a různé přijímané vstupy.

Kontrakt 4.10.2 volí jiné a lepší řešení: **nepoužívá se ani jeden vestavěný filtr, obě strany registrují vlastních pět.** Tím většina rozdílů, které jsem našel průzkumem, přestává existovat, protože se přestává používat kód, ve kterém ty rozdíly byly.

Konkrétně tím padají tyto nálezy z mého původního průzkumu:

| Původní nález | Stav po kontraktu |
|---|---|
| L1: `osteele/liquid` neumí pojmenované parametry filtrů | **Neaktuální.** Gramatika 4.10.2 pojmenované parametry nepřipouští. |
| L2: různý výchozí formát `date` | **Neaktuální.** Vlastní filtr, formát je povinný argument z whitelistu. |
| L3: různá implementace strftime | **Neaktuální.** Pět formátů se implementuje jako `switch` nad pěti konstantami, ne obecným strftime. Balíček `osteele/tuesday` není potřeba. |
| L4: `osteele/liquid` nepřijímá číselný timestamp | **Neaktuální.** Vlastní filtr, přijímané vstupy určuje kontrakt (RFC 3339, unix sekundy, `"now"`). |
| L5: ani jedna implementace neumí české měsíce | **Vyřešeno.** Whitelist slovní názvy neobsahuje a kontrakt to zdůvodňuje. |
| L6: `ß` se v Go a v JS chová u `upcase` jinak | **Trvá.** Vlastní filtr to neřeší sám od sebe, definice "simple uppercase mapping" ano, ale Go `strings.ToUpper` a JS `toUpperCase` se u `ß` liší. Viz K19. |
| L7: `escape` escapuje v obou stejně | **Neaktuální jinak.** `escape` je no-op, escapuje se automaticky, a to naším vlastním replacerem. Viz K11. |
| L8: truthiness se shoduje | **Potvrzeno kontraktem** (pravidlo 2 v 4.10.2) a ověřeno v README `osteele/liquid`: falešné jsou jen `false` a `nil`. |
| L9: `default` se spouští na stejné množině | **Neaktuální.** Vlastní filtr s definicí v kontraktu. |
| L10: `LaxFilters()` | **Trvá jako implementační pokyn:** nezapínat. |
| L11: `EnableJekyllExtensions()` | **Trvá jako implementační pokyn:** nezapínat. |
| L12: `Drop` se chová jinak než v Shopify | **Neaktuální.** Do bindings jde jen `map[string]any` z `render_data`. |

Zbývající riziko dialektů se tím smrskává na tři věci, které kontrakt neřeší a které popisuji v 11.1: chybějící literály `blank` a `empty` (K4), tichý filtr `safe` (K11) a `ß` u `upcase` (K19).

### 13.5 Implementační poznámky k Liquidu v Go

Ověřeno čtením zdrojového kódu `osteele/liquid` v1.8.1, ne z paměti.

| Potřeba z kontraktu | Jak se to v Go udělá |
|---|---|
| Vlastní filtry místo vestavěných | `engine.RegisterFilter(name, fn)`. **Ověřeno ve zdrojáku:** `expressions/filters.go` má `c.filters` jako `map[string]interface{}` a `AddFilter` dělá prosté `c.filters[name] = fn`. Registrace pod existujícím jménem tedy vestavěný filtr **přepíše**. Přesto na to patří test, protože je to nosný předpoklad kontraktu. |
| Automatické escapování v HTML kontextu | `engine.SetAutoEscapeReplacer(r)` existuje. Předáme **vlastní** `Replacer` s přesně pěti náhradami z kontraktu, ne vestavěný `render.HtmlEscaper`, protože ten používá Go `html.EscapeString`, který dává `&#34;` místo `&quot;`. |
| Dva kontexty (HTML a text) | Dva engine instance: jeden s replacerem, druhý bez. Ne jeden engine přepínaný za běhu. |
| Chybějící proměnná jako prázdný řetězec | `StrictVariables()` **nevolat**. Výchozí chování je přesně to, co kontrakt chce. |
| Limit doby renderu 50 ms | `engine.ParseAndFRender(w, ...)` s vlastním `io.Writer`, který kontroluje deadline a počet zapsaných bajtů a vrací chybu. README to uvádí jako doporučený postup pro nedůvěryhodné šablony. |
| Limit 200 iterací v `for` | Nejde vynutit v knihovně. Řeší se **oříznutím polí v `render_data` před renderem**: sender projde `render_data` a každé pole delší než 200 zkrátí. Deterministické a shodné s TypeScriptem, pokud to dělá stejně. Viz K15. |
| `_context.timezone` ve filtru `date` | Filtr v `osteele/liquid` dostane jen svoje argumenty, ne bindings. Řeší se **cache engine per časová zóna**; zóna je konstantní v rámci kampaně, takže vzniká jeden engine na kampaň. Viz K10. |
| **Typ vstupu filtru `date`** | **Signatura musí být `func(in any, format string) (string, error)`, nikdy `func(t time.Time, ...)`.** Vestavěný filtr v `osteele/liquid` má `func(t time.Time, format func(string) string)` a knihovna si vstup převede sama. Náš vlastní filtr tuhle konverzi **nedostane**: `render_data` se dekóduje z `jsonb`, takže hodnota dorazí jako `string` (RFC 3339), `json.Number` nebo `nil`. Kdo by opsal signaturu z vestavěného filtru, dostane za běhu chybu na každé zprávě. Rozepsáno v 3.6.2. |
| Konfigurace odpovídající LiquidJS | `jsTruthy: false` odpovídá výchozímu chování Go (falešné jsou jen `false` a `nil`), nic se nevolá. `strictFilters: true` odpovídá výchozímu chování Go, kde neznámý filtr vrací `UndefinedFilter` (`expressions/filters.go`); stačí **nevolat** `LaxFilters()`. `strictVariables: false` odpovídá výchozímu chování Go; stačí **nevolat** `StrictVariables()`. Go strana tedy nepotřebuje žádné explicitní nastavení, jen se musí zdržet tří volání. |
| Pořadí registrace `safe` | `engine.RegisterFilter("safe", ...)` **před** `engine.SetAutoEscapeReplacer(...)`. Obrácené pořadí tiše otevře díru v escapování, viz K11. |
| Parsování jednou na kampaň | `engine.ParseTemplate` vrací `*Template`, `Render` se volá opakovaně. Souběžná bezpečnost `Render` není dokumentovaná, proto jedna sada šablon **per worker**, ne per kampaň. |
| Čísla z `render_data` | `jsonb` dekódovat s `decoder.UseNumber()`, jinak se velká celá čísla ztratí v `float64` a pravidlo 6 z 4.10.2 přestane platit. Viz K20. |
