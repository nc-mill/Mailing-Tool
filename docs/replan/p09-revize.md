# P09 (Go sender) proti P03 (schéma a RLS): revize souladu

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Revize plánu P09 (sender v Go) z prověrky plánů
> (31. 7. až 1. 8. 2026), tedy kontrola **textu plánu před stavbou**, ne kontrola kódu.
> **Verdikt typu „plán není proveditelný" se týkal tehdejšího plánu, ne dnešního produktu.** Ten stojí a funguje.
> Opravy se prováděly podle `docs/superpowers/plans/POSTUP-OPRAV.md`; **stav jednotlivých nálezů neověřen**.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

Recenzovaný plán: `/Users/petr/Projects/Mailing_Tool/docs/superpowers/plans/2026-07-31-p09-sender-go.md`
Zdroj pravdy pro schéma: `/Users/petr/Projects/Mailing_Tool/docs/superpowers/plans/2026-07-31-p03-databaze-schema-rls.md`
Datum revize: 2026-07-31

Prověřované místo v P03: granty 5181-5290, RLS 5018-5149, DDL `messages` 4024-4114,
DDL `message_events` 4118-4184, `suppressions` 1852-1875, `campaign_render_warnings` 2885-2899,
`copyGrantsFromParent` 4609-4640.

## Verdikt

Plán P09 je proti schématu P03 z 90 procent v pořádku: každý zapisovaný sloupec sedí do
sloupcových grantů role `mlain_sender` a dvoukrokový claim je proti RLS navržený správně.
Zbývají **tři kritické nálezy**, které se všechny projeví až v produkci a v testech nikdy,
protože testovací replika schématu v `apps/sender/internal/testsupport/schema.sql` je volnější
než skutečné schéma. Jeden z nich (varování z renderu) je zároveň rozpor mezi P03 a P09 o tom,
kdo vlastně tabulku plní.

Bez opravy K1 až K3 plán do implementace pouštět nedoporučuji.

| Závažnost | Počet |
|---|---|
| KRITICKÉ | 3 |
| DŮLEŽITÉ | 4 |
| POZNÁMKA | 7 |

---

## Co jsem ověřil jako v pořádku

Prošel jsem všech 21 normativních dotazů z registru (úkol 9, krok 3, řádky 2848-3172) sloupec
po sloupci proti přesnému výčtu grantů v P03.

- **Sloupcové granty na `messages` sedí.** Každý sloupec, který kterýkoli dotaz zapisuje
  (`status`, `claimed_by`, `claimed_at`, `claim_expires_at`, `dispatch_started_at`, `attempts`,
  `next_attempt_at`, `provider_message_id`, `sent_at`, `error_code`, `error_detail`,
  `ambiguous_count`, `updated_at`), je v grantu. `created_at` nezapisuje žádný dotaz, takže
  invariant I1 drží i na úrovni práv.
- **`StmtPauseCampaign` mění jen `status` a `pause_reason`**, tedy přesně to, co grant povoluje.
  Test `TestSenderCannotWriteOtherCampaignColumns` (úkol 16) to i ověřuje.
- **`FOR UPDATE OF m SKIP LOCKED` projde.** PostgreSQL vyžaduje `UPDATE` na aspoň jednom sloupci
  tabulky a sloupcový grant tuhle podmínku splňuje.
- **`sender_bypass ON campaigns` bez `WITH CHECK` je pro pauzu bezpečný.** Když `WITH CHECK`
  chybí, PostgreSQL použije u UPDATE výraz z `USING` i pro kontrolu nového řádku, takže
  permisivní `USING (true)` pustí i zápis. P03 to má popsané v komentáři a je to pravda.
- **`sender_bypass ON message_events` jen s `WITH CHECK` senderu nevadí**, protože z té tabulky
  nic nečte.
- **`ws_isolation` nevyhodí chybu při nenastaveném kontextu.** Politiky používají
  `current_setting('mlain.workspace_id', true)`, takže chybějící proměnná dá NULL, ne výjimku.
  Sender `set_config` nikdy nevolá a je to v pořádku.
