# Vytěžení nálezů z prověrky plánů, stav k 6. 8. 2026

Zdroj: `docs/superpowers/plans/NALEZY-NAPRIC-PLANY.md`, oddíl „Otevřené" (řádky 90 až 2656).
Ten soubor je historický záznam z 1. až 3. 8. 2026 a nadpis „Otevřené" o dnešním stavu nic neříká:
uzavíralo se v něm na místě slovem UZAVŘENO, ne přesunem.

Tenhle dokument je jeho **vytěžení proti skutečnému kódu**. Každá položka je posouzená čtením
repozitáře, ne přečtením plánu. Do původního souboru se nesahalo.

**Metoda a její hranice.** Rozhodovalo se výhradně čtením zdrojů (schéma, migrace, granty,
routery, joby, CI, CLI). Žádná testovací sada se nepouštěla. Položky, které se týkají znění
specifikace nebo řídicího dokumentu, tedy textů mimo kód, jsou vedené jako NEOVĚŘITELNÉ,
protože z repozitáře se rozhodnout nedají.

## Souhrn

Oddíl „Otevřené" má **117 nadpisů**. Jeden z nich (N-P03X) je souhrn deseti očíslovaných
podpoložek, které se posuzují každá zvlášť, takže položek k posouzení je **126**.

| Skupina | Počet | Co to znamená |
|---|---:|---|
| **PLATÍ** | 28 | vada je pořád v kódu |
| **OPRAVENO** | 65 | mezitím spraveno, doloženo v kódu |
| **BEZPŘEDMĚTNÉ** | 20 | týká se kódu nebo rozhodnutí, které už neexistuje |
| **NEOVĚŘITELNÉ** | 6 | týká se textu specifikace nebo řídicího dokumentu, ne kódu |
| **přeskočeno** | 7 | nález má v původním textu UZAVŘENO |

Zhruba **polovina** nálezů je mezitím opravená a další šestina zanikla tím, že se změnilo
řešení. Zbylých osmadvacet je níž, seřazených podle toho, co se stane, když se neopraví.

---

## PLATÍ

Řazeno podle následku: nahoře to, co může znamenat ztrátu dat, právní problém nebo tiché
špatné číslo, dole to, co je nepříjemnost nebo zavádějící komentář.

### 1. N42, bod 1: výmaz podle článku 17 nečistí obsah událostí z prohlížeče

**Kde:** `packages/core/src/contacts/jobs/gdpr-sever-links.ts:61`, sloupcový grant
v `packages/db/migrations/0009_maintenance_scan.sql:177`, sloupce
v `packages/db/src/schema/partitioned.ts:265`.

Výmaz nastaví `web_events.contact_id = NULL` a `erased_at = now()`, tedy **přeruší vazbu na
osobu**. Sloupce `page`, `properties` a `context` zůstávají beze změny a aplikační role je
změnit ani nemůže: grant zní `GRANT UPDATE (contact_id, identity_merge_id, erased_at)`.

**Proč to vadí:** v těch třech jsonb sloupcích leží URL stránek, vlastnosti události a kontext
prohlížeče, tedy typicky IP adresa a user agent. Po výmazu podle článku 17 jsou pořád
v databázi. Není to tichá chyba v kódu, je to **rozsah výmazu, který se rozchází s tím, co
produkt slibuje**. Buď se sloupce mají čistit (a pak je potřeba rozšířit grant), nebo se má
někde napsat, že se vědomě nečistí a proč.

### 2. N68: `campaign_stats` nemá čítač `rejected`, takže odmítnutá zpráva se počítá jako doručená

**Kde:** `packages/db/src/schema/tracking.ts:236` až `270`. Typ `rejected` přitom existuje,
škála `rank` ho zná (`packages/db/src/schema/partitioned.ts:194`).

Kde provider události doručení neposílá nebo ještě neposlal, počítá se doručení odečtem
`sent - bounced_hard - bounced_soft - failed`. Odmítnutá zpráva se z toho vzorce neodečte.

