# Revize P14 proti P03: soulad doménového plánu s databázovým schématem

**Recenzovaný plán:** `/Users/petr/Projects/Mailing_Tool/docs/superpowers/plans/2026-07-31-p14-reporty-dashboard-osa.md` (9722 řádků)
**Zdroj pravdy pro schéma:** `/Users/petr/Projects/Mailing_Tool/docs/superpowers/plans/2026-07-31-p03-databaze-schema-rls.md`
**Datum:** 2026-08-01
**Rozsah:** reporty kampaní, agregace, dashboard, časová osa kontaktu, SSE stream, endpointy `/api/v1/campaigns/{id}/stats`, `/recipients`, `/api/v1/contacts/{id}/timeline`, `/api/v1/dashboard`

Každý chybějící sloupec, index a export je ověřený grepem přímo v P03. Řádky u nálezů odkazují na P14, pokud není uvedeno jinak.

---

## Stav po opravě (2026-08-01)

Plán je opravený. Tahle sekce je doplněná po zapracování, původní text revize pod ní zůstává beze změny jako doklad, co se hledalo.

**Dodavatelé se mezi revizí a opravou změnili**, takže dva kritické nálezy zanikly samy a jeden se přesunul jinam:

| Nález | Stav | Co se mezitím změnilo |
|---|---|---|
| K1 slovník typů událostí | **opraveno v P14** | beze změny, `ck_message_events__type` platí dál |
| K2 chybějící sloupce ve fixturách | **opraveno jinak, než revize navrhovala** | P03 mezitím udělal `recipient` nepovinným s omezením jen pro doručovací rodinu a `rank` změnil na `GENERATED ALWAYS ... STORED`. Uvést `rank` v `INSERT` je proto nově **chyba**, ne jen zbytečnost. Doplňuje se `source` a u doručovací rodiny `recipient` |
| K3 typ `Tx` | **vyřešeno na straně P03** | P03 má `type Tx = NodePgDatabase<typeof schema>` (jeho R34), takže `tx.execute(sql...)` je správně. V P14 zůstalo odstranit zbytečné přetypování v testovací továrně |
| K4 chybějící exporty | **opraveno v P14** | `withoutContext` a `pgErrorCode` v P03 přibyly, `withWorkspaceId` nikdy neexistoval a existovat nemá: pool doplňuje adaptér `@mlain/core/tx` z P04 |
| K5 (nový) props komponent P05 | **opraveno v P14** | P05 rozhraní sjednotil, adaptéry byly psané proti komponentě `TimeSeriesChart`, která neexistuje |
| K6 (nový) cesty mimo `packages/core/src/` | **opraveno v P14** | konfigurace testů z P01 by doménu vůbec nespustila a série by prošla zeleně |
| D1 chybějící `rejected` | **do evidence** | vyžaduje sloupec v P03 a plnění v P10, P14 do agregací nesmí zapsat |
| D2 index nad `web_events` | **opraveno v P14** | dotaz přehledu se přepsal tak, aby použil existující `idx_web_events__contact_occurred` |
| D3 řazení příjemců | **opraveno v P14** | kurzor jde podle `contact_id`, což pokrývá `uq_messages__campaign_contact` |
| D4 index nad `campaigns.started_at` | **do evidence** | indexy vlastní P03 |
| D5 zpoždění u `message_events` | **opraveno v P14** | konstanta rozdělená na dvě, každá se svým zdrojem |
| N1 až N4, N6 | **opraveno v P14** | |
| D6 (nový) líné zakládání rollupu | **opraveno v P14** | `readTotals` a `bucketDrift` jely `FROM campaign_stats` jako řídicí tabulku. Řádek souhrnu zakládá až první běh jobu z P10, takže čerstvě odeslaná kampaň ho nemá a z přehledu by vypadla úplně. `bucketDrift` by u kampaně s bloky bez souhrnu ohlásil `matches: true`, tedy pravý opak skutečnosti. Obojí je nově `FROM campaigns` s `LEFT JOIN` a `COALESCE`, plus dva regresní testy |

**Nové nálezy, které oprava našla a které leží mimo P14**, jsou v `NALEZY-NAPRIC-PLANY.md` jako N65 až N71: nesedící `ON CONFLICT` nad bloky v P10, špatný vlastník fronty v registru P01, rozpor P04 versus P07 a P13 v proměnné kontextu Hono, chybějící `rejected`, chybějící index nad `started_at`, nerozlišitelná granularita bloků a doména P10 mimo `packages/core/src/`.