- **Dvousložkový klíč.** Všechny dotazy mířící na jednu zprávu nesou `id = $1 AND created_at = $2`
  a hlídá to jednotkový test `TestSingleMessageStatementsCarryBothKeyParts` (úkol 9, krok 1).
- **Partitioning a AK-20.2.** `createMonthlyPartitions` v P03 volá `copyGrantsFromParent`, který
  kopíruje tabulkové i sloupcové granty z rodiče na novou partition. Claim tedy nová měsíční
  partition nerozbije.
- **Granty na sekvence nejsou potřeba.** Všechny klíče jsou `uuid DEFAULT uuidv7()`, žádný
  `serial` v tabulkách senderu není.
- **Sender nikde nesahá na `contacts`, `web_events`, `users`, `sessions`, `api_keys`,
  `audit_log`, `provider_event_receipts`, `campaign_stats`, `message_engagement`
  ani `contact_engagement`.** Ověřeno grepem, ne čtením.

---

## KRITICKÉ

### K1. `campaign_render_warnings`: P03 dává grant, který je pod rolí `mlain_sender` nepoužitelný, a P09 ho stejně nepoužívá

**Kde:** P03 řádky 5241-5243 proti P09 úkolům 8 (replika schématu), 9 (registr dotazů),
21 a 35 (render a varování).

**Co žádá P03:** „Agregovaná varování z renderu. Sender je drží v paměti a zapisuje jednou za
10 sekund přes `INSERT ... ON CONFLICT DO UPDATE`, potřebuje tedy obojí."
`GRANT INSERT, UPDATE ON campaign_render_warnings TO mlain_sender`.

**Proč to nemůže fungovat, tři nezávislé důvody:**

1. **Chybí `SELECT`.** `ON CONFLICT DO UPDATE` s agregací (`count = campaign_render_warnings.count
   + excluded.count`) čte existující řádek. PostgreSQL vyžaduje `SELECT` na každý sloupec čtený
   ve výrazech nebo podmínce `DO UPDATE`. Bez něj `permission denied for table
   campaign_render_warnings`.
2. **Chybí politika `sender_bypass`.** P03 ji na řádcích 5136-5148 zakládá jen na sedmi
   tabulkách a `campaign_render_warnings` mezi nimi není. Zbývá `ws_isolation` s
   `WITH CHECK (workspace_id = current_setting('mlain.workspace_id', true)::uuid)`. Sender tuhle
   proměnnou nikdy nenastavuje, výraz je NULL, tedy nepravda, a **už prostý INSERT skončí na
   `new row violates row-level security policy`**.
3. **U upsertu se na existující řádek uplatní `USING` politiky UPDATE.** Ta taky nepustí nic,
   takže i po opravě bodů 1 a 2 by bez `sender_bypass` upsert skončil chybou.

**Co má P09:** nic. Varování končí v paměti jako `[]liquidx.Warning` v `Rendered.Warnings`
(úkol 21, řádky 6991-7035; úkol 35, řádky 12188 a 12291). Řetězec `campaign_render_warnings`
není v celém P09 ani jednou, replika schématu tu tabulku nezakládá a v registru 21 dotazů
žádný upsert varování není.

**Navrhovaná oprava:** rozhodnout vlastníka a promítnout do obou plánů.

- Vlastníkem je sender: P03 doplní `GRANT SELECT ON campaign_render_warnings TO mlain_sender`
  (stačí sloupcově na `count, first_seen_at, last_seen_at, sample`) a
  `CREATE POLICY sender_bypass ON campaign_render_warnings TO mlain_sender USING (true) WITH CHECK (true)`,
  čímž `SENDER_BYPASS_TABLES` naroste na osm. P09 dostane 22. normativní dotaz, tabulku
  v replice a scénář v `OB-00`.
- Vlastníkem není sender: P03 zruší `GRANT INSERT, UPDATE ON campaign_render_warnings`
  i komentář o desetisekundovém zápisu a v části 4a se musí najít, kdo varování zapisuje.