**Proč to vadí:** kampaň, kterou SES odmítne kvůli vlastnímu suppression listu, ukáže míru
doručení blízko sta procent a **míru prokliku podstřelí**, protože proklik se dělí právě
tímhle jmenovatelem. Proklik je rozhodnutím zadavatele hlavní metrika produktu, takže je to
tichá chyba v čísle, podle kterého se produkt řídí. Nic nespadne a z obrazovky se to nepozná.

### 3. N60 a P11-2: sken napříč projekty nad `segments` a `imports` nemá přístupovou cestu

**Kde:** politiky pro roli `mlain_maintenance` zakládá `packages/db/migrations/0009_maintenance_scan.sql:56`
až `68` a pokrývají **jen** `workspaces`, `campaigns` a `sender_domains`. `segments` ani
`imports` mezi nimi nejsou.

**Proč to vadí:** u importů je ten sken jediná cesta zpátky z uváznutí. Zabitý worker nechá
import ve stavu `importing`, `singletonKey` projektu zůstane obsazený a **v projektu už nejde
spustit žádný další import**. Uživatel to uvidí jako trvale rozbitou funkci bez chybové hlášky.
U segmentů jde jen o zastaralé počty, které se dorovnají při otevření seznamu.

Polehčující okolnost: obnova zaseknutých importů dnes **nekončí tiše**. Strážce v
`packages/core/src/contacts/import/jobs/recover-stale.ts:33` odliší ticho od prázdna a shodí
job kódem `cross_workspace_scan_blocked`. Porucha je tedy hlasitá, ale funkce nefunguje.

### 4. N33: `mlain_migrator` nemá právo zakládat rozšíření

**Kde:** `docker/initdb/10-roles.sql` dává jen `ALTER SCHEMA public OWNER TO mlain_migrator`,
grant na databázi v souboru není. Migrace `packages/db/migrations/0000_extensions.sql:5` přitom
zakládá `citext`, `pg_trgm` i `btree_gin`.

V přibaleném Postgresu to projde náhodou, protože `POSTGRES_USER` je superuživatel. Grant si
doplňuje jen testovací harness (`packages/core/src/test-support/pg-harness.ts:355`).

**Proč to vadí:** na externím Postgresu, tedy u samohostitele s managed databází, **spadne
úplně první migrace** na `permission denied to create extension "citext"`. Instalace se
nedokončí. Chybí to zároveň v provozní dokumentaci: v `docs/operations/` se `GRANT CREATE ON
DATABASE` nevyskytuje, takže se z ní operátor nedozví, co má udělat.

### 5. P11-1: `contacts.is_sample` neexistuje a brána `sample` v rozpadu publika je natvrdo `false`

**Kde:** `packages/core/src/segments/audience.ts:53` (`sample: \`false\``) a `:57`
(`INERT_GATES = ['duplicate', 'sample']`). Sloupec `is_sample` ve schématu není.

**Proč to vadí:** rozpad publika ukáže u ukázkových kontaktů **nulu, přestože v publiku být
mohou**. Uživatel se z obrazovky nedozví, kolik ukázkových kontaktů kampaň zasáhne.
Vlastní ochrana „ukázkový kontakt nedostane ostrou kampaň" funguje jinou cestou (manifest plus
`source_ref`, nález P13-9 je opravený), takže tohle není únik ukázkových adres do kampaně,
ale **neměřicí ukazatel, který vypadá jako měřicí**. Test v P11 obě neměřicí brány drží na
nule, aby si je nikdo nespletl.

### 6. N77: prefix `demo-data:` žije na dvou místech, a jedno z nich se odvolává na neexistující důvod

**Kde:** `packages/core/src/campaigns/audience/sample-guard.ts:18` definuje vlastní
`SAMPLE_SOURCE_REF_PREFIX = 'demo-data:'`. Konvence P16 mezitím vznikla:
`packages/core/src/demo/manifest.ts:28` má `DEMO_SOURCE_REF_PATTERN` a `packages/core/src/demo/index.ts`
ji vyváží.

Komentář v `sample-guard.ts:13` až `16` tvrdí, že doména `packages/core/src/demo` v repozitáři
není. **To už neplatí**, takže obchvat přežil svůj důvod a nikdo si toho nevšiml.

