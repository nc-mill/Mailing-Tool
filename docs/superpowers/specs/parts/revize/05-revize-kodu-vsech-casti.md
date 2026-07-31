# Revize 5: soulad kusů kódu s textem napříč všemi sedmi částmi

Vlastník: hlavní agent (orchestrátor)
Datum: 2026-07-31
Předmět revize: všech sedm částí v `parts/`, hlavní specifikace, `ROZHODNUTI-PRO-ZADAVATELE.md`
Zadání zadavatele: ověřit, že jednotlivé snippety kódu odpovídají tomu, co popisujeme textově, a že kusy kódu nebrání v rozvoji a rozsahu toho, co slibujeme
Stav: **žádná oprava neprovedena**, dokument je podklad k rozhodnutí

---

## 0. Metoda a co je čím ověřené

Na každou ze sedmi částí byli puštěni tři agenti (model fable) se třemi různými optikami, celkem 21 agentů paralelně:

| Optika | Co hledala |
|---|---|
| **Implementátor** | Proběhne ten kód vůbec? Existují tabulky, sloupce a funkce, na které odkazuje? Sedí na PostgreSQL 18, na skutečné API knihoven, na souběh? |
| **Soulad textu a kódu** | Dělá snippet přesně to, co o něm tvrdí odstavec nad ním? Sedí konstanty, prahy, chybové kódy, enum hodnoty? |
| **Rozvoj a rozsah** | Zavírá snippet dveře, které text nechává otevřené? Uzavřený enum, natvrdo zadaný limit, zabetonovaný implementační detail tam, kde stačil kontrakt? |

Značky spolehlivosti, ve stejném duchu jako revize 1:

| Značka | Zdroj | Spolehlivost |
|---|---|---|
| **[OVĚŘENO]** | Vlastní grep nebo čtení orchestrátorem | Ověřeno včetně čísla řádku |
| **[SHODA n×]** | Nález, na kterém se nezávisle shodlo n různých agentů | Vysoká. Nezávislé optiky nad různými soubory nemají jak se domluvit |
| **[AGENT]** | Jeden agent, doložený číslem řádku | Sekundární. Před opravou ověřit grepem, viz poznámka k metodě v `STAV.md` |
| **[PŘEPOČÍTÁNO]** | Agent hodnotu přepočítal skriptem, ne přečetl | Ověřeno strojově |

**Poznámka k důvěryhodnosti.** `STAV.md` dokumentuje, že výstup subagenta se tady už jednou ukázal jako nespolehlivý. Nálezy označené **[AGENT]** proto před opravou ověřte grepem ve skutečném souboru. Nálezy **[SHODA]** a **[OVĚŘENO]** považuju za doložené.

---

## 1. Shrnutí

**Kód nás v rozvoji svazuje méně, než se čekalo, ale rozešel se s textem více, než je zdrávo.** To je horší problém, protože se projeví dřív a levněji se opravuje teď než po první migraci.

Specifikace je na svůj rozsah nezvykle disciplinovaná. Napříč všemi částmi platí: enumy jako `text + CHECK` místo nativních typů, verzování ve všech čtyřech kontraktech, provozní limity v konfiguraci s rozsahy, registry místo pevných výčtů, licenční brána bez jediné propuštěné copyleft závislosti. Kryptografické testovací vektory kontraktů 4.10.3 a 4.10.4 dva agenti nezávisle **[PŘEPOČÍTALI]** skriptem a sedí bajt na bajt, včetně deklarovaných délek 74/96/106/117.

Skutečných míst, kde kód zavírá dveře, je osm a většina z nich se opraví jednou větou nebo jedním nullable sloupcem.

Zato se dokumenty rozešly samy se sebou. Části prošly změnami kontraktu a rozhodnutími zadavatele, ale zanesly je většinou jen do prózy, ne do snippetů. Implementátor, který zkopíruje SQL, dostane jiné chování, než co slibuje odstavec nad ním.

| Kategorie | Počet | Kdy to bolí |
|---|---|---|
| A. Kolize ve zmrazeném kontraktu 4.10 | 8 | Hned. TS a Go strana se nepotkají |
| B. Kód, který neproběhne | 14 | První migrace, první běh jobu |
| C. Kde kód svazuje rozvoj | 8 + drobné | MVP 1 a MVP 2 |
| D. Nezanesená rozhodnutí a zastaralé odkazy | 11 | Průběžně, vyrábí duplicitní práci |
| E. Akceptační kritéria proti vlastní normě | 7 | Při psaní testů, jako falešně červené |
| F. Chybové kódy a názvosloví | 6 | Při psaní klientů a testů |

---

## 2. Kategorie A: kolize ve zmrazeném kontraktu 4.10

Nejnaléhavější, protože na kontraktu stojí to, že se obě strany potkají bez domlouvání. Kontrakt je zmrazený, takže tohle je **návrh na jedno kolo rozmrazení**, ne na provedení.

### A1. `campaigns.pause_reason` je současně `jsonb` i `text` **[SHODA 6×]**

| Kde | Co tam je |
|---|---|
| `01-platforma.md:3069` | KONTRAKT: typ `jsonb`, neprázdný objekt s klíčem `code` |
| `01-platforma.md:3078` | Uzavřený výčet: `render_failure_rate`, `credentials_undecryptable`, `provider_quota_exhausted`, `provider_unavailable` |
| `04a-kampane.md:418` | DDL: `pause_reason text` s výčtem `'user' | 'quota' | 'provider_blocked' | 'bounce_guard' | 'complaint_guard'` |
| `04a-kampane.md:1205` | SQL pauzy zapisuje `pause_reason = $reason` jako text |
| `04a-kampane.md:2198`, `2375` | TS union a webhook payload, plochý řetězec |
| `04b-sender.md:1620` | `jsonb_build_object('source','code','message','at')` |
| `04b-sender.md:1655` | Druhý snippet v téže kapitole: `source`, `code`, `detail`, `sender_id`, `at` |
| `04b-sender.md:1668` | Tvrdí, že sloupec v části 1 neexistuje |

Navíc: 4a používá hodnotu `materialize_timeout` (`04a:1036`), která není ani v jejím vlastním komentáři u DDL. 4b plní `code` kódy z katalogu 4.2 (`provider_auth_failed`, `contract_mismatch`), které kontraktní výčet nezná.

**Dopad:** CI job `contracts-schema` (kontrola typu v `information_schema.columns`, `01:3123`) spadne první den. Sender zapisuje jsonb do textového sloupce. UI části 4a nerozpozná kampaň pozastavenou senderem.

**Návrh:** sjednotit na `jsonb` podle kontraktu, aplikační důvody psát jako `{"code": "user"}`, sjednotit oba tvary objektu v 4b na jeden, a buď namapovat kódy circuit breakeru na kontraktní výčet, nebo výčet v kontraktu rozšířit. Doplnit `materialize_timeout`. Doplnit obsluhu senderových kódů včetně auditu a auto obnovení kvótové pauzy (`04a:1960` dnes obnovuje jen `pause_reason = 'quota'`).

### A2. Sender nemá grant na sloupec, který sám zapisuje **[SHODA 2×]**

- `01-platforma.md:2963` a `04b-sender.md:585`: reaper B běží **v senderu** a dělá `SET ambiguous_count = ambiguous_count + 1`
- `01-platforma.md:3042`: sloupcový `GRANT UPDATE` vyjmenovává `status, claimed_by, claimed_at, claim_expires_at, dispatch_started_at, attempts, next_attempt_at, provider_message_id, sent_at, error_code, error_detail, updated_at`. `ambiguous_count` v něm **není**
- `01-platforma.md:3153`: přikazuje pouštět všechny scénáře OB pod rolí `mlain_sender`