**Ověřeno spuštěním** (kód projektu zatím neexistuje, ověřovalo se nad plány): počty testů u všech 38 bloků sedí s počtem `it()` včetně adresářových běhů, nula dlouhých pomlček, nula zakázaných vzorů z 18 tříd, žádný `INNER JOIN` na líně zakládaný rollup, každý blok kódu má záznam v seznamu souborů svého úkolu.

**Prověřeno a nález tam není:** `campaigns.sent_at` plán nikde nepoužívá (všech sedm výskytů `sent_at` je `messages.sent_at`, který existuje; čas dokončení kampaně se čte z `finished_at`). `contact_engagement` plán nečte vůbec, je jen na seznamu tabulek, do kterých nesmí zapsat.

---

## Verdikt

**Plán není připravený ke spuštění.** Čtyři kritické nálezy blokují už první úkoly: preflight se zastaví na chybějících exportech, typová kontrola spadne na každém čtecím modulu, databázové fixtury spadnou na prvním INSERT a slovník typů událostí neodpovídá schématu.

Kvalita domény je přitom vysoká. Metriky, jmenovatele, klasifikace otevření, poctivé zacházení se smazaným kontaktem i pravidlo jediného zapisovatele jsou promyšlené a doložené testy. Problém není v návrhu reportu, ale v tom, že plán schéma nikdy nekonfrontoval: kapitola 7 (Požadavky na jiné plány) má osmnáct řádků směrem na P10, P13, P07, P05, P04, P01 a P16, a vůči P03 ani jeden.

Po opravě čtyř kritických nálezů (odhad půl dne) a doplnění tří indexů do P03 je plán proveditelný.

| Závažnost | Počet |
|---|---|
| KRITICKÉ | 4 |
| DŮLEŽITÉ | 5 |
| POZNÁMKA | 6 |

---

## KRITICKÉ

### K1. Slovník typů `message_events`: P14 používá `bounce` a `complaint`, schéma zná `bounced_hard`, `bounced_soft` a `complained`

**Kde v plánu:**
- Úkol 13, krok 3 (ř. 3045-3047), `recomputeCampaignCounts`:
  `count(DISTINCT message_id) FILTER (WHERE type = 'bounce' AND subtype = 'hard') AS bounced_hard`,
  `... FILTER (WHERE type = 'bounce' AND subtype IS DISTINCT FROM 'hard') AS bounced_soft`,
  `... FILTER (WHERE type = 'complaint') AS complained`
- Úkol 12, krok 3 (ř. 2615-2619), mapa filtrů příjemců: `bounced: ['bounce'], complained: ['complaint'], unsubscribed: ['unsubscribe']`
- Úkol 17, krok 3 (ř. 3834-3841), `EVENT_TYPE_MAP`: `bounce: 'message_bounced'`, `complaint: 'message_complained'`
- Úkol 17, krok 3 (ř. 3874): `AND e.type IN ('delivered', 'bounce', 'complaint', 'open', 'click', 'unsubscribe')`
- Úkol 12, krok 1 (ř. 2545), fixtura: `VALUES (gen_random_uuid(), ..., 'bounce', $7)`

**Co P03 má:** `ck_message_events__type CHECK (type IN ('sent','rejected','delivered','delivery_delayed','bounced_hard','bounced_soft','complained','render_failed','open','click','unsubscribe','circuit_breaker_open'))`, P03 ř. 4146-4149. Rozhodnutí R5 (P03 ř. 49) tenhle spor výslovně rozsoudilo ve prospěch slovníku části 4a a odmítlo návrh části 5 s hodnotami `bounce` a `complaint`. P14 si vzal odmítnutou variantu.

**Navržená oprava:** v P14, schéma je správně. Nahradit `type = 'bounce' AND subtype = 'hard'` za `type = 'bounced_hard'`, `type = 'bounce' AND subtype IS DISTINCT FROM 'hard'` za `type = 'bounced_soft'`, `'complaint'` za `'complained'`. Ve filtru příjemců `bounced: ['bounced_hard','bounced_soft']`. Podtyp `hard` a `soft` se u odrazu nerozlišuje sloupcem `subtype`, ale přímo typem.