**Proč to vadí:** dokud se konvence nemění, funguje obojí. Při první změně (třeba na
`sample-data:`) se konstanty rozejdou a **ochrana tiše přestane platit**: dotaz proběhne,
nikoho nevyloučí a ukázkové kontakty se dostanou do publika ostré kampaně. Oprava je dnes
jednořádková, import místo vlastní konstanty.

### 7. N42, bod 3: výmaz kontaktu, který nikdy nic neotevřel, projde sekvenčně všechny oddíly

**Kde:** index `packages/db/migrations/0003_partitioned_tables.sql:478` je částečný
(`WHERE first_open_at IS NOT NULL`), ale výmaz v
`packages/core/src/contacts/jobs/gdpr-sever-links.ts:82` filtruje jen podle
`(workspace_id, contact_id)`.

**Proč to vadí:** většina kontaktů v databázi nikdy nic neotevřela, takže se index na výmaz
nepoužije a dotaz projde všechny měsíční oddíly `message_engagement`. Výmaz podle článku 17 má
zákonnou lhůtu a na velké instalaci to je rozdíl mezi milisekundami a minutami. Není to chyba
správnosti, je to výkon na operaci, která musí doběhnout.

### 8. N63: `ANTHROPIC_AUTH_TOKEN` projde vstupním skriptem

**Kde:** `docker/entrypoint.sh:62` maže vzorem `*_API_KEY` a řádky `66` až `71` mažou šest
jmenovitých proměnných. `ANTHROPIC_AUTH_TOKEN` mezi nimi není a vzoru neodpovídá.

**Proč to vadí:** je to fallback proměnná Anthropicu, tedy přesně ta třída, kvůli které
kritérium 7b vzniklo. SDK po ní sáhne, když se klíč nepředá explicitně, a projekt bez
nakonfigurovaného klíče by **utrácel peníze provozovatele**. Druhá vrstva ji chytá
(`packages/core/src/ai/env-guard.ts`, `packages/core/src/ai/providers.ts:47`), takže dnes to
nic nepropustí, ale bezpečnostní pojistka stojí na jediné vrstvě.

### 9. N52: `content_snippets` je osiřelá tabulka bez verze schématu

**Kde:** `packages/db/src/schema/content.ts:446` až `463`. Tabulka existuje, žádný kód do ní
nečte ani nezapisuje (grep přes `packages/core/src` a `apps/web/src` nevrací nic než definici).
Sloupec `schema_version` nemá, přestože `templates` i `template_versions` ho mají.

**Proč to vadí:** dvě věci naráz. Sdílené bloky, kvůli kterým se zrušil druh šablony `snippet`,
dnes **neimplementuje nikdo**, takže ta funkce v produktu není. A až je někdo doplní, první
změna blokového modelu snippety tiše rozbije, protože bez `schema_version` nejde poznat, které
migrace nad `design` pustit.

### 10. P13-4: `sending_providers` nemá kam uložit stav žádosti o produkční přístup

**Kde:** sloupec `review_status` v `packages/db/src/schema/` neexistuje (grep vrací nula).

**Proč to vadí:** hodnota z AWS `GetAccount → Details.ReviewDetails.Status` projde kódem a
v `UPDATE` tiše zmizí. Preflight pak nedokáže uživateli rozlišit „žádost o produkční přístup
běží" od „žádost byla zamítnuta", což je u zablokovaného odesílání ten nejdůležitější rozdíl:
v prvním případě se čeká, ve druhém se musí jednat.

### 11. N48: sender nemá právo zapsat čas pozastavení kampaně

**Kde:** `packages/db/migrations/0009_maintenance_scan.sql:226` dává senderovi přesně
`GRANT UPDATE (status, pause_reason) ON campaigns`. Sloupce `paused_at` ani `updated_at` v tom
grantu nejsou.

**Proč to vadí:** po pauze od senderu zůstane `paused_at` prázdné a `updated_at` zastaralé.
`paused_at` je jediný indexovatelný čas pauzy, takže „kdy se to zastavilo" jde zjistit jen
parsováním `pause_reason ->> 'at'`. Každá cache nebo optimistický zámek nad `updated_at`
pauzu od senderu **přehlédne**, tedy bude tvrdit, že se kampaň nezměnila.