**Proč to je kritické:** dnešní stav je nejhorší ze tří možností. Kontrakt slibuje funkci,
kterou nikdo neimplementuje, a kdyby ji někdo doimplementoval přesně podle komentáře v P03,
spadla by v produkci na oprávnění nebo na RLS.

### K2. `suppressions.email` je `citext`, ale sender ho porovnává s `text[]`, takže kontrola suppression je case-sensitive

**Kde:** P09 úkol 9, krok 3, `StmtSuppressionBatch` (řádky 3116-3121) a úkol 15, krok 3,
`FilterSuppressed` (řádky 5092-5116). Proti P03 řádek 1855.

**Co je v dotazu:** `AND (s.email = ANY($2::text[]) OR s.fingerprint = ANY($3::bytea[]))`.
Levá strana je `citext`, pravá `text`. Rozlišování operátoru v PostgreSQL najde implicitní
přetypování `citext` na `text` (opačný směr je jen `ASSIGNMENT` a při rozlišování operátoru se
nepoužije), takže se vybere operátor `text = text`. **Porovnání je case-sensitive** a nemůže
použít unikátní index nad `citext`.

**Co dělá Go:** `lower := strings.ToLower(strings.TrimSpace(m.Email))`, tedy posílá adresy
malými písmeny. `citext` si přitom v řádku drží původní zápis, takže suppression založená jako
`Jan.Novak@Example.cz` se nenajde a zpráva odejde.

**Navrhovaná oprava:** `s.email = ANY($2::text[]::citext[])`. Přetypování pole je legální
(`text` na `citext` je binárně kompatibilní `ASSIGNMENT` cast), parametr zůstane `text[]`,
takže pgx nemusí znát OID pro `citext[]`, a porovnání se vrátí k `citext = citext`, tedy
i k indexu. Do repliky v úkolu 8 patří `CREATE EXTENSION IF NOT EXISTS citext` a
`email citext NOT NULL`.

**Proč to je kritické:** propuštěná suppression znamená odeslání na adresu po odhlášení,
stížnosti nebo tvrdém bounci. Je to právní i doručovací problém a dnešní testy ho neodhalí,
protože replika deklaruje `email text` a testy zakládají adresy rovnou malými písmeny.

**Druhá polovina téhož nálezu:** `suppressions.email` je v P03 **`NOT NULL`** (u
`reason='gdpr_erasure'` se ukládá placeholder). P09 staví na opačném předpokladu: komentář
u `StmtSuppressionBatch` říká „po výmazu podle GDPR e-mail z řádku zmizí a zůstane jen otisk",
`FilterSuppressed` skenuje `email` jako nullable a test
`TestSuppressionFindsByOldGenerationFingerprint` (úkol 15, krok 1, řádky 5003-5006) vkládá
`email = NULL`. Proti skutečnému schématu ten INSERT skončí na porušení NOT NULL. Funkčně
větev přes otisk zůstává potřebná, ale zdůvodnění i test stojí na neexistujícím stavu dat.
Buď P03 povolí `email` NULL po výmazu, nebo P09 přepíše test a komentář na placeholder.

### K3. `attempts = attempts - 1` běží i před krokem D1, což porušuje `ck_messages__attempts`

**Kde:** P09 úkol 9, krok 3, `StmtResultFatal` (řádky 3087-3095) proti úkolu 41, krok 6,
funkce `resolveProvider` (řádek 14622) a `process` (řádky 14487-14497).

**Co se děje:** v `process` se `MarkDispatchStarted` (krok D1, který jediný `attempts`
inkrementuje) volá až **po** `resolveProvider`. `resolveProvider` přitom při nedešifrovatelné
konfiguraci volá `a.store.RecordFatal(...)` přímo, tedy dřív, než kdokoli `attempts`
inkrementoval. U čerstvé zprávy je `attempts = 0`, takže se zapisuje `-1`.