**Dopad:** pod správnou rolí skončí reaper B na permission denied. Celý mechanismus `ambiguous_dispatch` včetně scénářů OB-03 a OB-04 je nespustitelný. Návrh v `04b:351` sloupec správně má, ale do kontraktu se nedostal.

**Návrh:** doplnit `ambiguous_count` do sloupcového grantu na `01:3042`.

### A3. Otisk suppression je popsaný dvakrát neslučitelně **[SHODA 3×]**

| Kde | Co tam je |
|---|---|
| `01-platforma.md:1264` | `suppressions.fingerprint bytea` + `fingerprint_key_id smallint`, odvození HKDF purpose `mailer/v1/suppression-fingerprint`, **rotovatelné** |
| `01-platforma.md:1278` | `mlain doctor` dělá `SELECT DISTINCT fingerprint_key_id FROM suppressions` |
| `01-platforma.md:2545` | „Samostatná proměnná pro otisky suppression listu **neexistuje**" |
| `02-kontakty.md:621` | `email_hash bytea -- HMAC-SHA256(SUPPRESSION_HASH_KEY, ...)`, bez key_id |
| `02-kontakty.md:2244` | Kontrola porovnává jediný hash |
| `02-kontakty.md:3670` | Požadavek 1.4 žádá **nerotovatelnou** proměnnou `SUPPRESSION_HASH_KEY` |
| `01-platforma.md:3120` | Kontraktní podmnožina pro sender: „`email` (nebo otisk podle 3.10)", tedy disjunkce, kterou nelze implementovat |

Zadavatel přitom rozhodl ve prospěch verze části 1 (zrušení stropu, kontrola přes všechna pokolení). Část 2 na řádku 10 sama deklaruje, že kontrakty části 1 mají přednost.

**Dopad:** `mlain doctor` míří na sloupec, který v jediném existujícím DDL není. Go strana neví, který sloupec číst. Je to jádro ochrany proti vzkříšení vymazaného člověka.

**Návrh:** přepsat v části 2 sekce 3.1, 3.5, 4.10.3, 4.10.4, 4.14.4, 5.9, 7.2, požadavek 1.4 a bod C2 na model části 1. V kontraktu `01:3120` disjunkci nahradit konkrétními sloupci včetně `fingerprint_key_id`.

### A4. Zrušený strop pěti klíčů žije dál **[SHODA 2×]**

- `01-platforma.md:1268`: „Strop na počet pokolení neexistuje (KONTRAKT, ROZHODNUTO)... nesmí se vrátit, ani jako validace `SECRET_KEY_PREVIOUS`"
- `01-platforma.md:2490`: „bez horního počtu položek"
- `02-kontakty.md:164`: „`SECRET_KEY_PREVIOUS` až 5 klíčů"
- `04b-sender.md:1727`: „až 5 položek, jen pro dešifrování"

**Dopad:** Go validace podle 4b by odmítla legitimní keyring a obnovila přesně tu chybu, kterou zadavatel zakázal vracet. Spadl by i test `config-parity`.

**Poznámka:** `01-platforma.md:1306` k tomu přidává neřešený detail: `key_id` je 1 bajt, takže praktický strop je 255 rotací. Kontrakt tvrdí „strop neexistuje". Prakticky neškodí, ale mělo by být přiznané jako riziko s únikovou cestou přes `t2`/`v2`.

### A5. Claim dotaz bere jen `sending` **[SHODA 3×]**

- `01-platforma.md:2806` a `2840`: kontrakt má `c.status IN ('queueing','sending')` v obou krocích
- `04b-sender.md:462`: text slibuje „Odesílat jde už ve stavu `queueing`"
- `04b-sender.md:480`: snippet má `AND c.status = 'sending'`, navíc chybí `c.deleted_at IS NULL`
- `04b-sender.md:2274`: opravená verze v K23 to má správně
- `04a-kampane.md:2658` (AC 5) a `2899` (R4b.7): citují `c.status = 'sending'`, tedy podmínku, která v kontraktu není

**Dopad:** kampaň ve stavu `queueing` by neodeslala nic, přestože 4a na tom staví slib „první zprávy do sekund od kliknutí" (`04a:744`). Vedlejší díra: kampaň v `queueing` s rozbitými credentials nejde pozastavit, protože circuit breaker filtruje na `status = 'sending'` (`04b:1628`, `1665`), takže sender bude zprávy donekonečna recyklovat po pěti minutách.

### A6. Varianty D3 nekontrolují `claimed_by` **[AGENT, vysoká závažnost]**

- `01-platforma.md:2934`: „Kroky D1 i D3 musí ověřit, že řádek pořád patří tomuhle senderu (KONTRAKT)", plus povinná kontrola rowcountu s logem `claim_lost_after_dispatch`
- `04b-sender.md:657` až `688`: všechny čtyři varianty D3 mají jen `WHERE id = $1 AND created_at = $2 AND status = 'claimed'`

**Dopad:** je to jediný nález celé revize, který je opravdová chyba korektnosti, ne nesoulad dokumentů. Závod: senderu A se zpozdí heartbeat, reaper B zprávu po 2×TTL uvolní, claimne ji sender C a spustí D1. Probuzený A svým D3a bez `claimed_by` přepíše řádek, který drží C (status je opět `claimed`), zapíše `sent`, a C mezitím odešle podruhé. 04b navíc rowcount po D3 neřeší vůbec.

**Návrh:** doplnit `AND claimed_by = $3` do všech čtyř variant a do protokolu 3.4.1 přidat chování při nule řádků.

### A7. `AMBIGUOUS_DISPATCH_POLICY` má čtyři různé verze **[SHODA 5×]**

| Kde | Co tam je |
|---|---|
| `01-platforma.md:2551` a `2552` | Dvě env proměnné `_SES` (výchozí **`fail`**) a `_SMTP` (výchozí `retry`), sloupec Kdo = S |
| `01-platforma.md:2986` | Kontrakt mluví o jedné proměnné `AMBIGUOUS_DISPATCH_POLICY` |
| `04a-kampane.md:2455` | Jedna proměnná s výchozí **`retry`** a zdůvodněním, že `Message-ID` duplikát odchytí |
| `04a-kampane.md:3035` | Vlastní kapitola 11.13 přitom počítá s `fail` u SES |
| `04b-sender.md:1771` | „V seznamu není, protože ji vlastní část 4a" |
| `04b-sender.md:614` | „Sender čte hodnotu z konfigurace kampaně" |

**Dopad:** kdo implementuje konfiguraci podle 4a, nastaví na hlavním provideru politiku, která při pádu senderu vyrábí viditelné duplikáty. Zdůvodnění přes deterministický `Message-ID` je u SES vyvrácené nálezem K3 (SES `Message-ID` vždy přepisuje). Test `config-parity` spadne.

**Návrh:** sjednotit na dvojici `_SES` = `fail` a `_SMTP` = `retry` všude, včetně `04a:2033`, `01:2986`, P4-2 a O5. Do `04b` tabulky 4.1 obě proměnné doplnit, spolu s `SENDER_CREDENTIALS_MAX_RETRIES` (`01:2542`, Kdo = S), která tam také chybí.

### A8. Do uzavřeného registru `messages.error_code` zapisují tři části neregistrované hodnoty **[SHODA 3×]**

