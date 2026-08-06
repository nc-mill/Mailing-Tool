# P10 Tracking: revize souladu s databázovým schématem P03

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Revize plánu P10 (tracking) z prověrky plánů
> (31. 7. až 1. 8. 2026), tedy kontrola **textu plánu před stavbou**, ne kontrola kódu.
> **Verdikt typu „plán není proveditelný" se týkal tehdejšího plánu, ne dnešního produktu.** Ten stojí a funguje.
> Opravy se prováděly podle `docs/superpowers/plans/POSTUP-OPRAV.md`; **stav jednotlivých nálezů neověřen**.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

**Recenzovaný plán:** `docs/superpowers/plans/2026-07-31-p10-tracking-tokeny-sdk.md` (12663 řádků)
**Zdroj pravdy pro schéma:** `docs/superpowers/plans/2026-07-31-p03-databaze-schema-rls.md`
**Datum revize:** 2026-08-01
**Zaměření:** chybějící sloupce a tabulky, neshody typů, jmen a slovníků, chybějící granty, chybějící primitiva, dvojí vlastnictví.

Každý nález je ověřený grepem přímo v P03, ne jen proti digestu. U nálezů, které se ukázaly jako plané, je to uvedeno v sekci „Co jsem ověřil jako v pořádku".

---

## Verdikt

**Plán není proveditelný v současné podobě.** Pět kritických nálezů, z toho tři způsobí tvrdou chybu při prvním použití a dva vedou k tichému nulovému výsledku, což je horší, protože se pozná až po měsících provozu.

Rozdělení nálezů podle toho, na čí straně je oprava:

- **Oprava v P10** (3 nálezy): K1 částečně, K3, N2. Plán čte a zapisuje hodnoty, které schéma nezná.
- **Oprava v P03** (6 nálezů): K2, K4, K5, D1, D2, D3.
- **Rozhodnutí mezi plány** (3 nálezy): K1 (kdo dodá `recipient` a `rank`), D4 (sloupec versus náhradní tabulka), D5 (kdo píše čtyři osiřelé sloupce).

Doporučené pořadí řešení: nejdřív K4, protože bez cross-workspace mechanismu nemá smysl řešit nic dalšího a jeho volba ovlivní i K5 a D2. Pak K1 až K3, které jsou lokální. D1 a D3 jsou blokery pro první commit, ale mají jednoznačné řešení.

---

## Potvrzení nálezů z revize P03

Tým se ptal na dva konkrétní nálezy z revize plánu P03. Oba potvrzuji, jeden s upřesněním.

### Potvrzeno bez výhrad: `message_events` bez `recipient`, `rank` a `source`

Sedí přesně. Viz nález K1 níž. `INSERT` v Tasku 14, Step 3 vyjmenovává jedenáct sloupců a ani jeden z těch tří tam není. P03 je má všechny jako `NOT NULL` bez `DEFAULT` (řádky 4131, 4137, 4140). První otevření i první proklik skončí chybou `23502 null value in column "recipient" violates not-null constraint`.

Přidávám k tomu jedno zjištění navíc, které samotný nález nezmiňuje: P10 hodnotu pro `recipient` nemá odkud vzít. `selectMessageExact` a `selectMessageNear` v Tasku 8, Step 3 (řádky 1601-1610 a 1622-1632) čtou z `messages` jen `id, created_at, campaign_id, contact_id, workspace_id, sent_at`. Sloupec `email` mezi nimi není. Oprava K1 proto znamená zásah do dvou úkolů, ne do jednoho.

### Potvrzeno s upřesněním: `ON CONFLICT (id, received_at) DO NOTHING` je mrtvý kód

První polovina tvrzení sedí úplně. `received_at` do `INSERT`u nejde, doplní se `DEFAULT now()` (P03 řádek 4141), takže je pokaždé jiné a konfliktní cíl nemůže nikdy sepnout. Je to přesně ta past, kterou P03 sám popisuje o pár řádků výš u `provider_event_receipts`: „received_at je now(), tedy u každého doručení jiné, takže samotný ON CONFLICT by NIKDY nesepnul" (řádky 4207-4211).

Druhá polovina, tedy že opakovaný běh vyrobí duplicity, platí, ale příčina je ještě o krok dřív. `flushTrackingBuffer` v Tasku 14, Step 5 (řádek 4920) generuje `id: uuidv7()` při každém volání znovu. I kdyby se `received_at` posílalo explicitně a bylo stabilní, opakovaný flush téže dávky by vyrobil duplicity, protože by měl jiná ID. `ON CONFLICT` tedy není jen neúčinný, on by nepomohl ani po opravě.