**Proč to vadí:** fixtura s hodnotou `'bounce'` skončí chybou `23514 check_violation`, takže testy úkolu 12 nález odhalí. V provozu by ale `recomputeCampaignCounts` vracel nula odrazů a stížností, filtry „Odraženo" a „Stížnost" v seznamu příjemců by byly vždy prázdné a odraz by chyběl v časové ose kontaktu. Kontrola driftu by navíc tvrdila, že `campaign_stats` je špatně, ačkoli je správně.

---

### K2. Všechny `INSERT INTO message_events` v P14 vynechávají `rank`, `recipient` a `source`

**Kde v plánu:**
- Úkol 12, krok 1 (ř. 2543-2546)
- Úkol 17, krok 1 (ř. 3695-3698)

Obě fixtury zapisují:
```
INSERT INTO message_events
  (id, received_at, ts, workspace_id, message_id, message_created_at, campaign_id, contact_id, type, subtype)
```

**Co P03 má:** `recipient text NOT NULL`, `rank smallint NOT NULL`, `source text NOT NULL`, P03 ř. 4136-4142. Žádný z nich nemá `DEFAULT`. `source` navíc drží `ck_message_events__source CHECK (source IN ('ses_sns','smtp','internal','tracking'))`.

**Navržená oprava:** doplnit do obou fixtur `recipient` (adresa kontaktu), `rank` (0) a `source` (`'ses_sns'` u událostí od provideru, `'tracking'` u otevření a prokliků). Nepožadovat po P03 `DEFAULT 0` u `rank`: sloupec nese sémantiku pořadí události a tichá nula ji zamlží.

**Proč to vadí:** `23502 not_null_violation` na prvním INSERT. Testy úkolů 12, 13 a 17 nepůjdou spustit vůbec.

---

### K3. Typ `Tx` z `@mlain/db` je `pg.PoolClient`, ale všech 27 dotazů P14 volá `tx.execute(sql...)`

**Kde v plánu:** devět modulů importuje `import type { Tx } from '@mlain/db'` (ř. 1493, 1640, 2034, 2266, 2569, 2985, 3222, 3560, 3772, 4408, 4927, 5580) a všude píše `const { rows } = await tx.execute<Record<string, unknown>>(sql\`...\`)`. Testovací továrna v úkolu 8, kroku 1 (ř. 1500-1502) to sama obchází:
```ts
export function createTestTx(db: TestDatabase): Tx {
  return drizzle(db.pool) as unknown as Tx;
}
```
s komentářem „Čtecí funkce reportů používají jen `execute`".

**Co P03 má:** `packages/db/src/repo/tx.ts`, P03 ř. 5605: `export type Tx = PoolClient;`. `PoolClient` má metodu `query(text, values)`, metodu `execute` nemá a nepřijímá Drizzle šablonu `sql`.

**Navržená oprava:** rozhodnout jedním směrem a zapsat to do P03. Doporučená varianta: P03 změní `Tx` na Drizzle transakční handle (`NodePgDatabase<typeof schema>`) a `withWorkspace` předá `drizzle(client, { schema })` místo holého klienta. Kotví ji už `casing: 'snake_case'` a celé schéma v Drizzle, které by jinak nikdo nepoužil. Druhá varianta je přepis všech 27 dotazů P14 na `tx.query(text, params)`, ale ta zahodí typovou vazbu na schéma.

**Proč to vadí:** `pnpm typecheck` spadne na každém čtecím modulu balíčku `reports`. Přetypování `as unknown as Tx` chybu v testech skryje, ale produkční cesta přes `inWorkspace` dostane skutečný `PoolClient` a spadne až za běhu na `tx.execute is not a function`.

---

### K4. `withWorkspaceId`, `withoutContext` a kořenový export `schema` v `@mlain/db` neexistují

**Kde v plánu:**
- Kapitola 5, předpoklad E2 (ř. 311): „`@mlain/db` | `withWorkspaceId(workspaceId, fn)`, `withoutContext(fn)`, typ `Tx`"
- Úkol 1, krok 2 (ř. 353), preflight: `const need = ['schema','withWorkspaceId','withoutContext'];`
- Úkol 24, krok 3 (ř. 5581): `import { withWorkspaceId } from '@mlain/db'`
- Úkol 24, krok 3 (ř. 5611): `return withWorkspaceId(ctx.workspaceId, (tx) => fn(tx, ctx));`