- `01-platforma.md:3175`: „hodnota mimo výčet je v CI chyba", registr je `packages/contracts/src/outbox-errors.ts`
- `01-platforma.md:3177` až `3189`: registr zná `suppressed`, `unsubscribed`, `campaign_cancelled`, `render_failed` a senderové kódy
- `02-kontakty.md:2175`: zapisuje `contact_deleted`, `contact_anonymized`, `processing_restricted`
- `04a-kampane.md:1063` a `1078`: zapisuje `contact_deleted`, `contact_status_changed`
- `01-platforma.md:3151` (OB-22): používá `render_failure`, v registru je `render_failed` **[SHODA 2×]**

Vedlejší nález: `04a:990` kvůli uzavřenosti výčtu hlásí překročení 8 kB `render_data` kódem `invalid_recipient`, tedy sémanticky lživě. Report si to vyloží jako vadnou adresu.

**Návrh:** buď pět chybějících kódů zaregistrovat (a doplnit do požadavků R1.x a 4.5), nebo dohodnout prefixované jmenné prostory (`app_*`, `sender_*`) s definovaným postupem přidání bez změny kontraktu. Zavést `render_data_too_large` místo recyklace `invalid_recipient`.

### A9. Další kontraktní drift v části 4b **[AGENT]**

Menší, ale ze stejné rodiny: 4b opisuje kontraktní SQL, které se mezitím změnilo.

| Kde | Co je špatně |
|---|---|
| `04b-sender.md:194` | „Kontraktní" index `idx_messages__claimable (next_attempt_at, id)`. Kontrakt (`01:2699`) má `(campaign_id, next_attempt_at, id)`, právě proto, aby pozastavená kampaň nedusila claim ostatních. Scénář OB-12 by spadl |
| `04b-sender.md:561` | Heartbeat přes `claimed_by`, kontrakt (`01:2891`) má dvousložkový `unnest($3::uuid[], $4::timestamptz[])` s větou „Heartbeat musí nést obě složky klíče" |
| `04b-sender.md:585` | Reaper B nenuluje `dispatch_started_at`; kontrakt (`01:2963`) ano. `$2` je uvedeno jako dvojnásobek TTL (600 s), kontrakt má jeden TTL navíc (300 s) |
| `04b-sender.md:312` až `332` | Migrace grantů je předsloupcová: `GRANT SELECT, UPDATE ON messages` na celou tabulku, chybí `campaigns` i `suppressions` |
| `04b-sender.md:268` | „Sender nikdy nečte `suppressions`", ale `04b:853` a `2445` popisují dávkovou kontrolu suppression po claimu a kontrakt grant má (`01:3056`) |
| `04b-sender.md:849` | Tabulka přechodů povoluje `pending → failed` při zrušení kampaně. Kontrakt má `pending → skipped` a scénář OB-14 testuje „žádný na failed" |
| `04b-sender.md:1373` | Message tagy `ml_msg`, `ml_camp`, `ml_ws`. 4a (`04a:1665`) čeká čtyři: `ml_msg`, **`ml_mday`**, `ml_campaign`, `ml_workspace`. Bez `ml_mday` nemá 4a jak zacílit partition při opravě `failed → sent` |
| `04b-sender.md:2225` | Kapitola 11.0 hlásí K23, K2, K8 a K12 jako NEOPRAVENÉ. V kontraktu jsou opravené (`01:2831`, `2982`, `2965`, `2887`) |
| `04b-sender.md:802` | Schválená změna 1 (`failed → sent`) je dál vedená jako návrh a s jinými podmínkami (message tag + okno 72 h) než zmrazené znění (`01:2774`: jen `error_code = 'ambiguous_dispatch'` a jen aplikace). Scénáře OB-21 a OB-22 se v 4b nevyskytují vůbec |

---

## 3. Kategorie B: kód, který neproběhne

Ne teoreticky. Tohle spadne při první migraci nebo prvním běhu jobu.

| # | Kde | Co se stane | Zdroj |
|---|---|---|---|
| B1 | `02-kontakty.md:1669` | `min(id)` nad `uuid`: PostgreSQL 18 ten agregát nemá (přidává se ve 20). Chyba 42883. Je to hlavní dotaz obrazovky „Kontrola oslovení" | **[AGENT]** |
| B2 | `02-kontakty.md:1864` | `ON CONFLICT DO UPDATE` nesmí zasáhnout tentýž řádek dvakrát v jednom příkazu. Chyba 21000. Nastane přesně u velkých importů, kde se paměťový dedup vypíná; job má `retryLimit = 0`, takže se import zasekne | **[AGENT]** |
| B3 | `04a-kampane.md:1101` | Reconcile `UPDATE m ... FROM s LEFT JOIN c ON c.id = m.contact_id`: cíl `UPDATE` nelze referencovat v `ON`. Je to doslova chyba, kvůli které vznikl scénář OB-00 (`01:2847`) | **[AGENT]** |
| B4 | `04a-kampane.md:578` | Unikátní index na partitionované tabulce bez partition key + navazující `ON CONFLICT (workspace_id, dedup_key)` na rodiči. Dokument to sám správně řeší u `uq_message_events__once_per_message` (`04a:1555`) | **[AGENT]** |
| B5 | `05-tracking.md:697` | `campaign_link_stats.link_id int`, ale `link_id` je UUID `campaign_links.id` (`05:754`, `1062`, kontrakt zkrácení na `position` výslovně zamítl). Report odkazů nepůjde postavit | **[SHODA 3×]** |
| B6 | `05-tracking.md:535` | `message_engagement.contact_id NOT NULL`, ale `05:2264` předepisuje při výmazu `contact_id -> NULL`. `erase_contact` spadne na prvním kontaktu, který kdy něco otevřel | **[SHODA 2×]** |
| B7 | `05-tracking.md:3052` | Navržené DDL `message_events` má `message_id` a `message_created_at` NOT NULL, ale `05:3096` předepisuje řádky `render_warning` s oběma NULL | **[SHODA 2×]** |
| B8 | `01-platforma.md:974` | RLS politika `ws_isolation` s `WITH CHECK (workspace_id = current_setting(...))` znemožňuje zápis globálních auditních řádků (`audit_log.workspace_id` je nullable, `01:521`). Spadne změna hesla i `user.login`, a to synchronně ve stejné transakci | **[SHODA 2×]** |
| B9 | `01-platforma.md:982` | Tentýž test: `workspaces` nemá sloupec `workspace_id` a není ve whitelistu (`01:974`), přesto `01:3103` předpokládá, že na ní RLS běží | **[AGENT]** |
| B10 | `01-platforma.md:1452` | `COPY packages/*/package.json ./packages/` zplošťuje strukturu, všech devět manifestů se přepíše do jednoho souboru. `pnpm install --frozen-lockfile` nenajde workspace a job `build-image` neprojde | **[AGENT]** |
| B11 | `01-platforma.md:1631` | Bind mount `./data/postgres:/var/lib/postgresql/data`, ale image `postgres:18` přesunul `PGDATA` na `/var/lib/postgresql/18/docker` a deklarovaný VOLUME je `/var/lib/postgresql`. Databáze se zapisuje do anonymního volume a po `docker compose down` je pryč. **Doporučuju ověřit proti aktuální dokumentaci image před opravou** | **[AGENT]** |
| B12 | `01-platforma.md:2497` | `HEALTH_PORT` má default 3001 pro worker i sender, `MODE=all` je spouští v jednom kontejneru se sdíleným prostředím. Druhý proces spadne na `EADDRINUSE` ve výchozí konfiguraci MVP 0 | **[AGENT]** |
| B13 | `01-platforma.md:1677` | Migrační runner se má připojit jako `mlain_migrator`, ale tabulka 4.9 definuje jen `DATABASE_URL` s poznámkou „role `mlain_app`". Chybí `DATABASE_URL_MIGRATOR` | **[AGENT]** |
| B14 | `01-platforma.md:1442` | `-X main.version=${APP_VERSION}` bez `ARG APP_VERSION` v Dockerfile: proměnná se rozvine na prázdný řetězec, `/api/health` nemá odkud číst verzi | **[SHODA 2×]** |
| B15 | `02-kontakty.md:1883` | Obnova importu čte `imports.updated_at`, který v DDL (`02:676` až `719`) neexistuje | **[AGENT]** |
| B16 | `02-kontakty.md:680` | `storage_key text NOT NULL` znemožňuje označit „soubor už smazán"; částečný index `WHERE storage_key IS NOT NULL` (`02:725`) tím nefiltruje nic a retenční job bude procházet tytéž řádky dokola | **[AGENT]** |
| B17 | `02-kontakty.md:2699` | Reaktivace zapisuje souhlas se zdrojem `reactivation`, který CHECK na `consents.source` (`02:567`) nepovoluje. Spadne při prvním kliknutí na „Ano, posílejte dál" | **[SHODA 3×]** |
| B18 | `02-kontakty.md:2581` | `jsonb_typeof(...) = 'number' AND (...)::numeric > $m`: PostgreSQL negarantuje pořadí vyhodnocení operandů `AND`, plánovač může cast provést i na řádku, kde typeof není number. Chyba 22P02 nedeterministicky podle plánu. Jistá je jen varianta přes `CASE` | **[AGENT]** |
| B19 | `03-obsah.md:159` | `templates.current_version_id REFERENCES template_versions(id)` odkazuje na tabulku založenou až o 28 řádků níž a tvoří cyklus. DDL spuštěné v pořadí, jak je v dokumentu, spadne | **[AGENT]** |
| B20 | `03-obsah.md:1894` | „Vestavěné filtry se neregistrují" a „test ověří, že instance nemá zaregistrovaný ani jeden filtr navíc": LiquidJS to neumí, konstruktor vestavěné filtry registruje vždy. Jediná cesta je přepsat je dummy funkcí. Ověřeno v oficiální dokumentaci přes context7. Stejné znění má `01:3212` | **[AGENT]** |