### 12. N56 a P12-6: kontrola slovníku hledá zakázané výrazy i ve jménech ICU slotů

**Kde:** `packages/i18n/src/checks/glossary.ts:133` až `146`. `findViolations` porovnává
zakázaný výraz proti celé hodnotě zprávy. Obsah složených závorek se neodstraňuje.

**Proč to vadí:** zpráva `"Pozvánka do projektu {workspace}"` je česky správně a slovník
neporušuje, protože slovo „workspace" uživatel nikdy neuvidí. Kontrola ji přesto označí a
`ci:i18n-check` **shodí build na správně napsaném textu**. Je to past pro každý další plán
s obrazovkou: příště se to projeví jako červené CI, které vypadá jako chyba v překladu.
Oprava je jeden `replace(/\{[^}]*\}/g, ' ')` před porovnáním.

### 13. N57: položku „Projekt" v navigaci prohlížející neuvidí

**Kde:** `packages/ui/src/patterns/navigation/registry.ts:291` až `294`, položka
`settings-general` má `permission: 'workspace:update'`.

**Proč to vadí:** obrazovku Projekt má podle zadání vidět každý člen, jen bez práva zápisu se
vykreslí jako stav „jen pro čtení". S dnešním registrem se k ní prohlížející z menu vůbec
nedostane a jedinou cestou zůstane ručně napsaná URL. **Implementovaný a otestovaný stav
„jen pro čtení" se tím prakticky nikdy nezobrazí.** Návrh je změnit na `workspace:read`, zápis
už řídí obrazovka sama.

### 14. N30 (řádek 726): Centrum úloh nemá stránku a komponentu nikdo nevykresluje

**Kde:** `packages/ui/src/patterns/jobs/` obsahuje `jobs-center.tsx` i `jobs-badge.tsx`, ale
v `apps/web/src` se `JobsCenter` ani cesta `jobs/` nevyskytuje ani jednou. Stránka
`/w/{slug}/jobs/...` v `apps/web/src/app` neexistuje.

**Proč to vadí:** dlouhé operace (import, materializace publika) nemají kde ukázat průběh.
Komponenta je hotová a zaplacená, jen není zapojená. Souvisí s tím, že si domény mají svůj
zdroj postupu zaregistrovat; dokud stránka není, nepozná se, jestli registraci doplnily.

### 15. N29 (řádek 710), N32 (řádek 861), N35 a N64: kódy, které API vydává a registr je nezná

**Kde:** `packages/core/src/errors/validation-codes.ts` je uzavřený seznam. Chybí v něm mimo
jiné `password_too_short` (vydává `packages/core/src/identity/password.ts:107`),
`unknown_scope` (`identity/api-key-service.ts:78`), `not_a_member`
(`identity/workspace-service.ts:559`), `invalid_cursor` (`reports/cursor.ts:24` a další tři
místa), `liquid_literal_not_supported` (`packages/contracts/src/liquid/validator.ts:323`)
a tři AI kódy z nálezu N64 (`ai_base_url_not_allowed`, `ai_base_url_required`,
`ai_custom_base_url_disabled`).

**Proč to vadí:** registr měl být jediný uzavřený zdroj pravdy o chybových kódech a dnes jím
není. Za běhu nic nespadne, ale `isRegisteredCode()` na tyhle kódy vrátí `false`, takže
konformanční test kteréhokoli plánu, který se registru zeptá, **spadne z falešného důvodu**.
A klient, který si podle registru staví překlady chybových hlášek, na ně nemá text.

### 16. N28 (řádek 779): nálezy DNS kontrol mají dvě jmenné soustavy

**Kde:** `packages/core/src/providers/dns/spf.ts:25` a `:36` emitují `spf_missing`, kdežto
registr vede `domain_spf_missing` (`packages/core/src/errors/problem-codes.ts:564`, `:1196`)
a katalog hlášek má text jen pro prefixovanou verzi
(`packages/core/src/errors/detail-catalog.ts:88`, `:257`).

**Proč to vadí:** tentýž nález má dvě jména a jen jedno z nich má přeloženou hlášku. Kde se
zobrazí neprefixovaná verze, dostane uživatel **holý kód místo věty**. Rozhodnout je potřeba
jedno: buď DNS kontroly přejdou na prefixovaná jména, nebo se prefix z registru zruší.