**Co P03 má:** `src/index.ts` (P03 ř. 7011) exportuje `withReadOnly, withUser, withWorkspace, type Tx`. Signatura je `withWorkspace<T>(pool: Pool, ctx: WorkspaceContext, fn: (tx: Tx) => Promise<T>)`, tedy tři argumenty včetně poolu a celého kontextu, ne samotné `workspaceId`. `withoutContext` v P03 není nikde. `schema` z kořene exportovaný není záměrně („NENÍ to doménový barrel", P03 ř. 7003), dostupný je jen na podcestě `@mlain/db/schema` podle `exports` v package.json (P03 ř. 275).

**Navržená oprava:** levnější je oprava v P14. Adaptér `api/context.ts` je podle kapitoly 0.4 jediné místo, kde se to opravuje: použít `withWorkspace(pool, ctx, fn)` a preflight upravit na skutečná jména. Alternativa je doplnit do P03 tenkou obálku `withWorkspaceId(workspaceId, fn)`, která si pool vezme z modulového singletonu a kontext vyrobí přes `unsafeWorkspaceContext` se systémovým aktérem.

**Proč to vadí:** preflight v úkolu 1 vypíše `MISSING: schema,withWorkspaceId,withoutContext` a plán se podle vlastního pravidla zastaví hned na začátku. Bez opravy nejde otevřít ani jednu transakci mimo testy. Jde o jiný nález než už evidované `withWorkspaceTx` a `createSystemContext`.

---

## DŮLEŽITÉ

### D1. Typ události `rejected` nemá v `campaign_stats` čítač a propadá do „doručeno"

**Kde v plánu:** úkol 4, krok 4 (ř. 1035-1038): `deliveredEffective` počítá `Math.max(counts.sent - counts.bouncedHard - counts.bouncedSoft - counts.failed, 0)`. Stejný vzorec podruhé v úkolu 22, kroku 3 (ř. 5045-5047).

**Co P03 má:** `message_events.type` povoluje `rejected`, `delivery_delayed` i `render_failed` (P03 ř. 4146-4149), ale `campaign_stats` má jen `sent, failed, skipped, delivered, bounced_hard, bounced_soft, complained, unsubscribed` a dál otevření a prokliky (P03 ř. 3129-3146). Sloupec `rejected` tam není.

**Navržená oprava:** `ALTER TABLE campaign_stats ADD COLUMN rejected bigint NOT NULL DEFAULT 0` v P03, plní P10, P14 ho odečte v `deliveredEffective` a ukáže v dlaždici problémů.

**Proč to vadí:** zpráva, kterou provider odmítl, se v odvozeném jmenovateli počítá jako doručená. U kampaně, kterou SES odmítne kvůli vlastnímu suppression listu, report ukáže míru doručení blízko sta procent a míru prokliku podstřelí. Hlavní metrika produktu je proklik a jmenovatel je právě `deliveredEffective`, takže chyba jde přímo do hlavního čísla.

---

### D2. Dlaždice „aktivní na webu" nemá nad `web_events` použitelný index

**Kde v plánu:** úkol 22, krok 3 (ř. 5078-5086):
```sql
SELECT count(DISTINCT contact_id) AS contacts
  FROM web_events
 WHERE workspace_id = $1 AND received_at >= now() - interval '24 hours' AND contact_id IS NOT NULL
```
s komentářem „Prořezává se partičním klíčem received_at, takže se dotkne jedné, nejvýš dvou partition."

**Co P03 má:** šest indexů nad `web_events` (P03 ř. 4285-4308). Žádný nezačíná dvojicí `(workspace_id, received_at)`. Nejbližší je `idx_web_events__contact_occurred (workspace_id, contact_id, occurred_at DESC) WHERE contact_id IS NOT NULL`, který podmínku na `received_at` z indexu vyhodnotit neumí.

**Navržená oprava:** v P03 doplnit
`CREATE INDEX idx_web_events__ws_received ON web_events (workspace_id, received_at DESC) WHERE contact_id IS NOT NULL;`

**Proč to vadí:** prořezání na jednu partition znamená jeden měsíc událostí celé instalace, ne jednoho projektu. Na tabulce s desítkami milionů řádků měsíčně je to sken celého oddílu při každém otevření přehledu. Cache s TTL to zdrží, ale první uživatel po expiraci čeká.

---

### D3. Stránkování seznamu příjemců řadí podle `messages.id`, na to index není

**Kde v plánu:** úkol 12, krok 3 (ř. 2714-2716 a 2764-2770): `ORDER BY m.id DESC LIMIT ${limit}` s kurzorem `m.id < ${after}::uuid`, nad filtrem `workspace_id = ... AND campaign_id = ... AND created_at = ${partitionKey}`.

**Co P03 má:** `messages` PK `(id, created_at)` a deset indexů (P03 ř. 4069-4111). Pro dvojici „kampaň plus pořadí podle id" tam není nic: `idx_messages__campaign_status (campaign_id, status)` neřadí, `uq_messages__campaign_contact (campaign_id, contact_id, created_at)` také ne.

**Navržená oprava:** v P03 doplnit
`CREATE INDEX idx_messages__campaign_id_desc ON messages (campaign_id, id DESC);`

**Proč to vadí:** plánovač buď projde PK oddílu pozpátku a zahazuje řádky cizích kampaní, nebo posbírá celou kampaň a seřadí ji. U kampaně na sto tisíc příjemců je to sto tisíc řádků na každou stránku po padesáti. Rozpočet 7.2 části 5 je p99 120 ms, a test v úkolu 20 měří jen webovou větev osy, seznam příjemců neměří vůbec.

---

### D4. Přehled a Statistiky filtrují a řadí podle `campaigns.started_at`, index chybí

**Kde v plánu:** úkol 22, krok 3, funkce `readTotals` (ř. 5059-5060): `AND c.started_at >= ${from} AND c.started_at < ${to}`, a funkce `readRecentCampaigns` (ř. 5097-5099): `AND c.started_at IS NOT NULL ORDER BY c.started_at DESC LIMIT 5`.

**Co P03 má:** `idx_campaigns__workspace_status (workspace_id, status, updated_at DESC) WHERE deleted_at IS NULL`, `idx_campaigns__scheduler (scheduled_at) WHERE status = 'scheduled'`, `idx_campaigns__running (workspace_id) WHERE status IN ('queueing','sending')`, P03 ř. 2793-2802. Nad `started_at` nic.

**Navržená oprava:** v P03 doplnit
`CREATE INDEX idx_campaigns__ws_started ON campaigns (workspace_id, started_at DESC) WHERE deleted_at IS NULL AND started_at IS NOT NULL;`

**Proč to vadí:** v MVP 0 je kampaní málo a rozdíl nebude vidět. Za rok provozu je to seřazení všech kampaní projektu při každém načtení přehledu, tedy nejčastěji otevírané stránky produktu. Index stojí jeden řádek migrace teď a přepis tabulky později.

---

### D5. Časová osa omezuje `message_events.received_at` sedmidenním zpožděním, které pro tuhle tabulku nikde neplatí

**Kde v plánu:** úkol 16, krok 4 (ř. 3566-3567):
```ts
/** Offline fronta SDK doručí událost až sedm dní po vzniku (ck_web_events__lag). */
export const MAX_LAG_MS = 7 * 24 * 60 * 60 * 1000;
```
ř. 3602 `receivedTo: new Date(to.getTime() + MAX_LAG_MS)` a úkol 17, krok 3 (ř. 3872-3873), kde se stejná mez použije na `message_events`.

**Co P03 má:** `ck_web_events__lag` existuje jen na `web_events` (P03 ř. 4276-4281). `message_events` má tři CHECKy (`type`, `source`, `subject`) a žádný, který by svazoval `ts` s `received_at` (P03 ř. 4146-4157).

**Navržená oprava:** rozdělit konstantu na dvě, každou se svým zdůvodněním. Pro `message_events` buď požádat P03 o `ck_message_events__lag` se stejnou logikou (a P10 ji musí dodržet), nebo horní mez odvodit od retence oddílů, ne od sedmi dnů.

**Proč to vadí:** asynchronní odraz od SES chodí běžně po 72 hodinách, u některých příjemců i po týdnech, a `delivery_delayed` opakovaně. Událost s `ts` uvnitř okna a `received_at` osmý den se do časové osy kontaktu nedostane a už nikdy nedostane, protože okno se posouvá s ní. Ztráta je tichá: uživatel neuvidí chybu, jen mu v ose bude chybět odraz.

---

## POZNÁMKY

### N1. Dolní mez `received_at` u webových událostí ignoruje šedesátivteřinový předstih, který schéma povoluje

Úkol 17, krok 3 (ř. 3929): `AND e.received_at >= ${input.window.from}`. `ck_web_events__lag` v P03 povoluje `occurred_at <= received_at + interval '60 seconds'`, tedy `received_at` může být až o minutu před `occurred_at`. Událost s `occurred_at` těsně nad hranicí okna a `received_at` těsně pod ní z osy vypadne. Oprava je `received_at >= window.from - 60s`.

### N2. `campaign_stats_buckets` nemá čím rozlišit pětiminutový blok od slitého hodinového

P14 požaduje po P10 slévání bloků (kapitola 7, požadavek P14 na P10.4) a čerstvost pak odhaduje heuristikou podle stáří nejstaršího bodu, úkol 10, krok 3 (ř. 2076-2082). P03 má PK `(campaign_id, bucket_at)` a pět čítačů (P03 ř. 3160-3171), sloupec granularity ani příznak slití tam není. Návrh: `granularity text NOT NULL DEFAULT '5m'` s pojmenovaným CHECKem a rozšířeným PK. Bez toho se po první kompakci nedá poznat, co graf ukazuje, a `bucketDrift()` bude hlásit rozdíl proti `campaign_stats.sent` pokaždé, když se slévání zastaví v půlce.

### N3. Přepočet bere `clicks_total` z `human_click_count`, což vyrobí trvalý falešný drift

Úkol 13, krok 3 (ř. 3034): `coalesce(sum(human_click_count), 0) AS clicks_total`. `message_engagement` má podle P03 (ř. 4326-4331) oba sloupce, `click_count` i `human_click_count`. Pokud P10 plní `campaign_stats.clicks_total` ze všech prokliků, `compareWithStored()` bude u každé kampaně se skenerem hlásit rozdíl, i když je všechno v pořádku, a kontrola driftu ztratí smysl. Buď `sum(click_count)`, nebo se s P10 dohodnout, co `clicks_total` znamená.

### N4. Časová osa používá `list_subscriptions.list_id` jako identitu řádku, a to dvakrát

Úkol 17, krok 3 (ř. 3970 a 3976): `SELECT ls.list_id, ls.subscribed_at, 'list_subscribed', ...` a `SELECT ls.list_id, ls.unsubscribed_at, 'list_unsubscribed', ...`. P03 má `list_subscriptions` s PK `(contact_id, list_id)`, vlastní sloupec `id` tabulka nemá. Přihlášení a odhlášení téhož seznamu proto dostanou stejné `id` a kurzor `(t.occurred_at, t.id) < (...)` je na nich nejednoznačný. Řešení bez zásahu do schématu: složit identitu jako `ls.list_id || ':sub'` a `ls.list_id || ':unsub'`.

### N5. Kapitola 7 P14 nemá vůči P03 jediný požadavek

Osmnáct řádků požadavků míří na P10, P13, P07, P05, P04, P01 a P16. Na P03 nic. Vzhledem k nálezům K1 až K4 a D1 až D4 to znamená, že autor P14 schéma nekonfrontoval, jen předpokládal, že sedí. Po opravě je potřeba do kapitoly 7 doplnit řádky P14 na P03 pro `campaign_stats.rejected` a tři indexy.

### N6. Mimo schéma: obrazovka Statistiky čte tvar, který endpoint nevrací

Úkol 35, krok 3 (ř. 9634-9638) čte `tiles.recent_campaigns.data.items` a typuje je jako `TrendCampaign` se `sent`, `delivered`, `opens`, `opensApple`, `clicks`, `unsubscribed` a `startedAt` (ř. 9555-9565). `readRecentCampaigns` z úkolu 22 (ř. 5089-5116) vrací `campaignId`, `name`, `status`, `startedAt` a `clickRate`, má natvrdo `LIMIT 5` a parametr `period` nerespektuje. Graf trendu tedy dostane nedefinované hodnoty a `ratio()` z nich udělá nuly. Není to nález proti P03, ale bez opravy je celý úkol 35 mrtvý.

---

## Co jsem ověřil a nález tam není

- **`campaign_conversion_stats`**: P14 ji nepoužívá, nula výskytů v celém plánu. Kapitola 9 (ř. 10288) výslovně píše „Konverze a tržby se nedělají, `campaign_conversion_stats` se nezakládá." Souhlasí s P03, kde se tabulka nezakládá (část 5, 3.11).
- **Granty a append-only**: rozhodnutí R2 (ř. 69) dělá z P14 čistě čtecí vrstvu a test `ownership.test.ts` z úkolu 15 to vynucuje regexem nad zdrojáky balíčku. `mlain_app` má SELECT na všechny tabulky, takže žádný grant nechybí. Obava z `GRANT UPDATE` na výčet čtrnácti sloupců `message_engagement` se P14 netýká, `campaign_id` ani `workspace_id` měnit nepotřebuje. Do append-only tabulek zapisují jen fixtury, a to INSERT, který povolený je.
- **`campaign_link_stats`**: P14 čte jen `clicks_total`, `clicks_unique` a `clicks_human`, všechny existují. `first_click_at`, `last_click_at` ani `unique_contacts` nepotřebuje, podíl si dopočítá v aplikaci. PK `(workspace_id, campaign_id, link_id)` sedí s JOINem v úkolu 11 (ř. 2298-2301) i s fixturou.
- **`campaign_stats_buckets` a graf reportu**: graf kreslí `sent`, `delivered`, `opens_unique` a `clicks_unique` (úkol 31, ř. 8515-8518), tedy čtyři z pěti čítačů, které tabulka má. Druhá granularita jako samostatná tabulka potřeba není, hodiny i dny se počítají přes `GROUP BY date_trunc` nad pětiminutovými bloky (úkol 10, ř. 2102-2135), včetně dne v časové zóně projektu.
- **Odpovědní schéma `/stats`**: `countsSchema` (úkol 24, ř. 5622-5641) obsahuje výhradně sloupce, které `campaign_stats` skutečně má, plus dopočítané `delivered_effective`. Žádná metrika navíc, s výjimkou chybějícího `rejected` z nálezu D1.
- **Invariant I1**: P14 ho v úkolu 12 (ř. 2639) předpokládá („všechny zprávy kampaně mají created_at rovné audience_built_at"), P03 ho zná (ř. 3348-3351) a opírá o něj `uq_messages__campaign_contact` (P03 ř. 4078-4084). Shoda.
- **Klasifikace otevření přes `open_class_mask`**: úkol 13 (ř. 3030-3033) používá bity 1 human, 2 proxy_apple, 4 proxy_image, což odpovídá P03. Shoda.
- **Indexy pro časovou osu**: `idx_web_events__contact_occurred (workspace_id, contact_id, occurred_at DESC)`, `idx_message_events__contact (workspace_id, contact_id, ts DESC)` a `idx_messages__contact (workspace_id, contact_id, created_at DESC)` v P03 existují a P14 je používá správně, včetně povinné podmínky na partiční klíč. `consents` má `idx_consents__contact_purpose (contact_id, purpose, occurred_at DESC)` a `list_subscriptions` má PK začínající `contact_id`, takže obě větve historie souhlasů mají cestu bez sekvenčního skenu. Test s `EXPLAIN` v úkolu 20 (ř. 4642-4653) to ověřuje.
- **Fixtury ostatních tabulek**: `workspaces`, `contacts`, `sending_providers`, `messages`, `message_engagement`, `campaign_links`, `campaign_stats`, `campaign_stats_buckets` a `web_event_months` mají sloupce v pořádku, všechny vynechané NOT NULL sloupce mají DEFAULT. `ON CONFLICT (campaign_id)` u `campaign_stats` sedí s PK, slug workspace odpovídá `ck_workspaces__slug`.
- **`campaign_stats.version`**: bigint, inkrementuje ji P10 (kapitola 7, požadavek P14 na P10.2), P14 ji jen čte a proti zapomenutému inkrementu má otisk v `fingerprint.ts` (úkol 9). Shoda.
- **RLS**: všechny dotazy P14 nesou explicitní `workspace_id = ctx.workspaceId`, takže politika `ws_isolation` je druhá pojistka, ne jediná. Shoda.

---

## Souhrnná tabulka oprav

| Co doplnit | Kdo žádá | Typ nebo tvar | Proč |
|---|---|---|---|
| Oprava slovníku `message_events` na `bounced_hard`, `bounced_soft`, `complained` | P14 úkoly 12, 13, 17 (ř. 2545, 2616, 3045-3047, 3836, 3874) | oprava v P14, schéma je správně (P03 R5) | hodnoty `bounce` a `complaint` porušují `ck_message_events__type`, odrazy a stížnosti by byly v reportu i v ose vždy nula |
| `rank`, `recipient` a `source` do fixtur `INSERT INTO message_events` | P14 úkoly 12 a 17 (ř. 2543-2546, 3695-3698) | oprava v P14 | tři sloupce NOT NULL bez DEFAULT, každý INSERT skončí chybou 23502 |
| Sjednotit typ `Tx` na Drizzle handle místo `pg.PoolClient` | P14, 27 volání `tx.execute` | `export type Tx = NodePgDatabase<typeof schema>` v P03, nebo přepis P14 na `tx.query()` | `PoolClient` metodu `execute` nemá, typová kontrola spadne na každém čtecím modulu |
| `withWorkspaceId(workspaceId, fn)` a `withoutContext(fn)` | P14 ř. 311, 353, 5581, 5611 | oprava adaptéru v P14 na `withWorkspace(pool, ctx, fn)`, nebo obálka v P03 | preflight vypíše MISSING a plán se zastaví na kroku 2 úkolu 1 |
| `campaign_stats.rejected bigint NOT NULL DEFAULT 0` | P14 úkoly 4 a 22 (ř. 1035-1038, 5045-5047) | nový sloupec v P03, plní P10 | odmítnutá zpráva se dnes počítá jako doručená a podstřeluje míru prokliku, hlavní metriku produktu |
| `idx_web_events__ws_received (workspace_id, received_at DESC) WHERE contact_id IS NOT NULL` | P14 úkol 22 (ř. 5078-5086) | nový index v P03 | dlaždice „aktivní na webu" jinak čte celý měsíční oddíl všech projektů |
| `idx_messages__campaign_id_desc (campaign_id, id DESC)` | P14 úkol 12 (ř. 2715, 2769) | nový index v P03 | kurzorové stránkování příjemců nemá čím řadit, u kampaně na sto tisíc lidí je to plný sken na každou stránku |
| `idx_campaigns__ws_started (workspace_id, started_at DESC) WHERE deleted_at IS NULL AND started_at IS NOT NULL` | P14 úkol 22 (ř. 5059-5060, 5097-5099) | nový index v P03 | přehled i statistiky řadí a filtrují podle `started_at`, index nad ním neexistuje |
| Rozdělit `MAX_LAG_MS`, případně doplnit `ck_message_events__lag` | P14 úkoly 16 a 17 (ř. 3567, 3872-3873) | CHECK v P03, nebo oprava konstanty v P14 | sedmidenní mez platí jen pro `web_events`, opožděný odraz z osy kontaktu tiše vypadne |
| `campaign_stats_buckets.granularity text NOT NULL DEFAULT '5m'` v PK | P14 úkol 10 (ř. 2076-2082) a požadavek na P10.4 | nový sloupec a rozšířený PK v P03 | po slévání bloků se pětiminutový a hodinový řádek nedají rozlišit a `bucketDrift()` hlásí falešný rozdíl |
| Posun dolní meze `received_at` o 60 sekund u webové větve osy | P14 úkol 17 (ř. 3929) | oprava v P14 | `ck_web_events__lag` povoluje `received_at` až minutu před `occurred_at`, hraniční událost z osy vypadne |
| `clicks_total` v přepočtu ze `sum(click_count)`, ne `sum(human_click_count)` | P14 úkol 13 (ř. 3034) | oprava v P14, případně dohoda s P10 | jinak `compareWithStored()` hlásí drift u každé kampaně se skenerem a kontrola ztrácí smysl |
| Složená identita řádku u větve `list_subscriptions` v ose | P14 úkol 17 (ř. 3970, 3976) | oprava v P14 (`list_id || ':sub'`) | tabulka nemá sloupec `id`, přihlášení a odhlášení téhož seznamu dostanou stejný klíč a kurzor je nejednoznačný |
| `readRecentCampaigns` musí vracet tvar `TrendCampaign` a respektovat `period` | P14 úkoly 22 a 35 (ř. 5089-5116 vs 9555-9598) | oprava v P14, mimo schéma | obrazovka Statistiky čte šest čísel, endpoint vrací jen `clickRate` a maximálně pět kampaní |