**Co má P03:** `CONSTRAINT ck_messages__attempts CHECK (attempts >= 0 AND attempts <= 100)`
(řádek 4051). Replika v P09 (úkol 8, řádek 2500) má `attempts smallint NOT NULL DEFAULT 0`
**bez CHECK**, takže testy jsou zelené a produkce vrátí `23514 new row violates check
constraint "ck_messages__attempts"`.

**Navrhovaná oprava:** ve `StmtResultFatal` a pro jistotu i ve `StmtResultThrottled` použít
`attempts = GREATEST(attempts - 1, 0)`. Do repliky doplnit oba CHECK constrainty.

**Proč to je kritické:** scénář nedešifrovatelných credentials je právě ten, kvůli kterému
varianta D3d existuje. Dnes na něm zápis selže, chyba se jen započítá do metriky
`db_errors{op="result_fatal"}`, zpráva zůstane `claimed` až do vypršení TTL a uvolní ji teprve
reaper A. Kampaň se nakonec pozastaví, ale chování je jiné než popsané a v testech neviditelné.

---

## DŮLEŽITÉ

### D1. Testovací replika schématu se od P03 liší v devíti bodech a CI job `contracts-schema` je nezachytí

**Kde:** P09 úkol 8, krok 3, soubor `apps/sender/internal/testsupport/schema.sql`
(řádky 2400-2610). Komentář na řádcích 2405-2407 slibuje, že drift hlídá CI job
`contracts-schema`, který „aplikuje skutečné migrace a porovná **sloupce** s kontraktní
podmnožinou ze 4.10.1". Porovnání sloupců neodhalí nic z následujícího:

| Věc | Replika P09 | P03 | Důsledek |
|---|---|---|---|
| `suppressions.email` | `text`, nullable | `citext NOT NULL` | K2 |
| `messages` CHECK `attempts` | chybí | `attempts >= 0 AND attempts <= 100` | K3 |
| `messages` CHECK `sent` implikuje `sent_at` | chybí | `ck_messages__sent_has_timestamp` | budoucí zápis `sent` bez `sent_at` projde testy |
| `messages.contact_id` | nullable | `NOT NULL` | P2 |
| `message_events` partiční klíč | `PARTITION BY RANGE (ts)`, PK `(id, ts)` | `RANGE (received_at)`, PK `(id, received_at)` | D2 |
| `message_events.source` | `NOT NULL DEFAULT 'sender'` | `CHECK source IN (ses_sns, smtp, internal, tracking)` | D2 |
| `message_events` povinné sloupce | chybí `campaign_id`, `recipient`, `rank` | všechny tři `NOT NULL` | D2 |
| `sending_providers.quota_max_send_rate` | `double precision` | `numeric(10,2)` | P3 |
| `campaign_links` | bez `workspace_id`, bez `label`, bez `UQ (campaign_id, position)` | tři sloupce a index navíc | dnes neškodí, sender tabulku nečte |

**Navrhovaná oprava:** rozšířit `contracts-schema` z porovnání sloupců na porovnání **CHECK
constraintů, nullability, typů, partičního klíče a složeného PK** u sedmi tabulek, které replika
obsahuje. Nejlevnější varianta: job aplikuje skutečné migrace z P03 a spustí proti nim celý
`go test -tags=integration ./internal/contracts/`, takže se replika i produkční schéma testují
stejnou sadou.

**Proč:** replika je jediné místo, kde P09 píše DDL, a zároveň jediné, proti čemu se testuje.
Dva ze tří kritických nálezů jsou neviditelné právě proto, že replika je volnější než P03.

### D2. Sender má `INSERT ON message_events`, ale nezapisuje tam nic, takže typy `render_failed` a `circuit_breaker_open` nemají původce

**Kde:** P03 řádek 5240 a slovník `ck_message_events__type` (řádky 4145-4149) proti P09
kapitole 28, řádek 15304: „sender do `message_events` v běžném provozu nezapisuje".