Praktický důsledek: idempotence `insertMessageEvents` stojí výhradně na tom, že `RETURNING id` vrací počet skutečně vložených řádků, ze kterého se pak počítají přírůstky do `campaign_stats`. To je samo o sobě v pořádku a komentář u funkce to popisuje správně. Není v pořádku komentář u testu na řádku 2576 („zápis dávky do message_events proběhne jedním příkazem a je idempotentní"), který slibuje ochranu proti opakovanému zápisu, jakou ten kód nemá.

**Navrhovaná oprava:** buď se `ON CONFLICT` vypustí a idempotence se přizná jako neexistující na úrovni tabulky (což je obhajitelné, protože buffer je v paměti a jeho ztráta znamená ztrátu události, ne její zdvojení), nebo se ID události odvodí deterministicky z dvojice zpráva a čas, například UUIDv5 nad `(message_id, message_created_at, type, ts, link_id)`. Druhá varianta je konzistentní s tím, co P08 dělá u `campaign_links.id`, a dala by `ON CONFLICT` smysl. Vyžadovala by ale i explicitní `received_at`.

---

## KRITICKÉ nálezy

### K1. `insertMessageEvents` nevyplňuje tři NOT NULL sloupce

**Kde:** Task 14 („Zpracování otevření a zápis do `message_events`"), Step 3, `packages/core/tracking/repo/message-events.repo.ts`, řádky 2634-2650. Navazuje Task 14, Step 5, `writer/flush.ts`, řádky 4917-4945.

**Co plán dělá:**

```sql
INSERT INTO message_events (
  id, workspace_id, message_id, message_created_at, campaign_id,
  contact_id, type, subtype, ts, link_id, metadata)
```

Typ `MessageEventInsert` (řádky 2613-2626) `recipient`, `rank` ani `source` nedeklaruje a `flush.ts` je nesestavuje. Grep přes celý plán: slovo `recipient` se v P10 nevyskytuje ani jednou (jediný výskyt je `/recipients` v odstavci o rozsahu P14 na řádku 31), slovo `rank` vůbec.

**Co P03 má:** řádky 4131, 4137, 4140:

```sql
recipient  text     NOT NULL,
rank       smallint NOT NULL,
source     text     NOT NULL,
CONSTRAINT ck_message_events__source
  CHECK (source IN ('ses_sns','smtp','internal','tracking')),
```

Žádný z nich nemá `DEFAULT`.

**Proč to vadí:** první otevření pixelu i první proklik skončí chybou 23502. Není to hraniční případ, je to úplně základní cesta celé domény. Navíc `recipient` živí index `idx_message_events__recipient_bounce` (P03 řádky 4172-4174), na kterém stojí rozhodování o suppression podle historie adresy, takže ho nelze jen zrušit.

**Navrhovaná oprava:** rozhodnout mezi dvěma variantami.

1. Oprava v P10 (doporučeno pro `source`): do `MessageEventInsert` přidat `recipient: string`, `rank: number` a `source: 'tracking'`. Do `SELECT` v Tasku 8, Step 3 přidat `email AS "recipient"`. Hodnotu `rank` vzít z registru pořadí událostí, který vlastní P13.
2. Oprava v P03 (přijatelná pro `rank` a `source`): `source text NOT NULL DEFAULT 'internal'` a `rank smallint NOT NULL DEFAULT 0`. U `recipient` to nejde, protože prázdný řetězec by rozbil index bounců.

Prakticky nejčistší je kombinace: P03 dá default na `rank` a `source`, P10 doplní `recipient` z `messages.email`.

---

### K2. GDPR výmaz mění `web_events.properties` a `context`, na které mlain_app nemá GRANT

**Kde:** Task 39 („Hooky pro GDPR a slučování kontaktů"), Step 3, `packages/core/tracking/privacy/erase.ts`, řádky 9521-9535.

**Co plán dělá:**

```sql
UPDATE web_events
   SET contact_id = NULL,
       erased_at = now(),
       properties = properties - ${piiKeys}::text[],
       context = context - ${piiKeys}::text[] - 'ip'
 WHERE (id, received_at) IN (...)
```

**Co P03 má:** migrace 0006, řádky 5348-5349:

```sql
REVOKE UPDATE, DELETE ON web_events FROM mlain_app;
GRANT  UPDATE (contact_id, identity_merge_id, erased_at) ON web_events TO mlain_app;
```

**Proč to vadí:** hook `tracking.erase_contact` je jediná cesta, jak z uložených událostí odstranit PII v `properties` a IP adresu v `context`. Dnes skončí na `42501 permission denied for table web_events` a výmaz podle čl. 17 GDPR neproběhne vůbec, protože celá funkce běží v jedné transakci. Zvlášť pikantní je, že Task 38 („Soukromí, IP adresy a odvozená země") IP do `context` ukládat umí a Task 39 ji odtud odstranit neumí.

Kontrolní test v Tasku 47, Step 1 (řádek 12471) na tenhle mechanismus spoléhá a ověřuje, že `UPDATE web_events SET name` selže na oprávnění. To po opravě platit musí dál, takže se nesmí sáhnout k plnému `GRANT UPDATE`.

**Navrhovaná oprava:** v P03 rozšířit sloupcový grant:

```sql
GRANT UPDATE (contact_id, identity_merge_id, erased_at, properties, context)
  ON web_events TO mlain_app;
```

Zúžení jen na `properties` nestačí, protože `context.ip` a `context.country` zavádí Task 38 a čl. 17 se vztahuje i na ně.

---

### K3. Slovník `message_events.type`: P10 čte hodnoty, které v CHECKu nejsou

**Kde:** Task 34 („Rollup na kontakt a události od providera"), Step 4, `packages/core/tracking/jobs/process-provider-events.ts`, řádky 8267 a 8289-8294.

**Co plán dělá:**

```sql
AND e.type IN ('delivered', 'bounce', 'complaint', 'unsubscribe')
```

a dál v TypeScriptu:

```ts
if (row.type === 'bounce') {
  if (row.subtype === 'hard') entry.bouncedHard += 1;
  else entry.bouncedSoft += 1;
}
if (row.type === 'complaint') entry.complained += 1;
```

**Co P03 má:** řádky 4146-4149:

```sql
CONSTRAINT ck_message_events__type CHECK (type IN (
  'sent','rejected','delivered','delivery_delayed',
  'bounced_hard','bounced_soft','complained','render_failed',
  'open','click','unsubscribe','circuit_breaker_open')),
```

Hodnoty `bounce` ani `complaint` ve slovníku nejsou. Tvrdost bounce nese samotný typ, ne `subtype`. Rozhodnutí R5 v P03 (řádek 20 digestu) tenhle výčet výslovně označuje za sjednocení všeho, co kterákoliv část deklaruje, že zapisuje.

**Proč to vadí:** job `tracking.process_provider_events` nikdy nezapočítá jediný bounce ani stížnost. `campaign_stats.bounced_hard`, `bounced_soft` a `complained` zůstanou trvale nulové, stejně jako `contact_engagement.last_bounce_at` a `bounces_total`. Nic nespadne, jen se tiše nepočítá. Najde se to až v reportu kampaně, kde bude tvrdých bounců nula u kampaně, která jich měla tisíc.

**Navrhovaná oprava:** v P10 opravit filtr i větvení:

```sql
AND e.type IN ('delivered','bounced_hard','bounced_soft','complained','unsubscribe')
```

```ts
if (row.type === 'bounced_hard') entry.bouncedHard += 1;
if (row.type === 'bounced_soft') entry.bouncedSoft += 1;
if (row.type === 'complained') entry.complained += 1;
```

---

### K4. Neexistuje způsob, jak splnit RLS u dotazů napříč projekty

**Kde:** základ na řádku 115 („Přístup k databázi jde přes primitiva z `@mlain/db`") a v integračním bodě na řádku 171. Dopad ve dvanácti úkolech.

**Co plán předpokládá:** řádek 115 tvrdí, že „transakci otevírá to primitivum a ono taky provádí `set_config('mlain.workspace_id', $1, true)`, takže RLS platí i pro dotazy této domény". Jenže `withSystemTx(fn)` žádný workspace nepřijímá a používá se ve čtyřiceti a více voláních. Šest z nich je z principu cross-workspace:

| Kde | Task, Step | Dotaz |
|---|---|---|
| `resolvePublicKey` | Task 25, Step 4, ř. 5090-5100 | `SELECT ... FROM api_keys JOIN workspaces` podle prefixu klíče |
| `selectAllTrackingDomains` | Task 19, Step 3, ř. 3461-3467 | `SELECT ... FROM tracking_domains` bez `WHERE`, „načte celou tabulku" |
| `handleRecomputeWindows` | Task 35, Step 3, ř. 8478-8510 | `contact_engagement` napříč všemi projekty |
| `handleEnforceRetention` | Task 37, Step 4, ř. 8940-8995 | `DELETE` ze šesti tabulek napříč projekty |
| `handleRebuildEngagement` | Task 35, Step 4, ř. 8540-8570 | `message_engagement` |
| `handleRefreshCampaignProgress` | Task 36, Step 3, ř. 8708-8770 | `campaigns`, `messages`, `campaign_stats` |

**Co P03 má:** `packages/db/src/repo/tx.ts` (řádky 5612-5686) nabízí tři primitiva. `withWorkspace(pool, ctx, fn)` nastavuje `mlain.workspace_id`, ale vyžaduje ho jako vstup. `withUser(pool, userId, fn)` nastavuje jen `mlain.user_id`, který v politice `ws_isolation` nefiguruje vůbec. `withReadOnly(pool, ctx, timeout, fn)` je pro náhled segmentu. Žádné čtvrté primitivum neexistuje.

Politika je (řádky 5064-5067):

```sql
CREATE POLICY ws_isolation ON %I
  USING      (workspace_id = current_setting('mlain.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('mlain.workspace_id', true)::uuid)
```

P03 u ní sám píše: „Zapomenuté nastavení kontextu tak vede k prázdnému výsledku, ne k úniku" (řádky 5028-5031). Role `mlain_app` nemá `BYPASSRLS`. Jediný bypass v celém schématu je `sender_bypass TO mlain_sender` na sedmi tabulkách (řádky 5136-5148), mezi kterými není ani jedna trackingová.

**Proč to vadí:** dva různě špatné důsledky.

`resolvePublicKey` je slepá ulička z principu. Workspace se dozvídáme teprve z řádku `api_keys`, takže ho nemáme čím nastavit předem. Bez něj neprojde jediný požadavek z web SDK, protože každý začíná ověřením veřejného klíče. To je tvrdé selhání celé domény.

Retenční, přepočtové a rekonstrukční joby nespadnou. Jen smažou a přepočtou nula řádků a napíšou do logu, že doběhly. Tabulka `identities` poroste do nekonečna, klouzavá okna se nikdy nepřepočítají a segmentace podle engagementu bude tiše vracet zastaralá čísla. Tohle je nejhorší varianta selhání, protože se pozná až po měsících.

**Navrhovaná oprava:** P03 musí dodat mechanismus a rozhodnout, který. Tři možnosti v pořadí, jak dobře zapadají do toho, co P03 už dělá:

1. **Politika `system_bypass` (doporučeno).** Nová role `mlain_job` a `CREATE POLICY system_bypass ON <tabulka> TO mlain_job USING (true) WITH CHECK (true)` na jedenácti trackingových tabulkách plus `web_events`, `message_engagement`, `messages`, `campaigns`, `contacts`, `api_keys` a `workspaces`. Je to přesně ten vzor, který P03 už použil pro `sender_bypass`, včetně odůvodnění, proč nesahat po `ALTER ROLE ... BYPASSRLS` (řádky 5121-5124).
2. **Session proměnná `mlain.system`.** Do `USING` každé politiky přidat `OR current_setting('mlain.system', true) = 'on'` a nastavovat ji smí jen kód v `packages/db`. Levnější na role, dražší na 63 politik, které by se musely přepsat.
3. **`ALTER ROLE mlain_job BYPASSRLS`.** P03 tuhle cestu u senderu odmítl jako příliš hrubou a vyžadující superuživatele. Stejné námitky platí i tady.

Ať se zvolí cokoliv, `api_keys` a `workspaces` v tom být musí, jinak veřejný klíč nedohledáme. Spolu s tím se musí do `PoolKind` přidat třetí hodnota, viz D3.

---

### K5. `GRANT DELETE ON web_events TO mlain_maintenance` je bez politiky nefunkční

**Kde:** požadavek P10 na řádku 168 („Role `mlain_maintenance` a `GRANT DELETE ON web_events` na ni") a poznámka v Tasku 37, Step 4 na řádku 8929 („Odpojení a smazání starých oddílů `web_events` dělá retenční mechanismus části 1").

**Co P03 má:** migrace 0005, řádky 5266-5277:

```sql
-- mlain_maintenance: retenční job. DELETE na web_events, aby šlo odpojovat
-- a mazat partition.
GRANT USAGE ON SCHEMA public TO mlain_maintenance;
GRANT DELETE ON web_events TO mlain_maintenance;
```

**Proč to vadí:** tři nezávislé důvody, každý sám o sobě stačí, aby ten grant nefungoval.

1. Politika `ws_isolation` na `web_events` nemá klauzuli `TO`, takže platí pro `PUBLIC`, tedy i pro `mlain_maintenance`. Ta roli žádný workspace kontext nenastavuje, protože pracuje napříč projekty. `current_setting` vrátí `NULL` a `DELETE` smaže nula řádků.
2. `DETACH PARTITION` a `DROP TABLE` vyžadují vlastnictví rodičovské tabulky. To má `mlain_migrator`, ne `mlain_maintenance`. Komentář u grantu tedy slibuje něco, co ta role udělat nemůže.
3. Role nemá `SELECT`, bez kterého `DELETE ... WHERE` nevyhodnotí podmínku.

**Navrhovaná oprava:** dvě čisté cesty, obě znamenají zásah do P03.

1. Role zůstane a dostane `GRANT SELECT ON web_events` plus politiku `maintenance_bypass ON web_events TO mlain_maintenance USING (true)`. Odpojování oddílů se přizná jako operace `mlain_migrator` a role dělá jen `DELETE` řádků uvnitř oddílu.
2. Role se zruší a retence `web_events` poběží jako migrační krok pod `mlain_migrator`. To je konzistentní s tím, že `dropPartitionsBefore` má povinný parametr `veto` a je součástí `packages/db`.

Souvisí s K4: pokud se zvolí obecný `system_bypass`, tenhle nález se vyřeší mimochodem.

---

## DŮLEŽITÉ nálezy

### D1. `sql` není na povrchu `@mlain/db` a `Tx` nemá metodu `.execute()`

**Kde:** dvacet souborů napříč plánem. Import `import { sql, withSystemTx } from '@mlain/db'` je na řádcích 1585, 2610, 3449, 5072, 6125, 6491, 6871, 7110, 7242, 7531, 8150, 8229, 8454, 8525, 8696, 8802, 8908, 9007, 9505 a 9930. Volání je vždy `tx.execute<T>(sql\`...\`)`.

**Co P03 má:** `packages/db/src/index.ts` (řádky 7001-7031) exportuje třicet jmen a `sql` mezi nimi není. `packages/db/src/repo/tx.ts` řádek 5604: `export type Tx = PoolClient`, tedy klient knihovny `pg` s metodou `.query(text, values)`, ne s `.execute()`.

**Proč to vadí:** neprojde ani `pnpm turbo run typecheck`, ani jediný test. Konvence 3.6 části 1 přitom zakazuje sáhnout si na drizzle mimo `packages/db`, takže P10 nemůže `sql` importovat přímo z `drizzle-orm` a nález obejít.

**Navrhovaná oprava:** v P03 doplnit `export { sql } from 'drizzle-orm';` do `src/index.ts` a změnit `Tx` na drizzle transakci, která `.execute()` má. Druhá varianta, tedy přepis všech dotazů P10 na `tx.query(text, params)`, znamená přepsat přes šedesát dotazů a ztratit typovanou interpolaci parametrů, takže je výrazně dražší.

---

### D2. Chybí šest indexů pro retenci a GDPR nad trackingovými tabulkami

**Kde:** Task 37, Step 4 (řádky 8940-8995) a Task 39, Step 3 (řádky 9540-9575).

| Dotaz P10 | Task, řádek | Co P03 má | Návrh indexu |
|---|---|---|---|
| `DELETE FROM identities WHERE contact_id IS NULL AND last_seen < ...` | T37, ř. 8944 | jen `idx_identities__contact` s `WHERE contact_id IS NOT NULL`, tedy přesný opak | `idx_identities__unbound_last_seen ON identities (last_seen) WHERE contact_id IS NULL` |
| `DELETE FROM identity_bindings WHERE created_at < ...` | T37, ř. 8946 | jen `idx_identity_bindings__lookup (workspace_id, anonymous_id, valid_from)` | `idx_identity_bindings__created ON identity_bindings (created_at)` |
| `DELETE FROM identity_bindings WHERE workspace_id AND contact_id` | T39, ř. 9561 | totéž, `contact_id` v indexu není | `idx_identity_bindings__contact ON identity_bindings (workspace_id, contact_id)` |
| `DELETE FROM identity_merges WHERE status='completed' AND created_at < ...` | T37, ř. 8958 | `idx_identity_merges__contact (workspace_id, contact_id, created_at)` | `idx_identity_merges__cleanup ON identity_merges (created_at) WHERE status = 'completed'` |
| slévání bloků `WHERE bucket_at < now() - 30 days` | T37, ř. 8969-8979 | PK `(campaign_id, bucket_at)`, vedoucí sloupec je kampaň | `idx_campaign_stats_buckets__bucket ON campaign_stats_buckets (bucket_at)` |
| `UPDATE message_engagement ... WHERE workspace_id AND contact_id AND erased_at IS NULL` | T39, ř. 9543 | `idx_message_engagement__contact` je částečný `WHERE first_open_at IS NOT NULL` | tentýž index bez té podmínky, nebo druhý s `WHERE erased_at IS NULL` |

**Proč to vadí:** poslední řádek tabulky je nejcitelnější. GDPR výmaz kontaktu, který nikdy nic neotevřel, tedy většiny databáze, projde sekvenčně všech 37 měsíčních oddílů `message_engagement`. `identities` je zároveň nejrychleji rostoucí trackingová tabulka, jeden řádek na prohlížeč, a noční retence ji projde celou.

**Navrhovaná oprava:** doplnit šest indexů do P03, kapitola 2.4 (`schema/tracking.ts`). Všechny jsou levné, žádný z nich nezpomaluje horkou cestu zápisu událostí.

---

### D3. Import historie potřebuje zakládat oddíly, což aplikační role nesmí

**Kde:** Task 41 („Serverové události a dávkový import historie"), Step 3 (řádky 10332-10339) a Step 4 (řádek 10405).

**Co plán dělá:** `POST /api/v1/events/import` volá synchronně z HTTP handleru `ensurePartitions: (months) => ensureMonthlyPartitions('web_events', months)`. Import sahá až `TRACKING_RETENTION_MONTHS` dozadu, výchozí hodnota je 37 měsíců. Chybějící oddíl vrací `tracking_import_partition_missing`.

**Co P03 má:** `createMonthlyPartitions(client, table, column, from: Date, months: number, storageOptions?)` (řádek 4647) a `ensureUpcomingPartitions(client, from, months)` (řádek 4681). Ani jedna nebere seznam měsíců. Obě volají `CREATE TABLE ... PARTITION OF`, což vyžaduje vlastnictví rodičovské tabulky, tedy roli `mlain_migrator`. `PoolKind` je `'app' | 'readOnly'` (řádek 5702), privilegované spojení v runtime neexistuje.

**Proč to vadí:** buď import historických oddílů nejde udělat vůbec, nebo se pod ním musí otevřít spojení pod rolí, kterou P03 nikde nedefinuje. Podpis funkce se navíc neshoduje, takže `@mlain/core/jobs` (P01) nemá co obalit.

**Navrhovaná oprava:** dvě varianty, doporučuji druhou.

1. P03 doplní `ensureMonthlyPartitionsFor(client, table, months: Date[])` a do `PoolKind` přibude `'migrator'`. Znamená to držet migrátorské spojení otevřené za běhu aplikace, což je bezpečnostní ústupek.
2. Zakládání oddílů se z požadavku vypustí úplně. Import selže s `tracking_import_partition_missing`, dokud noční `platform.maintain_partitions` oddíl nedozaloží. Kód pro to už existuje a je označený jako opakovatelný, takže stačí smazat volání `ensurePartitions` a upravit text chyby. Cena je zpoždění importu o jednu noc, což je u dávkového importu historie přijatelné.

---

### D4. Grant `UPDATE` na `message_events` musí zahrnout i `processed_at`

**Kde:** Task 34, Step 4, řádek 8331.

**Co plán dělá:** `UPDATE message_events SET processed_at = now() WHERE id = ANY(...)`.

**Co P03 má:** migrace 0006, řádek 5357: `GRANT UPDATE (contact_id, erased_at, recipient) ON message_events TO mlain_app;` po předchozím `REVOKE UPDATE, DELETE`.

**Proč to vadí:** samotný sloupec `processed_at` je už v evidenci jako známý nález. S ním se ale musí rozšířit i sloupcový grant, jinak bude sloupec v tabulce a aplikace ho stejně nepřepíše. Job by pak při každém běhu zpracoval tytéž události znovu a `campaign_stats.delivered` by rostlo donekonečna.

**Navrhovaná oprava:** pokud se zvolí sloupec, rozšířit grant na `GRANT UPDATE (contact_id, erased_at, recipient, processed_at)`. Pokud se zvolí náhradní tabulka `tracking_processed_events`, kterou by vlastnil P10, tenhle nález odpadá celý. Rozhodnutí patří P03 a P13, ne P10.

---

### D5. Čtyři sloupce v `campaign_stats` a `campaign_stats_buckets` nemá kdo zapsat

**Kde:** rekapitulace rozhodnutí P10, řádek 12643: „`tracking.refresh_campaign_progress` patří do P10, ne do P14. Je to zapisovač do `campaign_stats`, a ta tabulka musí mít jediného zapisovatele. P14 z ní jen čte."

**Co P03 má:** `campaign_stats.materialized` a `campaign_stats.skipped` (řádky 3187-3191), `campaign_stats_buckets.delivered` a `campaign_stats_buckets.bounced` (řádky 3222-3225).

**Co P10 zapisuje:** grep přes celý plán najde `materialized` a `skipped` nula krát. Do `campaign_stats_buckets` P10 píše `sent` (Task 36, ř. 8746), `opens_unique` a `clicks_unique` (Task 33, ř. 7776). Sloupce `delivered` a `bounced` plní jen noční slévání v Tasku 37 (ř. 8979), které ovšem jen sčítá to, co tam někdo předtím dal.

**Proč to vadí:** je to dvojí vlastnictví naruby, tedy nulové vlastnictví. Buď ty čtyři sloupce má psát někdo jiný, a pak tvrzení o jediném zapisovateli neplatí a je potřeba ho v plánu opravit. Nebo je má psát P10 a chybí mu na to úkol. Nebo v MVP 0 zapisovatele nemají a měly by ze schématu zmizet. Graf průběhu kampaně bez `delivered` a `bounced` je poloviční, což je věcná ztráta, ne kosmetika.

**Navrhovaná oprava:** doplnit `delivered` a `bounced` do bloků v Tasku 34, Step 4, kde se zpracovávají události providera a ta čísla tam už jsou spočítaná v mapě `counts`. U `materialized` a `skipped` rozhodnout mezi P09 (materializace publika je jeho práce) a zrušením sloupců.

---

## POZNÁMKY

### N1. `ON CONFLICT (id, received_at)` u `message_events`

Rozebráno výš v sekci s potvrzením nálezů. Task 14, Step 3, řádek 2648. Není to samostatný nález, je to důsledek K1.

### N2. Výmaz nechává `message_events.contact_id` vyplněné

**Kde:** Task 39, Step 3, `eraseContact`, řádky 9514-9575.

Funkce čistí `web_events` a `message_engagement`, na `message_events` ale nesáhne vůbec. P03 přitom dává grant `UPDATE (contact_id, erased_at, recipient)` právě na tuhle tabulku a `ck_message_events__subject` (řádky 4152-4158) je psaný přesně proto, aby vynulování `contact_id` prošlo. Komentář u toho constraintu to říká výslovně: „S `contact_id NOT NULL` by hook `tracking.erase_contact` skončil chybou 23514."

Po výmazu tak v `message_events` zůstane vazba osoba a událost, včetně sloupce `recipient` s e-mailovou adresou. To je věcná mezera v čl. 17, ne jen nesoulad se schématem.

**Navrhovaná oprava:** doplnit do `eraseContact` třetí dávkovou smyčku nad `message_events`, která nastaví `contact_id = NULL`, `erased_at = now()` a `recipient` na anonymizovaný tvar `erased+{contact_id}@erased.invalid`, konzistentně s rozhodnutím R3 v P03 pro `messages.email`.

### N3. Zdroj `server` se do `web_events` nikdy nezapíše

**Kde:** Task 41, Step 4, řádky 10380-10395 a Task 26, Step 3, řádek 5356.

`POST /api/v1/events` sdílí `createIngestService`, který natvrdo posílá `source: 'web'`. Hodnota `'server'` je v `EVENT_SOURCES` (řádek 363) i v `ck_web_events__source` (P03 řádek 4267), ale nemá zapisovatele. Není to rozpor se schématem, jen mrtvá položka slovníku, kvůli které nepůjde odlišit serverovou událost od prohlížečové.

**Navrhovaná oprava:** `createIngestService` má brát zdroj jako parametr, ne ho mít natvrdo.

### N4. Úklid osiřelých rollupů závisí na tom, co RLS zrovna pustí

**Kde:** Task 37, Step 4, řádky 8991-8994.

```sql
DELETE FROM contact_engagement ce
 WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = ce.contact_id)
```

Výsledek toho dotazu závisí na tom, kolik řádků `contacts` politika `ws_isolation` právě vidí. Až se vyřeší K4, je potřeba ho projít znovu: pod rolí, která `contacts` vidí jen částečně, smaže rollupy živých kontaktů. `contact_engagement.contact_id` má přitom `ON DELETE CASCADE` (P03 řádek 3120), takže ten dotaz nic neřeší a nejbezpečnější je ho vypustit.

### N5. Klasifikační masky a metriky sedí, ale stojí za kontrolu při implementaci

`OPEN_CLASS_BIT` v P10 (řádky 370-376) má pět hodnot `human: 1, proxy_apple: 2, proxy_image: 4, bot: 8, unknown: 16` a odpovídá komentáři u `message_engagement.open_class_mask` v P03 (řádek 4325). Výpočet `opens_unique_apple` v Tasku 33 (řádky 7896-7916) pracuje s maskou přes rovnost `=== OPEN_CLASS_BIT.proxy_apple`, tedy „zpráva má výhradně Apple otevření", a při přechodu na jinou třídu číslo odečítá. To je správně, ale je to jediné místo v celém plánu, kde se do agregátu zapisuje záporný přírůstek. Sloupec je `bigint`, tedy se znaménkem, takže schéma to unese. Stojí za samostatný test.

---

## Co jsem ověřil jako v pořádku

Tohle jsou body, které jsem prověřoval jako podezřelé a ukázaly se jako korektní. Uvádím je proto, aby je nikdo nemusel kontrolovat znovu.

**Jména událostí a zdroje projdou CHECKy.** `page_view` (ř. 4253), `email_opened` (ř. 7958) a `email_clicked` (ř. 7966) vyhoví `ck_web_events__name` s regexem `^[a-z][a-z0-9_]{0,63}$`. Zapisované zdroje `web`, `email` a `import` jsou ve výčtu `ck_web_events__source`.

**`ck_web_events__lag` sedí i pro import.** Živá cesta má `received_at = now()` a `occurred_at` po korekci hodin v okně, dávkový import má `received_at = occurred_at` (Task 32, Step 4, ř. 7315-7317) a je z CHECKu vyňatý podmínkou `source = 'import'`. Task 25 (`clock-skew.ts`, ř. 5047) na ten constraint dokonce explicitně odkazuje.

**`page`, `properties` a `context` pokrývají všechno, co P10 potřebuje uložit.** Typ `EventContext` (ř. 387-408) má `country`, `ip`, `browser`, `os`, `device`, `locale`, `timezone`, `campaign` i `clock_skew_ms`. Referrer je v `EventPage`. Surový `User-Agent` se neukládá nikam, jen jeho klasifikace, což je záměr Tasku 10 a 38.

**Chybějící GIN index nad `properties` nevadí.** Žádný dotaz P10 nefiltruje podle obsahu `properties`. Plán si to sám zakazuje na řádku 35 a formuluje to jako pravidlo pro každý úkol.

**`campaign_stats` nepotřebuje `opens_unique_bot` ani `opens_unique_proxy_image`.** Typ `CampaignStatsDelta` (ř. 7699-7710) počítá osm metrik a všechny osm ve schématu jsou. Třída `bot` se podle řádku 2132 do `message_events` neukládá vůbec, takže by neměla z čeho vzniknout.

**Otevření ani prokliky nepotřebují tabulku pro dedup.** Jednorázovost řeší strop v paměti (`CAP_PER_MESSAGE_AND_CLASS`, Task 14) a okno nad `message_engagement.last_open_at` (Task 33, Step 3, ř. 7620-7628). `identity_token_uses` s osmibajtovým nonce stačí pro `identify` a `ON CONFLICT (nonce) DO NOTHING` v Tasku 31, Step 3 nad primárním klíčem funguje správně.

**Úklid `identity_token_uses` nepotřebuje `mlain_maintenance`.** Job `tracking.cleanup_token_uses` (Task 37, Step 3) maže přes `mlain_app`, které má `DELETE ON ALL TABLES`, a tabulka je na whitelistu bez RLS. Tohle je jediná retenční operace P10, která by po opravě K4 fungovala i bez dalšího zásahu.

**`proxy_ranges` nepotřebuje další zdroj rozsahů.** Task 11 používá jen `apple_private_relay` (Task 37, Step 5, ř. 9047-9050) a ručně vložené `manual`. Hodnota `google` z výčtu se nepoužívá, ale to nevadí. Rozsahy se v MVP 0 plní hlavně ručně a Apple stahování je za přepínačem `TRACKING_APPLE_RELAY_RANGES` vypnuté.

**`web_event_months.subject_kind` v hodnotách `contact` a `anonymous` odpovídá.** Task 32, Step 4 (ř. 7333-7345) používá obě a měsíc počítá z `received_at`, ne z `occurred_at`, přesně jak P03 předepisuje. Test na řádku 7081 to hlídá.

**Sloupcový grant na `message_engagement` stačí.** `ON CONFLICT DO UPDATE` v Tasku 33, Step 3 (ř. 7657-7668) sahá na dvanáct sloupců, výmaz a reassign na `contact_id` a `erased_at`. Všech čtrnáct je v grantu, `campaign_id` ani `workspace_id` se nikde nemění. `SELECT ... FOR UPDATE` na řádku 7612 je taky v pořádku: PostgreSQL u něj vyžaduje `UPDATE` alespoň na jednom sloupci, což splněno je.

**Invariant `messages.created_at = campaigns.audience_built_at` platí.** Původně jsem `refresh_campaign_progress` (Task 36) označil za chybný, protože `messages.created_at` má v P03 `DEFAULT now()`. Ověřením v P03 (ř. 3349 a 6352) a P09 (ř. 3327) jsem zjistil, že materializace publika `created_at` nastavuje explicitně a je to invariant I1 s vlastním testem OB-13 v P02. Rovnostní dotaz je tedy správně a nález neplatí.

**Dohledání zprávy z tokenu je v pořádku.** `selectMessageExact` a `selectMessageNear` (Task 8, Step 3) čtou existující sloupce, obě složky primárního klíče používají a bezpodmínečný dotaz bez `created_at` se v plánu nikde neobjevuje.

**Regex veřejného klíče sedí.** `PUBLIC_KEY_BODY_RE = /^[a-z2-7]{16}$/` (Task 25, Step 4) odpovídá `ck_api_keys__prefix` v P03 (ř. 1358-1360), včetně base32 abecedy a délky pro `kind = 'public'`.

**Indexy pro horké čtecí cesty existují.** Kontrolní dotazy v Tasku 47, Step 1 se opírají o `idx_web_events__contact_occurred`, `idx_web_events__anon_occurred`, `idx_web_events__dedup`, `pk_web_event_months`, `idx_contact_engagement__ws_last_open` s `NULLS FIRST` a `idx_contact_engagement__stale_windows`. Všechny v P03 jsou a mají správný tvar včetně částečných podmínek.

---

## Souhrnná tabulka

| Co doplnit | Kdo žádá | Typ nebo tvar | Proč |
|---|---|---|---|
| `recipient`, `rank`, `source` do `INSERT INTO message_events`, plus `email` do `SELECT` z `messages` | P10 Task 14 Step 3, Task 8 Step 3 | tři NOT NULL sloupce bez defaultu | První otevření i proklik spadne na 23502 |
| `GRANT UPDATE (properties, context)` na `web_events` | P10 Task 39 Step 3 | rozšíření sloupcového grantu | Bez toho neproběhne GDPR výmaz PII z událostí |
| Oprava slovníku typů v P10 na `bounced_hard`, `bounced_soft`, `complained` | P10 Task 34 Step 4 | neshoda slovníku | Bounce a stížnosti se tiše nezapočítají |
| Cross-workspace mechanismus: role `mlain_job` s politikou `system_bypass` | P10 Task 19, 25, 35, 36, 37 | RLS politika plus primitivum `withSystemTx` | Veřejný klíč nejde dohledat, retence maže nula řádků |
| `SELECT` a politika pro `mlain_maintenance`, nebo zrušení role | P10 ř. 168, Task 37 | politika plus grant | Dnešní `GRANT DELETE` je bez politiky nefunkční |
| `export { sql }` z `@mlain/db` a `Tx` s metodou `.execute()` | P10, 20 souborů v `repo/` a `jobs/` | chybějící primitivum | Neprojde typecheck ani jediný test |
| Šest indexů pro retenci a GDPR (viz D2) | P10 Task 37 Step 4, Task 39 Step 3 | částečné a jednosloupcové indexy | Sekvenční průchod přes 37 oddílů při každém výmazu |
| `ensureMonthlyPartitionsFor(client, table, months[])`, nebo vypuštění zakládání oddílů z požadavku | P10 Task 41 Step 3 a 4 | primitivum plus oprávnění | `mlain_app` nesmí `CREATE TABLE ... PARTITION OF` |
| `processed_at` do sloupcového grantu na `message_events` | P10 Task 34 Step 4 | rozšíření grantu | Sloupec bez grantu nejde nastavit, job se zacyklí |
| Zapisovatel pro `campaign_stats.materialized`, `.skipped` a `campaign_stats_buckets.delivered`, `.bounced` | P10 ř. 12643, Task 34 Step 4 | dvojí vlastnictví | Čtyři sloupce zůstanou trvale nulové |
| Vynulování `contact_id` a `recipient` v `message_events` při výmazu | P10 Task 39 Step 3 | chybějící krok, grant už existuje | Po výmazu zůstane e-mailová adresa v událostech |