---

## 4. Kategorie C: kde kód svazuje rozvoj

Přímá odpověď na zadání zadavatele. Seřazeno podle ceny pozdější opravy.

### C1. Blokový model nemá kam uložit podmínky a cykly **[SHODA 3×]**

Editor je slibuje jako obálky bloků (`03:1527`), vlastnost „zobrazit, jen když je pole vyplněné" (`03:1441`), kontrakt počítá s hloubkou if 3 a pěti cykly (`03:1425`), `renderSchema.loops` (`03:1654`) s cykly počítá. V modelu ale žádný uzel ani vlastnost není: gramatika `03:461` až `470`, `InlineNode` zná jen `s`, `a`, `br`, `var` (`03:548`), společné vlastnosti bloku (`03:704`) nic.

Vlastní ukázka na `03:1662` používá `{% if contact.city != "" %}`, což je konstrukce, kterou tentýž dokument zakazuje třemi způsoby (řetězcový literál `03:1419`, operátor `03:1420`, `blank` `03:1435`).

**Dnes neexistuje žádný platný způsob, jak zapsat podmínku „pole není prázdné".** `!= ""` zakázané, `!= blank` odmítnuté, `>` blokované. Přitom `03:1427` nabízí uživateli opravu jedním kliknutím, která vyrobí právě `!= blank`.

**Návrh:** doplnit do modelu obalový uzel `{ t: "if", expr, children }` (a obdobu pro `for`), nebo společnou vlastnost bloku `visibleWhen`, včetně JSON Schema. Opravit příklad na `03:1662`. Urychlit rozhodnutí o K4, protože dočasný stav nemá pro autora žádnou schůdnou cestu.

### C2. Kampaň je zabetonovaná jako jednorázová dávka **[SHODA 2×]**

| Kde | Co fixuje |
|---|---|
| `04a:486` | Invariant I1: všechny řádky mají `created_at = campaigns.audience_built_at`, které se „nikdy nemění" |
| `04a:379` | `subject`, `preheader`, `design`, `compiled_html`, `compiled_text` jsou skalární sloupce přímo v `campaigns` |
| `04a:1375` | Cache senderu je `(campaign_id, revision)` |
| `04b:149` | `outbox.campaign_id uuid NOT NULL` |
| `04b:474` | Claim povinně joinuje `campaigns` a filtruje `c.status = 'sending'` |
| `04b:1265` | `Feedback-ID` má natvrdo pole `campaign` |
| `04a:2068` | Testovací zpráva se pozná podle magického klíče `render_data['_test']` |

Hlavní specifikace přitom slibuje A/B testování předmětu a obsahu (MVP 1), transakční e-maily přes API (MVP 1) a automation engine (MVP 2). Slovo „A/B" v části 4a nepadne ani jednou. `04b:50` sám označuje transakční maily za existenční („firma nemůže poslat žádný mail, včetně potvrzení objednávky").

**Návrh:** nedělat to teď, ale zapsat cestu. Tři věty: `campaign_id` je nullable rezerva pro nekampáňové zprávy (stejný vzor, jaký K9 navrhuje pro `contact_id`); varianty obsahu se v budoucnu přesunou do tabulky variant a `messages` dostane nullable `variant_id`; invariant I1 je vlastnost jednoho materializačního běhu, ne tabulky `messages` obecně. Poslední bod je naléhavý, protože R1.11 (`04a:2849`) žádá zapsat I1 do zmrazeného kontraktu, čímž se z lokálního rozhodnutí stane celoproduktové pravidlo.

Místo magického `_test` požádat část 1 o `messages.kind` v kontraktu.

### C3. Uzavřené JSON Schema popírá slíbené chování neznámých bloků **[AGENT]**

`03:592` má `additionalProperties: false`, `blocks` jako striktní `oneOf` uzavřených definic (`03:634`) a ajv se `strict: true` (`03:647`). `03:677` přitom slibuje, že neznámý blok (pluginy, MVP 3) se převede na `{ type: "unknown", raw }` a zapíše zpět beze změny; akceptační kritérium 5 (`03:3395`) na tom trvá bajtově.

Neznámý blok se k převodu nikdy nedostane, server ho odmítne 422. Kritérium 5 je nesplnitelné.

### C4. Sedmidenní okno v části 5 vylučuje historický import **[AGENT]**

`05:297`: `ck_web_events__lag` vynucuje `occurred_at > received_at - 7 dní`. Na témže předpokladu stojí prořezávání partition (`05:365`), `web_event_months` plněné podle `received_at` (`05:425`) i aplikační deduplikace (`05:328`).

Sloupec `source` přitom sám deklaruje hodnotu `'import'` (`05:284`) a část vlastní ingestion API pro serverové události (`05:165`). Migrace historie od Ecomailu nebo Klaviya je nejpravděpodobnější onboarding scénář.

**Návrh:** definovat importní cestu teď (import smí nastavit `received_at := occurred_at` do existujících partition, nebo se hranice vztahuje jen na `source = 'web'`) a zapsat ji do 2.2 a 3.12.2.