**Rozpor:** P03 uděluje `GRANT INSERT ON message_events TO mlain_sender`, kvůli tomu zakládá
i `CREATE POLICY sender_bypass ON message_events TO mlain_sender WITH CHECK (true)` a do
slovníku typů zahrnuje `render_failed` a `circuit_breaker_open` s odůvodněním „výčet je
sjednocení všeho, co kterákoliv část deklaruje, že zapisuje". P09 do `message_events` nezapisuje
ani jednou: v registru 21 dotazů žádný `INSERT INTO message_events` není a úkol 17 testuje jen
zákaz SELECT a UPDATE.

**Co by navíc selhalo, kdyby se zápis doplnil podle repliky:** P03 vyžaduje `campaign_id NOT NULL`,
`recipient NOT NULL`, `rank smallint NOT NULL`, `source` z výčtu čtyř hodnot a partiční klíč
`received_at`. Replika P09 povinné sloupce nemá, používá `ts` jako partiční klíč a nastavuje
`source DEFAULT 'sender'`, což CHECK v produkci odmítne.

**Navrhovaná oprava:**

- Když sender události zapisuje: doplnit 22. normativní dotaz se `source = 'internal'`, `rank`,
  `recipient` a `campaign_id`, srovnat repliku na `received_at` a přidat scénář do `OB-00`.
- Když nezapisuje: P03 může `GRANT INSERT ON message_events` i politiku `sender_bypass` na téhle
  tabulce zrušit (`SENDER_BYPASS_TABLES` klesne na šest) a v části 4a se musí najít jiný původce
  `render_failed` a `circuit_breaker_open`, jinak jsou to mrtvé hodnoty slovníku.

**Proč:** jedna ze dvou vět je špatně a v obou případech chybí buď kód, nebo grant. `render_failed`
je navíc jediná stopa po neodeslané zprávě kvůli chybě šablony; bez ní zůstane jen
`messages.error_code`.

### D3. Sender nečte `sending_providers.status`, `sending_enabled` ani `type`

**Kde:** P09 úkol 9, `StmtProviderConfig` (řádky 2888-2891) a úkol 41, řádky 14228 a 14263.

**Co dotaz tahá:** jen `id`, `workspace_id`, `config_encrypted`, `quota_max_send_rate`. Druh
provideru se bere z dešifrované obálky (`cfg.Kind`), ne ze sloupce `type`.

**Co P03 má:** `status IN (unverified, verifying, ready, degraded, blocked, disabled)`,
`sending_enabled boolean`, `enforcement_status`, `production_access`, `quota_checked_at` a index
`(quota_checked_at) WHERE status IN ('ready','degraded')`. Sender má `SELECT` na celou tabulku,
takže mu nic nechybí, jen to nepoužívá.

**Navrhovaná oprava:** buď doplnit `p.status, p.sending_enabled, p.type` do `StmtProviderConfig`
a při `sending_enabled = false` nebo `status IN ('blocked','disabled')` kampaň pozastavit kódem
`provider_unavailable`, nebo do kapitoly 31 výslovně zapsat, že stav provideru hlídá aplikace
(P13) a sender ho vědomě ignoruje.

**Proč:** když AWS zablokuje účet a aplikace nastaví `status = 'blocked'`, sender to dnes
nepozná a bude dál tlačit zprávy do provideru, který je odmítá. Rozejde-li se
`sending_providers.type` s `kind` v obálce, sender použije obálku a nikdo se to nedozví.

### D4. Pauza od senderu nenastaví `paused_at` ani `updated_at` a sender na ně nemá grant

**Kde:** P09 úkol 9, `StmtPauseCampaign` (řádky 3142-3145) proti P03 řádku 5232.

**Stav:** dotaz nastavuje jen `status` a `pause_reason`, protože grant je přesně na tyhle dva
sloupce. P03 přitom má `campaigns.paused_at` i `campaigns.updated_at` a konvenci, že
`updated_at` mění aplikace, ne trigger.

**Navrhovaná oprava:** rozhodnutí patří P03 a P13. Buď rozšířit grant na
`GRANT UPDATE (status, pause_reason, paused_at, updated_at) ON campaigns TO mlain_sender`
a doplnit oba sloupce do dotazu, nebo do obou plánů napsat, že po pauze od senderu je
`paused_at` NULL a `updated_at` zastaralé a UI čte čas z `pause_reason ->> 'at'`.