### 17. N31 (řádek 848): fronta `tracking.erase_contact` nemá producenta ani obsluhu

**Kde:** `packages/core/src/queues/registry.ts:1130`. Grep přes `packages/core/src`,
`apps/worker/src` a `apps/web/src` nenajde jediné další použití; v `tracking/jobs/` handler není.
Vlastní výmaz stopy kontaktu dnes dělá synchronně `contacts/jobs/gdpr-sever-links.ts`.

**Proč to vadí:** registr front tvrdí něco, co v produktu není. Worker u takové fronty hlásí,
že nemá obsluhu, a provozovatel to má číst jako poruchu. Buď fronta ven z registru, nebo se
výmaz stopy má přesunout do ní, protože je dlouhý a přerušitelný.

### 18. N66: registr front přisuzuje `tracking.refresh_campaign_progress` špatnému vlastníkovi

**Kde:** `packages/core/src/queues/registry.ts:1046` až `1048` má `owner: 'P14'`. Obsluha ale
existuje pod trackingem (`packages/core/src/tracking/jobs/refresh-campaign-progress.ts`)
a je zaregistrovaná (`tracking/jobs/queue-handlers.ts:91`).

**Proč to vadí:** dnes nic, protože handler existuje. Je to nepravdivý údaj o vlastnictví,
který při příštím úklidu front svede z cesty: kdo bude hledat vlastníka, půjde do reportů,
kde ten job podle vlastního testu ownership být nesmí.

### 19. N53: `templates.design_hash` nemá kontrolu délky v databázi

**Kde:** `packages/db/src/schema/content.ts:141` a `:192` jsou `bytea().notNull()` bez CHECK.
Srovnávací případ je hned vedle: `assets.sha256` má `ck_assets__sha256_len` (`:53`).

**Proč to vadí:** hash o špatné délce se dá zapsat jinou cestou, než jde router. Router i
repository si délku hlídají, takže dnes je to poslední pojistka, ne první. Doplnit
`octet_length(...) = 32` je jeden řádek.

### 20. N69: nad `campaigns.started_at` není index

**Kde:** `packages/db/src/schema/campaigns.ts` má tři indexy nad `campaigns` a žádný
podle `started_at`.

**Proč to vadí:** přehled projektu podle něj filtruje období i řadí poslední kampaně a je to
nejčastěji otevíraná stránka produktu. V MVP 0 se to nepozná, s počtem kampaní roste.

### 21. P07-6, bod 2: fronta kontroly oslovení má indexovanou jen jednu ze dvou větví

**Kde:** `packages/db/migrations/0001_core_tables.sql:1356` je částečný index nad
`(workspace_id, first_name_key, created_at)`. Obdoba nad `last_name_key` chybí.

**Proč to vadí:** jen výkon větve podle příjmení. Bod 1 téhož nálezu (bezdiakritické hledání
bez indexu) **je opravený**, `idx_contacts__search_key_trgm` existuje (`:1354`).

### 22. N75: role `mlain_backup` zůstala bez použití

**Kde:** `docker/initdb/10-roles.sql:27` a `:80` ji zakládají a dávají jí `pg_read_all_data`,
tedy ne `BYPASSRLS`. Záloha se přitom pouští pod migrátorem a chrání ji pojistka
`packages/core/src/ops/backup-guard.ts`.

**Proč to vadí:** ve schématu leží mrtvý objekt, který **svádí k použití**. Kdo ho použije,
dostane buď padající zálohu, nebo, po „opravě" přepínačem `--enable-row-security`, tiše
prázdný dump. Buď roli dát `BYPASSRLS`, nebo ji zrušit.

### 23. P13-3: komentář u `campaign_links.position` tvrdí opak toho, co v tabulce je

**Kde:** `packages/db/src/schema/campaigns.ts:415` říká „pořadí výskytu v HTML, od 0“.
Kompilace vyrábí `1..N` (`packages/emails/src/compile/links.ts:60`) a invariant to vynucuje
(`packages/emails/src/compile/invariants.ts:86`).