### C5. Konverze a tržby nemají v agregacích místo **[AGENT]**

Úvodní příběh části 5 končí „přidala do košíku (1 490 Kč)" (`05:27`) a propojení kampaně s nákupem je deklarovaný diferenciátor. `campaign_stats` (`05:643`), `campaign_stats_buckets` (`05:679`) i API typ `CampaignStatsResponse` (`05:2376`) mají pevné sloupce jen pro e-mailové metriky a žádnou naznačenou cestu, na rozdíl od shardovaných čítačů, které cestu popsanou mají.

**Návrh:** nedělat to teď, ale zapsat atribuční pravidlo a rozšiřující tabulku `campaign_conversion_stats`, aby budoucí přidání nesahalo na zmrazené tvary.

### C6. Dvojice SES a SMTP je zadrátovaná na čtyřech úrovních **[AGENT]**

| Kde | Co |
|---|---|
| `04b:806` | Navrhované kontraktní znění váže výjimku `failed → sent` na SES message tag `ml_msg`. Postmark, Mailgun i SendGrid mají tutéž schopnost přes vlastní metadata, ale podle doslovného znění by nesměly nejisté zprávy opravovat |
| `04b:417` | Sdílená struktura `OutgoingMessage` má pole `Tags` a `ConfigSet` s komentářem „jen SES"; `Name()` fixuje výčet `"ses" nebo "smtp"` |
| `04b:1807` | Katalog chybových kódů má `ses_configuration_set_missing` a `ses_daily_quota_exceeded`, přestože denní kvótu má i Postmark a Mailgun |
| `04b:990` | Limit MIME zprávy 9 MiB „konzervativně pod limitem SES", bez konfigurace. Mailgun má 25 MB, SendGrid 30 MB |
| `04a:264` | `CHECK (type IN ('ses','smtp'))` plus SES-tvarované sloupce `enforcement_status`, `production_access` přímo v tabulce providerů |

Hlavní specifikace slibuje v MVP 2 „vlastní sending providery" přes plugin systém.