**Proč:** `paused_at` je jediný indexovatelný čas pauzy. Když ho sender neplní, „kdy se to
zastavilo" jde zjistit jen parsováním jsonb. A protože `updated_at` zůstane starý, každá cache
nebo optimistický zámek nad `updated_at` pauzu od senderu přehlédne.

---

## POZNÁMKY

**P1. `SELECT ON campaign_links` je nevyužitý grant.** P03 ho drží vědomě (rozhodnutí R15)
a zakládá kvůli němu i `sender_bypass ON campaign_links`. P09 tabulku nečte, objevuje se jen
v replice (úkol 8) a v seznamu vlastnictví; identifikátor odkazu si sender odvozuje sám.
Buď to P03 zapíše jako rezervu na MVP 1, nebo grant i politiku zruší.

**P2. `messages.contact_id` je v P03 `NOT NULL`, P09 s ním pracuje jako s nullable.**
`Message.ContactID` je `*uuid.UUID` a v rendereru (úkol 35, řádek 12293) je větev
`if msg.ContactID != nil`, která rozhoduje o `preferences_url` a `webview_url`. Proti skutečnému
schématu je ta větev mrtvá. Není to chyba, jen zbytečná nejistota, kterou replika s nullable
sloupcem udržuje při životě.

**P3. `quota_max_send_rate` je `numeric(10,2)`, ne `double precision`.** pgx v5 umí `numeric`
naskenovat do `*float64` (úkol 40, řádek 13833), takže to funguje, ale replika deklaruje jiný typ.
Stačí ji srovnat na `numeric(10,2)`.

**P4. `messages.content_variant_id` sender ignoruje a na `campaign_content_variants` nemá grant.**
V P03 je to rezerva pro MVP 1 s cizím klíčem. Až A/B varianty přijdou, bude potřeba
`GRANT SELECT ON campaign_content_variants` plus politika `sender_bypass`, jinak sender pošle
všem základní obsah kampaně. Pro MVP 0 stačí, aby to bylo napsané v obou plánech.

**P5. `campaigns.sender_domain_id` a `sender_domains` sender nečte a grant na ně nemá.**
`Return-Path` v SMTP se bere z dešifrované konfigurace provideru (úkol 29, řádky 10111-10115),
u SES se nenastavuje vůbec (zákaz Z11). Sladění domény MAIL FROM tedy nezávisí na ověřeném
řádku `sender_domains`. Je to konzistentní, jen ať je vidět, že `campaigns.sender_domain_id`
na odesílání nemá vliv.

**P6. Partitioning: granty se kopírují, politiky ne.** `copyGrantsFromParent` v P03
(řádky 4609-4640) přenáší na každou novou partition tabulkové i sloupcové granty z rodiče,
takže AK-20.2 projde. Nekopíruje se ale `ENABLE ROW LEVEL SECURITY` ani politiky. Dotaz přes
rodiče politiky rodiče uplatní, přímý dotaz na partition (`SELECT * FROM messages_y2026m08`)
je neuplatní. Pro `mlain_sender` je to jedno, protože jeho politika je `USING (true)`, ale pro
`mlain_app` to znamená, že přímý dotaz na partition obchází `ws_isolation`. Patří to do revize
P03, ne P09; test `TestSenderClaimsAcrossPartitionsWithoutPerPartitionGrants` (úkol 17) tuhle
stránku neověřuje.

**P7. Granty na sekvence nejsou potřeba.** Všechny klíče jsou `uuid DEFAULT uuidv7()`, v žádné
tabulce, na kterou sender sahá, není `serial`. `GRANT USAGE, SELECT ON ALL SEQUENCES` má jen
`mlain_app` a to je správně.

---

## Souhrnná tabulka