**Proč to vadí:** nic nespadne, sloupec žádný CHECK nemá. Druhý čtenář ale podle komentáře
napíše dotaz s `position = 0` a dostane prázdný výsledek.

### 24. N54: komentář u `campaign_links.url` slibuje Liquid, který tam nikdy nebude

**Kde:** `packages/db/src/schema/campaigns.ts:414` říká „původní URL, může obsahovat Liquid".
Kontrakt garantuje opak (`packages/emails/src/compile/types.ts:92`: „Absolutní statická URL,
nikdy neobsahuje Liquid výraz").

**Proč to vadí:** kdo si přečte komentář, začne v tom sloupci ošetřovat případ, který nemůže
nastat. Je to práce navíc a další místo, které se může rozejít.

---

### Vedlejší nález, který v původním souboru není

**Pravidlo ESLintu `no-disabled-primary-action` z `packages/ui/eslint-rules/` není nikde
zaregistrované.** Kořenový `eslint.config.js` importuje jen
`packages/core/eslint-rules/no-raw-fetch-in-brand.cjs`. Pravidlo včetně vlastního testu a
allowlistu tedy existuje a **nikdy se nespustí**. Souvisí to s nálezem N29 o kruhové
registraci (ten je jinak opravený): kruhovost zmizela tak, že se pravidlo z `packages/ui`
přestalo registrovat úplně.

---

## OPRAVENO (65)

Doloženo v kódu, není potřeba nic dělat.

**Schéma a data:** N1 (`campaign_links.id` bez `uuidv7()` defaultu), N12 (zápis události má
`source`, idempotence stojí na `WHERE NOT EXISTS`), N13 (`rank` je generovaný, sender píše do
`campaign_render_warnings`), N14 a N-P03X/6 (sender jede na skutečných migracích
z `packages/db/migrations`, ruční replika zmizela), N21 (materializace plní `created_at`
z `audience_built_at`), N22 (`webhook_deliveries.created_at` bez defaultu, `inbound_dedup`
má `delivery_created_at` i `workspace_id` v PK), N23 (`clock-skew.ts` ořezává `occurred_at`),
N25 (nikde se neadresuje oddíl jménem), N65 (`ON CONFLICT (workspace_id, campaign_id, bucket_at)`),
P13-1 (`campaigns.compile_meta` existuje), P13-2 (migrace 0010 zavádí `audience_campaign_id`,
testovací odeslání z draftu projde), N-P03X/1, /2, /3, /4, /8.

**Role, granty a izolace:** N7 (`backup-guard.ts` plus běh pod migrátorem), N28 (řádek 673:
politiky `api_key_lookup`, `ws_api_key_lookup` i `invitation_token_lookup` jsou v migraci 0004),
N24 (doctor volá `checkIsolationPrerequisites`, obnova volá `applyGrants`,
`secret_key_generations` existuje), P07-4 (`PoolKind: 'gdpr'` a `withGdpr`).

**Struktura balíčků:** N42 (řádek 157) a P07-1 (všechno leží pod `packages/core/src/`),
P13-8, N71 (tracking je v `src/`), P12-3 a P12-5 (mapa `exports` má explicitní vzory
`./identity/*`, `./ai/*` a další, hluboké podcesty se rozřeší), P13-7 (`isMailable` existuje),
P07-5 (`writeAuditLog`, `emitWebhookEvent`, `keyringFromEnv`, `buildToken`, `withWorkspace`,
`ApiError` existují pod skutečnými jmény), N-P03X/5, /9, /10.

**Kontrakty a renderer:** N2 (jediný kontrakt značek v `packages/contracts/src/markers.ts`),
N10 a N43 (řádek 169: kompilace vrací `clickMarkerCount` i identifikátory odkazů), N41
(řádek 124: `prepareRenderData` se v materializaci volá, sender má `RequirePresence`),
N47, N49 (`RAW_SLOT_PATTERN` sedí na nonce), N50 (`PreparedDataSchema`), N62
(`baseSectionSpecSchema` je `z.discriminatedUnion`), N37, N38, N39.

**CI, licence, CLI:** N15 (jmenné výjimky v `licenses.allow.json`), N16, N19 (kořenový `lint`),
N26 (test čte kontraktní SQL ze souborů), N29 (řádek 953: ESLint bez kruhu), N32 (řádek 1032:
`contracts-golden` pouští skutečné skripty), N34 a N45 (job má `DATABASE_URL_MIGRATOR`),
N46, N73 (osm příkazů má větve v dispatcheru), N74 (vnořené zápisy do jsonb používají `||`),
N76 (rotace čte `workspace_id`), P13-5 (retence běží přes `mlain partitions` pod migrátorem).

**Aplikace:** N29 (řádek 811: `isRegisteredCode`, `ALL_REGISTERED_CODES`), N59 (`DataTable`
se v `apps/web` používá 44krát), N61 (`index_state` se zapisuje i čte), N67 (kontext je všude
`c.get('auth')`), P11-3 (`upsertContacts(ctx, input, tx?)`), P11-4 (`actorUserId`), P12-1
(`POST /templates/{id}/test-send`), P12-2 (`preview_data` s variantou `no_name`), P13-9.

## BEZPŘEDMĚTNÉ (20)

Týká se kódu nebo rozhodnutí, které už neexistuje.

- **N4** fixture `LQ-051` v `packages/contracts/fixtures/liquid/` není.
- **N8** uzavřel nález P13-9: sloupec se nezakládá, ukázkovost drží manifest plus `source_ref`.
- **N9** a **N27** jsou systémové nálezy o souběžném psaní plánů; oba průchody proběhly.
- **N30** (řádek 828) fronta `stats.compact` nikde není a slévání bloků se nedělá.
- **N30** (řádek 966) sjednocení `packages/ui` proběhlo, kořenový import `.` v mapě `exports` není.
- **N33** (řádek 878) `packages/db/src/index.ts` je vědomý vstupní bod, ne doménový barrel.
- **N34** (řádek 900) `packages/emails` na `@mlain/i18n` nesahá, hrana v grafu je navíc.
- **N36**, **N40** týkají se tvaru Go runnerů, které P02 přepsal.
- **N51** je evidence proti opakovanému nálezu, ne vada.
- **N58** `JobSummary` nemá `kind`, ale Centrum úloh se nikde nevykresluje (viz PLATÍ, bod 14).
- **N70** granularita bloků: slévání do hodinových neexistuje, `tracking.enforce_retention`
  je z registru vyřazená (`packages/core/src/queues/registry.ts:1103`).
- **N72**, **P07-2**, **P11-6** testovací harness: `packages/core` má vlastní
  `src/test-support/pg-harness.ts` s jedním kontejnerem na běh, podcesta v `@mlain/db` už není
  potřeba. Doménová repository leží v `packages/core/src/<domena>/repo/`.
- **P07-3**, **P13-6** `test:db` v `packages/core`: `vitest.config.ts` bere `src/**/*.test.ts`
  a `globalSetup` startuje databázi, takže databázové testy běží pod `test:unit`.
- **P11-5** `users.preferences`: operace „odložit skupinu" neexistuje,
  `vocative-review/actions.ts` má čtyři akce a žádná nezapisuje uživatelské předvolby.
- **N-P03X/7** job `contracts-schema` už nevynucuje repliku, protože replika neexistuje.

## NEOVĚŘITELNÉ (6)

Týkají se znění specifikace nebo řídicího dokumentu, ne kódu, takže se z repozitáře rozhodnout
nedají. Kdo je bude zavírat, musí otevřít ty texty.

- **N5** vzor pro rody v kapitole o lokalizaci (část 6, 12.3).
- **N6** kritéria 16 a 18 části 6.
- **N11** testovací vektory tokenů v částech 1 a 4b.
- **N31** (řádek 1010) slovník 9.2 části 6 a slovo „Personalizace"; strana kontroly je hotová.
- **N43** (řádek 1546) akceptační kritérium 60 části 5.
- **P12-4** odhad rozsahu P12 v `2026-07-31-rozdeleni-implementacnich-planu.md`.

## Přeskočeno (7)

Nálezy, které mají v původním textu UZAVŘENO a neposuzovaly se: **N3**, **N17**, **N18**,
**N20**, **N28** (řádek 912), **N41** druhý výskyt, **N55**.