**Návrh:** přeformulovat kontraktní podmínku providerově neutrálně („událost providera, která jednoznačně nese `messages.id` v metadatech"), `ml_msg` uvést jen jako SES realizaci; providerově specifická metadata schovat za neprůhledné pole; přejmenovat konceptově obecné kódy na neutrální; z 9 MiB udělat default konfigurovatelného `max_message_size`.

### C7. Hlavní navigace je uzavřená na šest položek jako princip **[AGENT]**

`06:35` („šest hlavních míst a nic víc. To je vědomé"), `06:333`, `06:378` (zakazuje i záchytné kategorie). R7 (`06:4740`) navíc tlačí část 1, aby z osmi položek slevila na šest.

Automatizace z MVP 2 nemají kde bydlet; jediná stopa v celém UI je filtr časové osy „Automatizace (MVP 2)" (`06:3053`). Přidání sedmé položky se stane sporem o principy, ne o pixel.

Navíc mapa aplikace (`06:336`) nezná tři obrazovky, na které sám dokument odkazuje: nastavení AI klíče a útraty (`06:3871`, část 3 slibuje spotřebu za 30 dní v nastavení), nastavení sledování (`06:3062`, část 5 má `tracking_domains`), a Audit log (`06:1017` předpokládá, že existuje).

### C8. Dvojice `cs` a `en` je zabetonovaná až do kontraktu **[SHODA 2×]**

- `03:2804`: `CompileContext.language: "cs" | "en"` v kontraktu 5, který se „po odsouhlasení nemění, jen verzuje"
- `03:1628` a `02:2225`: `FieldCatalogEntry.label: { cs: string; en: string }`, přestože sloupec `contact_fields.label` je záměrně otevřený `jsonb` (`02:423`)
- `03:2084`, `2097`, `2109`: AI schémata `z.enum(["cs","en"])`
- `02:2755`: `FormField.label/placeholder/options.label` pevné dvoujazyčné objekty

Třetí jazyk (sk, de, pl) je nejpravděpodobnější první komunitní požadavek a `contacts.locale` s ním počítá (`02:241`). Dnes znamená změnu verzovaného kontraktu, změnu tvaru katalogu polí a zásah do všech AI schémat naráz.

**Návrh:** `language: string` (BCP 47) s dokumentovaným párem podporovaným v MVP 0, `label` jako `Record<string, string>` s povinným fallbackem `en`.

### C9. Drobnější, ale konkrétní

| Kde | Co |
|---|---|
| `01:2278` | Rate limity jsou pevná čísla; konfigurace má jen `RATE_LIMIT_ENABLED`, tedy vše nebo nic. Limit 6000/min na veřejný klíč je 100/s, ale `01:3900` slibuje 500 událostí za sekundu. Limit 120/min na klíč + IP jsou 2 události/s pro celou firmu za jedním NATem |
| `01:380`, `02:327` | Regex CHECK na `locale` pouští jen `xx` nebo `xx-XX`. `zh-Hant`, `sr-Latn`, `es-419` ani `fil` neprojdou, přestože `01:1229` slibuje nové jazyky bez změny kódu a `02:247` výslovně říká, že neznámý jazyk se uloží a řádek se neodmítá |
| `02:331` | `CHECK (pg_column_size(attributes) <= 65536)`, ale limity polí dovolují 100 polí a `long_text` do 10 000 znaků: sedm plných long_text legálně překročí. Navíc `pg_column_size` měří po kompresi, takže stejná data jednou projdou a jednou ne |
| `02:567`, `02:622`, `03:260`, `03:336`, `03:857`, `05:291`, `05:3063` | Uzavřené CHECK výčty tam, kde by stačila aplikační validace: zdroje souhlasu, důvody suppression (včetně provider-specifického `ses_suppressed`), varianty obrázků, AI provideři (Azure a Bedrock nejde vyjádřit), sociální sítě (chybí Bluesky, Mastodon), zdroje událostí, typy událostí |
| `02:858` | `captcha_provider IN ('none','turnstile','hcaptcha')`: obě povolené volby porušují hlavní pravidlo „nulová komunikace s cizím cloudem", a self-hosted alternativa (ALTCHA) by znamenala migraci |
| `03:498` | `Theme.colors` jako povinný `Record` všech deseti rolí. `03:657` přitom slibuje, že přidání hodnoty do výčtu nezvyšuje `schemaVersion`, což u povinného Recordu neplatí |
| `03:1113`, `03:1144` | Mobilní media query a tmavý režim mají natvrdo pixely a hexy, uvozené „Emitované značky:", tedy jako normu výstupu hlídanou golden snapshoty. `Theme.typography` přitom dovoluje `baseFontSize` 12 až 20 |
| `04a:2005` | Brzdy jsou env proměnné celé instalace; per projekt jde jen vypnout. Prahy varování (2 %, 4 %, 0,05 %, 0,1 %) nemají konfiguraci vůbec. `04a:1284` přitom slibuje undo okno „nastavitelné v projektu", zatímco `04a:2437` má tutéž proměnnou jako env instalace |
| `05:1380` | Payload nese `v: 1`, SDK existuje i jako npm balíček bundlovaný do webů zákazníků na roky, ale není řečeno, co server udělá s neznámým `v` ani jak dlouho `v: 1` platí |
| `05:1295` | `canonicalJson(traits)` v podpisu `identify` není nikde definovaný, přestože podpis vyrábí server zákazníka ve svém jazyce. Klasické místo rozchodu |
| `06:2143` | Věta segment builderu je česká konstrukce s vloženými ovládacími prvky a čtyři kombinace negace stojí na české jemnosti „nesplňují všechny". Vlastní pravidlo `06:4196` přitom zakazuje skládat věty z fragmentů |
| `06:458` | Klávesové zkratky `g k`, `g c`, `g s` dávají mnemotechnický smysl jen česky |
| napříč | Jméno produktu doslovně v HKDF saltu (`05:197`), MAC prefixu (`05:742`), DB rolích (`05:377`), prefixu API klíčů, `ml_token` a docker image, přestože `ROZHODNUTI:49` říká, že se mění a má být jedna konstanta. Změna jména je tedy zásah do zmrazených kontraktů 4.10.3 a 4.10.4 a přepočet vektorů **[OVĚŘENO]** |

### C10. Předetailní snippety, kde stačil kontrakt

Ne chyba, ale budoucí tření. Specifikace na těchto místech betonuje implementační detail, který se bude vyvíjet rychleji než dokument:

- `04b:371`: goroutinová topologie senderu včetně vzorce `MaxConns = SENDER_CONCURRENCY + 4`
- `04b:952`: interní API `osteele/liquid` povýšené na závaznou specifikaci včetně pořadí volání, přestože skutečným kontraktem jsou golden fixtures a `04b:2077` sám říká, že výměna se dotkne jednoho souboru
- `03:2152`: API povrch AI SDK v7 na úroveň názvů funkcí a verze `ai@7.0.44`, přičemž dokument sám přiznává, že ekosystém rotuje rychleji než on
- `02:587`: `CREATE RULE ... DO INSTEAD NOTHING`, které sám text o tři řádky níž nedoporučuje ve prospěch REVOKE
- `02:3735`: plné DDL cizí tabulky `contact_engagement` se zabetonovanými okny 7/30/90
- `06:1527`: klikací návody pro 13 konkrétních DNS poskytovatelů a seznam SMTP presetů
- `06:4385`: konkrétní balíčky s verzemi a týdenními staženími v kapitole, která má dodávat požadavky

---

## 5. Kategorie D: nezanesená rozhodnutí a zastaralé odkazy

### D1. Rozhodnutí zadavatele, která se nezanesla

| Rozhodnutí | Zaneseno | Kde zůstala stará hodnota |
|---|---|---|
| **Velikost dávky 100** (`ROZHODNUTI:224`) | nikde | `01:2523`, `04b:501`, `04b:526`, `04b:1731`, `04b:1953`, `06:782`. A `ROZHODNUTI:235` a `:237` si odporují samy se sebou o jedenáct řádků níž („dávky po pěti stech", „až 500 zpráv") **[OVĚŘENO]** |
| **Práh varování 4 %** (`STAV.md:49`) | jen v části 4a, tam konzistentně (`04a:1988`, `1999`, `2003`, `3077`) | `ROZHODNUTI:75` („varování od 2 %"), hlavní spec `:533` („bounce > 5 %"), `05:2591` („bounce > 5 %"), `04a:2953` („už při 2 % a 0,05 %") **[OVĚŘENO]** |
| **Editor vlastní, `@usewaypoint/email-builder` zamítnut** (`03:962`) | části 1 a 3 | `06:150` („Editor je EmailBuilder.js za adaptérem, potvrzeno částí 3"), `06:2477`, `06:4397`, `06:4619`. **Mění to rozsah práce, ne formulaci:** požadavek U→3.1 na klávesovou alternativu tažení je adresovaný adaptéru nad knihovnou, která v projektu nebude |
| **Názvy proměnných brzd** | tabulky 4.6 a části 1 | Text `04a:2001`, `2003`, `2005`, `131`, `3077` mluví o `BOUNCE_GUARD_RATE`, `COMPLAINT_GUARD_RATE`, `GUARD_MIN_SENT`; tabulky (`04a:2440`, `01:2561`) je jmenují `DELIVERABILITY_*`. Totéž `MATERIALIZE_BATCH_SIZE` vs `CAMPAIGN_MATERIALIZE_BATCH_SIZE`, `EVENT_RETENTION_DAYS` vs `MESSAGE_EVENT_RETENTION_DAYS` **[OVĚŘENO + AGENT]** |

### D2. Části hlásí jako otevřené věci, které jsou vyřešené

Vyrábí to duplicitní práci při každé synchronizaci.

| Kde | Co tvrdí | Skutečnost |
|---|---|---|
| `03:1582`, `03:3658`, `03:3692` | `workspace.sender_address` v kontraktu chybí, adresa se zapeče jako konstanta při kompilaci | `01:3358` a `3366` ho mají, včetně odstavce varujícího přesně před zapečením **[SHODA 2×]** |
| `03:3591`, `03:2722` | Purpose `mailer/v1/asset-url` „čeká na odsouhlasení" | `01:1250` ho v tabulce purposes má |
| `06:4638`, `06:4739`, `06:4790` | Člen `params` chybí, U→1.1, R6 a O9 otevřené | `01:2012` ho definuje. **Ale zároveň platí opak:** `01:2456` „kompletní typ `Problem` pro sdk-node" `params` ani `findings` nemá, takže část 6 má věcně pravdu, jen ne o tom místě **[SHODA 3×]** |
| `06:4767`, `06:4694` | Preflight vrací jen blokující kontroly, varování nemá kde vzniknout | `04a:766` má sloupec Závažnost s hodnotami blokuje/varuje, kontroly 6 a 14 varují |
| `02:257`, `02:3679` | Část 1 vyjmenovává jen `/t/**`, `/e/**`, `/u/**`, `/f/**` | `01:1912` má i `/s/c/**`, `/p/**`, `/r/**` |
| `04a:2979`, `04a:2868`, `04a:2869` | Rozpor 11.6 a požadavky R2.10, R2.11 nevyřízené | `01:2788` má `pending → skipped` a OB-14; `02:622` má `ses_suppressed`; `02:2219` deleguje práh na 4a |
| `04b:2225` | K23, K2, K8, K12 NEOPRAVENO | Všechny čtyři opravené (`01:2831`, `2982`, `2965`, `2887`) |
| `04b:297`, `04b:2103` | „Zápis do campaigns vyžaduje UPDATE, které kontraktní role nemá", P1.10 žádá vyřešit K21 | `01:3052` grant má |
| `05:2234` | Per workspace retence je otevřená otázka | `05:3344` má otázku 7 uzavřenou rozhodnutím zadavatele: globální retence, ne per workspace. Snippet `TrackingRetention` v 3.15.1 je v rozporu s uzavřeným rozhodnutím |

### D3. Zbytky po pivotech v části 5

Dokument prošel dvěma velkými změnami (partiční klíč na `received_at`, pole `message_created_at` v tokenu) a několik sekcí je nedostihlo:

- `05:1516`: sekce 3.7.6 popisuje `ON CONFLICT (id, created_at)` a „nekonečné dedup okno", ale sloupec `created_at` neexistuje (PK je `(id, received_at)`) a `05:314` výslovně dokazuje, že `ON CONFLICT` duplicitu nechytí. Kdo implementuje podle 3.7.6, postaví nefunkční deduplikaci **[SHODA 2×]**
- `05:967`, `1171`, `3033`, `3074`, `3300`: pět míst dohledává zprávu „přes okno odvozené z UUIDv7", ale 3.1.7 (`05:869`) je rovnostní dotaz přes `message_created_at` z tokenu a funkce `uuidv7_timestamp` je označená jako „nepotřebná, požadavek stažen" **[SHODA 2×]**
- `05:237` a `05:3044`: partiční klíč `message_events` uveden jako `created_at`, DDL o pár řádků níž i část 1 mají `received_at` **[SHODA 2×]**
- `05:926`, `2303`, `2653`: „token typu 1", „typu 2", `kind`. Kontrakt má `type` jako ASCII znak `o`/`c`/`i`/`u` **[SHODA 2×]**
- `05:198` a `05:734`: doslovný starý tečkový tvar `t1.<payload>.<tag>` zůstal ve dvou historických tabulkách. Kontrolní bod `STAV.md:34` („nikde starý tečkový tvar") tedy na prostý grep formálně neprojde, i když žádný živý snippet ho nepoužívá

---

## 6. Kategorie E: akceptační kritéria proti vlastní normě

Kapitola 8 má být přepis testů bez doptávání. Tohle jsou budoucí falešně červené testy.

| Kde | Kritérium tvrdí | Norma říká |
|---|---|---|
| `04a:2685` | AC 23: `Delivery` po `Bounce Permanent` nechá `messages.status` = **`failed`** | `04a:1567`, `1606`, AC 27, AC 78 i OB-15 (`01:3144`): zůstává **`sent`** **[SHODA 2×]** |
| `05:2920` | AC 60: payload `ml_token` má **54 bajtů** a neobsahuje `contact_id` | Kontrakt (`01:3511`, `05:751`): **60 bajtů** a `contact_id` obsahuje. `05:3269` si na to sám stěžuje **[SHODA 2×]** |
| `03:3451` | AC 39: 25 zpráv s `render_error` nad **1 %** odbavených | `03:1551`, R6, `01:3379`: přes **5 %** z prvních 1 000, kódy `render_failed`/`render_timeout` **[SHODA 2×]** |
| `03:3436` | AC 30: „všech **45** golden fixtur" shodí job **`contracts-liquid`** | `01:3456` říká „minimálně 44", tabulka `01:3458` dává součet **54**, job se jmenuje **`contracts-golden`**. AC 41 (`01:3986`) říká „nejméně 40". Tři různá čísla **[SHODA 3×]** |
| `01:3962` | AC 26: veřejný klíč `ml_pub_*` na `/contacts` vrátí **403** | `01:905`: regex neshoda → `unauthenticated` **401**, bez dotazu do DB |
| `04a:2758` | AC 76: kontakt s otiskem ze staršího pokolení klíče se vyloučí i po rotaci | `04a:881` a `1110` porovnávají jen dva uložené sloupce; `04a:3021` sám přiznává, že po rotaci join přestane nacházet shody |
| `02:3566` | Čísla kritérií 35 až 42 se v kapitole 9 vyskytují **dvakrát** (9.3 končí 42 na `02:3562`, 9.4 začíná znovu 35) | Odkazy typu „kritérium 39" (`02:2610`) jsou nejednoznačné **[SHODA 2×]** |

---

## 7. Kategorie F: chybové kódy a názvosloví

| Kde | Co |
|---|---|
| `03:472` vs `03:3086` vs `03:3397` | Tři kódy pro překročení limitu dokumentu: `content_document_too_large`, `payload_too_large` + `content_too_many_blocks`, `content.document_too_large` **[SHODA 2×]** |
| `03:2601` vs `03:2630` vs `03:3475` | Rate limit extrakce ve třech tvarech: `rate_limited`, `brand_rate_limited`, `brand.rate_limited` **[SHODA 2×]** |
| `03:3392`, `3393`, `3467`, `3485`, `1854`, `2563` | Tečková notace proti vlastní konvenci `<doména>_<problém>` bez teček (`03:127`, `03:2771`). Prošlo by to testem unikátnosti registru kódů **[SHODA 2×]** |
| `03:1497` vs `01:3404` | Kód pro `| vocative`: katalog části 3 má `liquid_vocative_filter`, golden fixture LQ-051 očekává `liquid_filter_not_allowed`. Validátor vrátí jeden kód, takže buď spadne fixture, nebo AC 25. **Kolize je uvnitř zmrazeného kontraktu** **[SHODA 2×]** |
| `05:2451`, `2595`, `2896`, `2928`, `2929` | camelCase (`firstOpenAt`, `computedAt`, `openRate`, `smallSample`, `contactId`) proti vlastní konvenci snake_case a proti tvrzení „všechny payloady přepsány" (`05:205`). AC 65 a 66 testují pole, která v odpovědi neexistují **[SHODA 2×]** |
| `06:3592` až `3603` | Katalog hlášek používá kódy `smtp_auth_failed`, `ses_sandbox_restricted`, `campaign_domain_not_verified`, `campaign_empty_audience`, `campaign_merge_tag_unknown`, `quota_exceeded`. Část 4a má `provider_smtp_auth_failed`, `provider_sandbox`, `domain_dkim_missing`, `campaign_audience_empty`, `campaign_unknown_merge_field`, `provider_quota_exceeded` a u `quota_exceeded` výslovně píše „nepoužívám". Poznámka `06:3630` tvrdí, že kódy v části 4a nenašla |
| `05:975`, `1021`, `1580`, `1704` | Tečkové názvy metrik (`tracking.open.capped`) vedle Prometheus katalogu `tracking_*` v 9.1. Alertovaný `tracking_message_lookup_miss_total` v katalogu chybí |
| `01:1512`, `01:3715` | Odkazy na CI joby `image-size` a `contracts-fixtures-schema`, které autoritativní tabulka `01:1862` nezná |
| `04b:2069`, `04b:2081` | Odkazy na O12 a O13 ukazují o jedničku vedle (go-mail je O11, osteele/liquid O12) |

---

## 8. Nálezy v části 6, které nejsou o kódu, ale blokují stavbu

| Kde | Co |
|---|---|
| `06:1008` | **Přehled a Statistiky nemají žádný návrh obrazovky**, přestože jim matice 7.2 předepisuje stavy a text říká „Dashboard skládá data z pěti zdrojů", které nejsou vyjmenované. První obrazovka po přihlášení se z této specifikace postavit nedá |
| `06:2976` | Detail kontaktu ukazuje členství v **dynamickém** segmentu; část 2 má zpětný dotaz jen pro statické (`02:834`) a endpoint „ve kterých segmentech je kontakt" neexistuje |
| `06:2179` | Třetí sloupec vzorku segmentu ukazuje hodnotu relevantní k podmínce; náhled části 2 vrací jen `{ id, email, first_name, last_name }` (`02:3198`). Dokument to ví (U→2.1), ale kontrakt je zmrazený |
| `06:2865` | Rozpad otevření na „potvrzeno kliknutím / pravděpodobně automatické / nejisté" a pravidlo „do 10 sekund od doručení". Část 5 počítá `opens_unique_human` podle třídy, ne podle kliknutí, a žádné z jedenácti klasifikačních pravidel (`05:1003`) desetisekundové kritérium nemá |
| `06:1403` vs `06:1491` | „Tři DNS záznamy" v textu i v delegačním e-mailu, ale model ukazuje „1. DKIM (1 ze 3)", „4. SPF", „3. DMARC". Část 4a generuje tři CNAME jen pro DKIM (`04a:1861`), celkem 5 až 7 záznamů. Číslování si navíc odporuje samo se sebou **[SHODA 2×]** |
| `06:2423` vs `06:2678` | Tentýž segment má na dvou obrazovkách jiný počet příjemců: 1 129 (rozpad se všemi branami) vs 1 153 (jen odhlášení a blokovaní). Číslo na tlačítku je hlavní pojistka nevratné akce |
| `06:3947` | Hláška `webhook_endpoint_disabled` tvrdí „Události z doby výpadku se neposílají zpětně"; `01:1120` slibuje nabídku přehrání posledních 24 hodin |
| `06:739` vs `06:949` | Smazání segmentu je současně N2 (potvrzovací dialog) i vratná akce s košem na 30 dní, přičemž `06:964` zakazuje dialog u vratné akce |
| `06:405` vs `06:1096` | Systémový pruh „blížící se konec zálohy" nemá v prioritní tabulce 7.4 číslo, takže pravidlo „vyhrává nižší číslo" na něj nelze použít |
| `06:4344` | Kapitola 13 nezná komponentu časové osy, přestože detail kontaktu na ní stojí (shlukování sérií, virtualizace, rodové věty) |
| `06:1174`, `06:1909`, `06:3909`, `06:1800`, `06:394` | Drobná čísla: „sedm polí" nad modelem s osmi, „šestnáct kódů" nad tabulkou s dvaceti (dvakrát), výpočet importu počítá hlavičku jako kontakt, dvě notace odhadu počtu |

---

## 9. Co je naopak v pořádku

Aby bylo jasné, co nesahat.

- **Kryptografie kontraktů drží.** Dva agenti nezávisle **[PŘEPOČÍTALI]** skriptem všechny vektory: HKDF odvození, otisk `VXGoNjoPSBY`, SHA-256 session tokenu, prefix a hash API klíče, HMAC podpis webhooku, všech pět trackovacích tokenů včetně plných MAC a délek 74/96/106/117, i kompletní AES-GCM obálku včetně `stored` a AAD. Sedí bajt na bajt. Podle nich lze TS i Go stranu psát nezávisle.
- **Outbox automat je logicky správný.** Dvoukrokový claim s `FOR UPDATE OF m SKIP LOCKED`, protokol D0 až D3 s markerem před síťovým voláním, tabulka pádů, důkaz serializace, správné znaménko u ambiguous reaperu, `ON CONFLICT` nad trojicí sloupců proti `uq_messages__campaign_contact`. Invariant I1 (celé sekundy) skutečně dělá z `u32` v tokenu přesnou hodnotu.
- **Pátý kontrakt (trackovací značky) sedí mezi částmi 3 a 4b doslova**, včetně tvarů obou značek, pořadí náhrada před interpolací, cest A a B, `marker_not_replaced` per zpráva, `contract_mismatch` při načtení do cache a šestnácti fixtur CT-001 až CT-016.
- **Licenční brána drží napříč všemi částmi.** Žádná propuštěná copyleft závislost, `pa11y` (LGPL) odmítnut, `axe-core` (MPL-2.0) správně jen vývojová závislost a eskalovaný jako požadavek na licenční bránu, u obou rizikových Go knihoven předem popsaná náhradní cesta.
- **Konvence DDL drží:** `text + CHECK` místo nativních ENUM, partition PK obsahuje partiční klíč, měkce mazané tabulky mají částečné unikátní indexy, past 42P10 u `ON CONFLICT` nad částečným indexem je správně popsaná i s inferencí.
- **Disciplína `asOf`** (žádné `now()` v kompilovaném SQL) je konzistentní napříč částmi 2 a 4a včetně akceptačních kritérií.
- **Verzování je všude, kde má být:** prefix `t1` u tokenů, `enc:v1:` s bajtem verze, `format_version` v manifestu zálohy, `t=,v1=` u podpisu webhooku s místem pro `v2`, `api_version` v obálce události, `ast_version` u segmentů, `mapping_version` u inbound endpointů.
- **Rozhraní jsou správné švy:** `Dispatcher`, `Classifier`, `Renderer` v senderu; descriptorový editor v části 3 (přidání bloku je jeden `BlockDescriptor`); timeline jako `UNION ALL` nezávislých větví; klasifikace otevření jako datová tabulka, ne kód.
- **Kapitola 3.13 části 3 (SSRF) je implementovatelná tak, jak je**, včetně rozlišení `resolve4/6` vs `lookup()`, ověření `socket.remoteAddress` po connectu a rozbalování NAT64 a 6to4.
- **Katalog patnácti stavů obrazovek v části 6 je typový, ne po obrazovkách**, takže nová obrazovka dostane stavy zadarmo. Lokalizace má tři nezávislé jazykové osy a přidání jazyka bez změny kódu.

---

## 10. Návrh postupu

Každý krok zlevňuje ten další.

1. **Rozmrazit kontrakt na jedno kolo a zavřít kategorii A.** Bez toho nemá smysl opravovat nic dalšího, protože všechny části na kontrakt odkazují. Osm bodů, z nichž A6 (`claimed_by` v D3) je jediná skutečná chyba korektnosti.
2. **Projít kategorii B.** Mechanická práce s jistým výsledkem. **Doporučuju spustit všechna DDL proti prázdné PostgreSQL 18 dřív, než se napíše první migrace**, ve stejném duchu jako scénář OB-00: test nic netvrdí o výsledku, jen ověří, že to parser přijme.
3. **Rozhodnout osm bodů kategorie C.** U šesti stačí jedna věta ve specifikaci, ne přepis. Dva potřebují skutečné rozhodnutí: C1 (podmínky a cykly v blokovém modelu) a C2 (rezerva pro varianty obsahu v `campaigns`), protože oba se dotýkají kontraktu.
4. **Dozanést kategorii D.** Čtyři rozhodnutí zadavatele a devět zastaralých odkazů.
5. **Sjednotit kategorie E a F.** Nejpozdější možný okamžik je před psaním testů.

**Metodická poznámka:** kroky 1 a 2 dělat odděleně a po každé opravě ověřit grepem ve skutečném souboru, ne podle hlášení agenta. `STAV.md:90` dokumentuje, proč.

---

## 11. Co potřebuje rozhodnutí, ne opravu

Body, kde revize neví, co je správně, protože jde o volbu, ne o chybu.

1. **Podmínky a cykly v blokovém modelu** (C1): obalový uzel, nebo vlastnost bloku `visibleWhen`? A urychlit K4, protože dnes neexistuje platný zápis podmínky „pole není prázdné".
2. **Rezerva pro varianty obsahu v `campaigns`** (C2): zavést nullable `variant_id` teď, nebo přijmout, že A/B v MVP 1 znamená verzi 2 kontraktu?
3. **`campaign_id` v outboxu nullable** (C2): otevřít cestu pro transakční a automatizační zprávy teď, nebo později?
4. **Sedmá položka menu** (C7): rezervovat ji pro Automatizace teď, nebo nechat spor na MVP 2?
5. **Historický import událostí** (C4): povolit ho, nebo sedmidenní okno prohlásit za záměr a import ze specifikace vyškrtnout?
6. **Třetí jazyk** (C8): otevřít `language` na BCP 47 teď, nebo přijmout, že třetí jazyk je verze 2 kontraktu 5?
7. **Prahy brzd per projekt** (C9): agentura bude chtít jiný práh pro opatrného klienta a jiný pro e-shop. Dnes jde jen vypnout.
8. **Jméno produktu jako konstanta** (C9): kdy se to udělá? Dokud je doslovně v HKDF saltech a MAC prefixech, každá změna jména je zásah do zmrazeného kontraktu a přepočet vektorů.