| Co doplnit | Kdo žádá | Typ nebo tvar | Proč |
|---|---|---|---|
| `GRANT SELECT ON campaign_render_warnings TO mlain_sender` | P03 5241-5243 | tabulkový nebo sloupcový grant na `count, first_seen_at, last_seen_at, sample` | `ON CONFLICT DO UPDATE` čte existující řádek, bez `SELECT` skončí na `permission denied` |
| `CREATE POLICY sender_bypass ON campaign_render_warnings TO mlain_sender USING (true) WITH CHECK (true)` | P03 5241-5243 | osmá politika `sender_bypass` | bez ní `ws_isolation` odmítne i prostý INSERT, sender `mlain.workspace_id` nenastavuje |
| Rozhodnout vlastníka zápisu varování z renderu | P09 úkoly 21 a 35 (varování končí v paměti) | buď 22. normativní dotaz v P09, nebo zrušení grantu v P03 | dnes kontrakt slibuje funkci, kterou nikdo neimplementuje a která by po implementaci spadla |
| Oprava `StmtSuppressionBatch` na `s.email = ANY($2::text[]::citext[])` | P09 úkol 9 (3116-3121) proti P03 1855 | `citext` porovnání místo `text` | dnes je kontrola suppression case-sensitive a nepoužije index, odešle se na odhlášenou adresu |
| `citext` a `NOT NULL` u `suppressions.email` v replice | P09 úkol 8 (2462-2471) | `CREATE EXTENSION citext`, `email citext NOT NULL` | testy dnes vkládají `email = NULL`, což skutečné schéma odmítne |
| `attempts = GREATEST(attempts - 1, 0)` ve `StmtResultFatal` a `StmtResultThrottled` | P09 úkol 9 (3087-3095) a úkol 41 (14622) | oprava SQL | jinak `-1` poruší `ck_messages__attempts` a zápis výsledku v produkci selže |
| CHECK `ck_messages__attempts` a `ck_messages__sent_has_timestamp` do repliky | P09 úkol 8 (2487-2515) | doplnění DDL | bez nich jsou testy zelené na chybě, která v produkci vyhodí 23514 |
| Rozšířit CI job `contracts-schema` ze sloupců na typy, nullability, CHECK, partiční klíč a PK | P09 úkol 8 (2405-2407) | změna CI | devět bodů driftu repliky dnes projde nezachyceno |
| Srovnat `message_events` v replice: partiční klíč `received_at`, PK `(id, received_at)`, `campaign_id`, `recipient`, `rank`, `source` bez defaultu `'sender'` | P09 úkol 8 (2474-2485) proti P03 4118-4160 | oprava repliky | `'sender'` není v `ck_message_events__source`, `ts` není partiční klíč |
| Rozhodnout, jestli sender zapisuje `render_failed` a `circuit_breaker_open` | P03 slovník typů a `GRANT INSERT ON message_events`; P09 řádek 15304 tvrdí opak | buď dotaz v P09, nebo zrušení grantu a politiky v P03 | jinak dvě hodnoty slovníku nemají původce a grant je mrtvý |
| `p.status, p.sending_enabled, p.type` do `StmtProviderConfig`, nebo poznámka, že je hlídá aplikace | P09 úkol 9 (2888-2891) | rozšíření SELECT, grant už existuje | zablokovaný provider dnes sender nepozná |
| `paused_at` a `updated_at` v grantu na `campaigns`, nebo zápis, že po pauze zůstávají prázdné | P09 úkol 9 (3142-3145) proti P03 5232 | `GRANT UPDATE (status, pause_reason, paused_at, updated_at)` | čas pauzy je dnes jen v jsonb a `updated_at` po pauze neodpovídá |
| `quota_max_send_rate numeric(10,2)` v replice | P09 úkol 8 (2425) | oprava typu | replika deklaruje `double precision`, produkce `numeric(10,2)` |
| Zapsat, že `campaign_links` a `sender_domains` sender nečte | P03 R15 a `campaigns.sender_domain_id` | poznámka, případně zrušení grantu a politiky na `campaign_links` | grant a politika bez uživatele zbytečně rozšiřují plochu |
