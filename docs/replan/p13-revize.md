# P13 vs. P03: revize souladu doménového plánu s databázovým schématem

**Recenzovaný plán:** `/Users/petr/Projects/Mailing_Tool/docs/superpowers/plans/2026-07-31-p13-kampane-provideri-outbox.md` (kampaně, provideři, sender domény a DNS, materializace publika do outboxu, pojistky doručitelnosti, SES webhook, ovládání kampaně)

**Zdroj pravdy pro schéma:** `/Users/petr/Projects/Mailing_Tool/docs/superpowers/plans/2026-07-31-p03-databaze-schema-rls.md`

**Datum revize:** 2026-08-01

**Metoda:** strukturní grep plánu, extrakce všech SQL bloků (`INSERT INTO`, `UPDATE`, `ON CONFLICT`, `RETURNING`, `DELETE FROM`, `SELECT ... FROM`), kontrola každé zmíněné tabulky a sloupce proti DDL P03. Každý nález o chybějícím sloupci nebo primitivu byl ověřen grepem přímo v P03, ne jen v digestu.

---

## Verdikt

Plán **není v současné podobě spustitelný proti schématu P03**. Čtyři kritické nálezy blokují build nebo běh celých fází:

- fáze J (testovací odeslání) padá na `NOT NULL`,
- fáze H (příjem událostí) má neúčinnou deduplikaci a zelený test, který proti reálnému Postgresu selže,
- **žádná** fáze se nezkompiluje, protože repository vrstva importuje neexistující primitivum,
- fáze I (retence) nemá práva na operaci, kterou provádí, a její veto vidí jen jeden projekt.

Zároveň platí, že návrhová část plánu je kvalitní: rozhodnutí D1 až D18 jsou odůvodněná, invariant I1 je konzistentně dodržený v materializaci, dedup receipts je udělaný správně a většina slovníků sedí. Nálezy jsou soustředěné do míst, kde plán narazil na hranici cizího vlastnictví a nedotáhl požadavek do kapitoly 4.2.

Kapitola 4.2 (Požadavky na P03) obsahuje šest požadavků R-P03.1 až R-P03.6. Z nich je **R-P03.1 mrtvý** (viz D5) a **R-P03.3 je napsaný tak, že ho čtenář P03 přehlédne** (viz D3). Chybí v ní čtyři požadavky, které plán ve svém vlastním textu uznává, ale nezapsal (K1, K3, D1, D2).

| Kategorie | Počet |
|---|---|
| KRITICKÉ | 4 |
| DŮLEŽITÉ | 9 |
| POZNÁMKA | 11 |

---

## KRITICKÉ

### K1. Testovací odeslání zapisuje `contact_id = NULL` do sloupce `NOT NULL`

**Místo v plánu:** fáze J, úkol 50 (Testovací odeslání), krok 3, funkce `sendTest`, ř. 9530-9535. Souvisí s úkolem 53, krok 3, `sendTestSchema`, ř. 9998.

**Co plán dělá:**

```
VALUES ($1, $2, $3, 'test', $4, '{}'::jsonb, 'pending', now(), $5::timestamptz)`,
[ctx.workspaceId, input.campaignId, input.contactId ?? null, raw.toLowerCase(), createdAt],
```

API schéma to potvrzuje: `contact_id: z.string().uuid().optional()`. Komentář v plánu na ř. 9484 přitom slibuje „Kdyz chybi, vezme se nahodny z publika", ale kód žádné dohledání neobsahuje.

**Co P03 má:** ř. 4030 `contact_id uuid NOT NULL`. Je to rozhodnutí R3, které P03 udělal vědomě a GDPR výmaz řeší anonymizací `email` na `erased+{contact_id}@erased.invalid`, ne mazáním řádku.

**Navržená oprava:** doplnit do `sendTest` povinné dohledání kontaktu podle vlastního komentáře plánu (vzít kontakt z `input.contactId`, jinak první kontakt z publika kampaně, jinak vrátit `422` s vysvětlením). Alternativa v podobě `ALTER COLUMN contact_id DROP NOT NULL` plus `CHECK (kind = 'test' OR contact_id IS NOT NULL)` je horší: rozbila by párování `message_events.contact_id` a GDPR anonymizaci, která filtruje `WHERE contact_id = $2`.

**Proč to vadí:** každé testovací odeslání bez `contact_id` skončí chybou 23502. Devět testů úkolu 50 nemůže projít.

---

### K2. `uq_message_events__once_per_message` neodděluje duplicity, protože obsahuje `received_at DEFAULT now()`

**Místo v plánu:** fáze H, úkol 41 (Zpracování události, párování a jediná povolená oprava stavu), krok 3, funkce `insertEventOnce`, ř. 7700-7704. Test je v kroku 1 téhož úkolu, ř. 7521-7529.

**Co plán dělá:**

```
INSERT INTO message_events (workspace_id, message_id, message_created_at, campaign_id, contact_id, ...)
VALUES (...)
ON CONFLICT DO NOTHING
```

a test „tataz udalost dvakrat vytvori jeden radek v message_events" očekává `expect(r.rows[0].n).toBe(1)`. Dvě volání `insertEventOnce` jsou dvě samostatné transakce, tedy dvě různá `now()`.

**Co P03 má:** ř. 4140 `received_at timestamptz NOT NULL DEFAULT now()` a ř. 4181-4184:

```sql
CREATE UNIQUE INDEX uq_message_events__once_per_message
  ON message_events (message_id, type, received_at)
  WHERE type IN ('sent','delivered','bounced_hard','bounced_soft','complained');
```

Komentář P03 na ř. 4176-4179 tvrdí, že index „sémanticky brání duplicitě uvnitř jedné měsíční partition". To není pravda: brání duplicitě jen ve stejné mikrosekundě.

**Kontext, který nález vyostřuje:** o pět set řádků dřív, ve fázi H, úkolu 39, ř. 7188-7194, plán tutéž past správně diagnostikuje u `provider_event_receipts` a řeší ji explicitním `WHERE NOT EXISTS`. U `message_events` na to nepřišel.

**Navržená oprava:** dvě varianty, doporučuji první.

1. Doplnit `message_events.content_key text` a unikátní index `(workspace_id, content_key, received_at)`, dedup dělat explicitním `WHERE NOT EXISTS` nad prefixem `(workspace_id, content_key)` omezeným na aktuální oddíl. Sloupec `content_key` P03 sám avizuje ve svém komentáři na ř. 4178, ale nezaložil ho.
2. `insertEventOnce` předává `received_at` deterministicky, například `date_trunc('second', $ts::timestamptz)`. Index pak sepne, ale hraniční případy na přelomu sekundy zůstanou.

**Proč to vadí:** ochrana, jejíž jediné vynucení je index, který nefunguje. Duplicitní `delivered` po rematchi projde. `reconcileDeliveryCounters` to ustojí, protože počítá `count(DISTINCT message_id)`, ale `campaignEventTotals` u obsahových odrazů (ř. 8232-8235) používá `count(*)` a časová osa zprávy bude mít dva řádky.

---

### K3. `withTx` neexistuje, P03 exportuje `withWorkspace(pool, ctx, fn)`

**Místo v plánu:** čtyři odchylky najednou, napříč celým plánem.

- fáze A, úkol 7, krok 3, ř. 1357: `import { withTx, type WorkspaceContext } from '../../tx';`
- fáze D, úkol 17, krok 3, ř. 3218-3219: `import type { WorkspaceContext } from '@mlain/db/tx';` a `import { revokePending } from '@mlain/db/repo/campaigns/outbox';`
- fáze A, úkol 1, krok 4, ř. 470-471: plán si to sám testuje.

```ts
const mod = await import('@mlain/db/tx');
e2(typeof mod.withTx).toBe('function');
```

Text kroku 4 zní: „Expected: PASS, jakmile P01 doplní podcestný export a **P03 základ repository**." Plán tedy závislost zná a označuje ji za blokující nález, ale do kapitoly 4.2 ji nezapsal. Existují jen R-P03.1 až R-P03.6 a žádný z nich se `withTx` netýká.

**Co P03 má:**

- ř. 5613 `withWorkspace(pool: Pool, ctx: WorkspaceContext, fn)`, ř. 5646 `withUser(pool, userId, fn)`, ř. 5671 `withReadOnly(pool, ctx, statementTimeoutMs, fn)`. Symbol `withTx` nikde.
- Soubor je `packages/db/src/repo/tx.ts` (hlavička na ř. 5601). P13 importuje `'../../tx'` z `packages/db/src/repo/campaigns/campaign.ts`, což se rozřeší na `packages/db/src/tx`, tedy jinam.
- `packages/db/package.json` je ve výhradním vlastnictví P03 (kapitola 7, ř. 7107) a na ř. 273-278 má pět exportů: `.`, `./schema`, `./migrate`, `./partitions`, `./rls`. Ani `./tx`, ani `./repo/*`.

**Navržená oprava:** nový požadavek na P03, například R-P03.7, se dvěma částmi.

1. Doplnit do `packages/db/package.json` exporty `"./tx": "./src/repo/tx.ts"` a `"./repo/*": "./src/repo/*.ts"`.
2. Rozhodnout o signatuře. Buď P03 přidá tenký `withTx(ctx, fn)` nad modulovým poolem, nebo P13 přepíše všech zhruba šedesát volání na `withWorkspace(pool, ctx, fn)`. Druhá varianta je v `packages/core/**` problematická, protože import `db` mimo `packages/db` zakazuje část 1, kapitola 3.6.

**Proč to vadí:** nezkompiluje se ani jeden ze čtrnácti souborů repository P13.

**Vztah k evidovanému nálezu:** evidence už zná `withWorkspaceTx`. Tohle je jiná věc: jde o jméno `withTx`, o dvouargumentovou signaturu bez `pool`, o špatnou cestu k souboru a o chybějící exportní mapu v souboru, který vlastní P03.

---

### K4. Retence odpojuje partition vlastní implementací pod `mlain_app` a obchází vetované primitivum P03

**Místo v plánu:** fáze I, úkol 45 (Retence a její veto), krok 3. Funkce `canDetachPartition` ř. 8465-8490, `listDetachablePartitions` ř. 8492-8506, `detachAndDrop` ř. 8508-8514.

**Co plán dělá:**

```ts
export async function detachAndDrop(ctx: WorkspaceContext, partitionName: string): Promise<void> {
  await withTx(ctx, async (tx) => {
    await tx.query(`DROP TABLE IF EXISTS ${quoteIdent(partitionName)}`, []);
  });
}
```

plus vlastní výčet partition nad `pg_class` a `pg_inherits` a vlastní veto.

**Co P03 má:** ř. 4709-4721 `dropPartitionsBefore(client, table, column, before, veto)` s **povinným** veto predikátem a typem `PartitionVeto` na ř. 4696-4698. Rozhodnutí R17 P03 tuhle past popisuje a veto v ní vyhrává. Vlastníkem tabulek je `mlain_migrator` (ř. 610). `mlain_app` má podle migrace 0005 jen `SELECT`, `INSERT`, `UPDATE`, `DELETE`.

**Tři nezávislé vady:**

1. `DROP TABLE` vyžaduje vlastnictví relace. `mlain_app` skončí chybou 42501 `must be owner of table`. Retence tedy nefunguje vůbec.
2. `canDetachPartition` čte `campaigns` a `messages` **bez `workspace_id`**, tedy pod RLS jen jeden projekt. Partition je přitom globální přes všechny projekty. Kdyby bod 1 neexistoval, veto by odpojilo partition s rozdělanou kampaní cizího projektu. Plán si tenhle scénář na ř. 8471-8476 sám popisuje jako „nizka pravdepodobnost, vysoky dopad".
3. Druhá kopie veta vedle `PartitionVeto` z P03, tedy přesně ta konstrukce, kterou plán zakazuje v rozhodnutí D17, bodu 1 („Kdybych UUIDv5 dopočítával podruhé na své straně, existoval by tentýž algoritmus na dvou místech").

**Navržená oprava:** `retentionHandler` volá `dropPartitionsBefore` z `@mlain/db` a předává mu vlastní `veto` predikát. Veto musí běžet nad všemi projekty, tedy mimo RLS kontext, a spojení musí mít právo na DDL. Primitivum, kterým se takové spojení získá, P03 neexportuje. Je to požadavek na P03 nebo P01, ne řešitelné uvnitř P13.

---

## DŮLEŽITÉ

### D1. `campaigns.release_at` nemá v celém plánu jediný zápis

**Místo v plánu:** rozhodnutí D12 (kapitola 2, ř. 87, „Okno na zrušení je 60 sekund. Potvrzeno zadavatelem."), fáze E, úkol 25 (Okno na zrušení odeslání), krok 3, `computeReleaseAt` ř. 4380-4383 a `undoState` ř. 4389-4396. Endpoint `POST /campaigns/:id/undo` je v úkolu 53, ř. 10099-10108.

**Realita:** `release_at` se v plánu vyskytuje jen jako pole datového typu (ř. 757 a 1365) a jako vstupní parametr `materializeBatch` (ř. 2470, 2531). Job `campaign.materialize` má na ř. 3046 `const cfg = deps.config ?? { batchSize: 5000, maxMinutes: 60, usedFields: [], releaseAt: null }` a `deps.config` nikdo nikde nenaplňuje. Příkaz `UPDATE campaigns SET release_at` v plánu není.

**Co P03 má:** sloupec `release_at timestamptz` v `campaigns` existuje.

**Navržená oprava:** `startMaterialization` (fáze C, úkol 12, krok 3) doplní do svého `UPDATE` výpočet `release_at = date_trunc('second', now()) + (undo_window_seconds || ' seconds')::interval` a vrátí ho v `RETURNING`. `materializeHandler` ho pak předá do smyčky místo `cfg.releaseAt`.

**Proč to vadí:** `undoState` dostane vždy `releaseAt: null` a vrátí `canUndo: false`. Rozhodnutí potvrzené zadavatelem je fakticky nezapojené a nikde to nespadne.

---

### D2. `sending_providers` nemá sloupec pro `review_status`

**Místo v plánu:** fáze F, úkol 29 (Čtení kvót a detekce sandboxu), ř. 5101 a 5117. Fáze F, úkol 31 (Repository providerů), krok 3, `updateAccountSnapshot`, ř. 5511 a 5516-5523.

**Co plán dělá:** načte z AWS `GetAccount` hodnotu `r.Details?.ReviewDetails?.Status ?? null`, protáhne ji signaturou `updateAccountSnapshot` a v samotném `UPDATE` ji nezapíše. Pole parametrů má osm položek a `review_status` mezi nimi není.

**Co P03 má:** `production_access`, `enforcement_status`, `sending_enabled`, `quota_max_24h`, `quota_max_send_rate`, `quota_sent_24h`, `quota_checked_at`, `status_detail`. Sloupec pro stav žádosti o produkční přístup ne.

**Navržená oprava:** `ALTER TABLE sending_providers ADD COLUMN review_status text;` bez `CHECK`, ze stejného důvodu jako u `enforcement_status`. Alternativa: hodnotu ukládat do `status_detail` jsonb a ze signatury `updateAccountSnapshot` ji smazat, ať v kódu nezůstává mrtvé pole.

**Proč to vadí:** preflight rozlišuje sandbox nálezem `provider_sandbox` (úkol 49, ř. 9165-9170), ale bez `review_status` nemá uživateli co poradit. Rozdíl mezi „žádost běží" (PENDING) a „žádost zamítnuta" (DENIED) je pro něj zásadní.

---

### D3. `trg_campaigns__immutable_while_sending` v P03 neexistuje a P03 triggery zásadně nepoužívá

**Místo v plánu:** kapitola 4.2, požadavek R-P03.3, ř. 151. Konkrétní seznam sloupců je jen ve fázi A, úkolu 3, krok 3, konstanta `IMMUTABLE_WHILE_SENDING`, ř. 771-779, s komentářem „Vynucuje to API (campaign_locked), **databazovy trigger** a inkrementace revision".

**Co P03 má:** `grep 'CREATE TRIGGER'` v celém P03 vrací nula výskytů. Konvence P03 navíc říká, že `updated_at` mění aplikace, ne trigger.

**Navíc:** seznam `IMMUTABLE_WHILE_SENDING` neobsahuje `compile_meta` ani `compiled_hash`, i když rozhodnutí D18 (ř. 96) explicitně říká, že `compile_meta` „je součástí neměnných hodnot po přechodu do `sending`".

**Navržená oprava:** vytáhnout trigger z R-P03.3 do samostatného požadavku s explicitním DDL a seznamem šestnácti sloupců (čtrnáct z ř. 772-779 plus `compile_meta` a `compiled_hash`). Alternativa: vědomě rozhodnout, že ochrana zůstane jen v aplikaci, a R-P03.3 přeformulovat, ať netvrdí něco, co se neděje.

**Proč to vadí:** R-P03.3 je formulovaný jako odkaz na cizí dokument („podle části 4a, 2.1 až 2.9 a 3.9.1"). Čtenář P03 z něj nemá šanci vyčíst, že má napsat trigger, který jde proti jeho vlastní konvenci.

---

### D4. `deliverability_snapshots` má PK na `provider_id`, ale zdrojová data provider nenesou

**Místo v plánu:** fáze I, úkol 43 (Denní zrcadlo doručitelnosti a metriky), krok 3, funkce `rollupDay`, ř. 8194-8211.

**Co plán dělá:** CTE `s` nad `messages` a CTE `e` nad `message_events` filtrují **jen** `workspace_id` a datum:

```sql
FROM messages WHERE workspace_id = $1 AND sent_at::date = $3::date AND status = 'sent' AND kind = 'campaign'
...
FROM message_events WHERE workspace_id = $1 AND received_at::date = $3::date
```

Výsledek pak jde do `INSERT INTO deliverability_snapshots (workspace_id, provider_id, day, ...) SELECT $1, $2, $3::date, ...`.

**Co P03 má:** `deliverability_snapshots` PK `(workspace_id, provider_id, day)`. `messages` ani `message_events` sloupec `provider_id` nemají. Jediná vazba na providera je `campaigns.provider_id`.

**Navržená oprava:** join přes kampaň, ne nový sloupec:

```sql
FROM messages m JOIN campaigns c ON c.id = m.campaign_id AND c.provider_id = $2
FROM message_events e JOIN campaigns c ON c.id = e.campaign_id AND c.provider_id = $2
```

Sloupec `provider_id` přímo v outboxu o pěti milionech řádků by byl dražší než join a rozešel by se při změně providera kampaně.

**Proč to vadí:** projekt se dvěma providery (typicky SES ostrý plus SMTP na testy) dostane u obou stejná čísla, tedy dvakrát započítanou doručitelnost. Dashboard i preflight z toho čtou. Automatické brzdy naštěstí ne, ty jdou přes `campaignEventTotals` s filtrem na konkrétní kampaň.

---

### D5. Rozpad publika se ztrácí: tři sloupce místo jedenácti a `audience_breakdown` nikdo nezapisuje

**Místo v plánu:** fáze C, úkol 16 (Job `campaign.materialize`), krok 3, ř. 3036-3042. Fáze C, úkol 12, krok 3, `setGateCounters`, ř. 2311-2322. Požadavek R-P03.1 na ř. 149 a R-P07.1 plus R-P07.6 na ř. 158 a 163.

**Co plán dělá:** `countAudienceGates` má podle R-P07.1 vracet deset klíčů a podle R-P07.6 jedenáctý (`excluded_sample`). Job je slévá do tří:

```ts
await deps.setGateCounters(campaignId, {
  suppressed: gates.excluded_suppressed,
  unsubscribed: gates.excluded_unsubscribed + gates.excluded_unconfirmed +
                gates.excluded_snoozed + gates.excluded_processing_restricted,
  invalid: gates.excluded_invalid_email,
});
```

**Co P03 má:** `campaign_audience_progress` má právě `skipped_suppressed`, `skipped_unsubscribed`, `skipped_invalid`.

**Druhá půlka nálezu:** požadavek R-P03.1 žádá `campaigns.audience_breakdown jsonb`, ale řetězec `audience_breakdown` je v celém plánu **jen na tom jediném řádku 149**. Žádný `UPDATE`, žádné čtení, žádný test. Požadavek by vyrobil sloupec, který nikdo nepoužije.

**Navržená oprava:** `setGateCounters` zapisuje celý jedenáctiklíčový rozpad do `campaigns.audience_breakdown` jedním `UPDATE` ve stejné transakci. `campaign_audience_progress` zůstává na třech agregátech, které slouží ukazateli postupu, ne reportu.

**Proč to vadí:** část 6, kapitola 8.6.2 žádá, aby řádek „Vyloučeno" byl pojmenovaný, ne souhrnný. Po sečtení čtyř bran do jedné se z něj souhrnný řádek zase stane.

---

### D6. Náhled publika běží dynamicky složené SQL v zapisovatelné transakci, i když P03 má `withReadOnly`

**Místo v plánu:** fáze B, úkol 11 (Náhled počtu publika), krok 3, funkce `countWithTimeout`, ř. 2092-2098.

**Co plán dělá:**

```ts
return withTx(ctx, async (tx) => {
  await tx.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`, []);
  const text = `SELECT count(*)::int AS n FROM contacts c WHERE c.workspace_id = $1 AND (${where.sql})`;
```

**Co P03 má:** ř. 5671-5686 `withReadOnly(pool, ctx, statementTimeoutMs, fn)` s `BEGIN READ ONLY`, se `SET LOCAL statement_timeout` a s komentářem: „Používá ji náhled segmentu, který spouští dynamicky sestavené SQL: chyba v kompilátoru nesmí mít možnost zapsat."

**Navržená oprava:** použít `withReadOnly` místo `withTx` a ručního timeoutu. Po vyřešení K3 je to jednořádková změna.

**Proč to vadí:** `where.sql` je text generovaný kompilátorem části 2, tedy cizím kódem. P03 tuhle transakci navrhl přesně proti tomuhle případu a P13 ji nahradil slabší variantou.

---

### D7. `sender_domains` má sedm sloupců, které P13 nikdy nezapisuje

**Místo v plánu:** fáze G, úkol 36 (Složení `DomainChecks`, cache a job `domain.recheck`), krok 3, typ `DomainRow` ř. 6534-6541 a funkce `saveChecks` ř. 6549-6558. Fáze K, úkol 54 (REST API providerů a domén), krok 3, ř. 10285-10305.

**Co plán dělá:** `DomainRow` čte všechny sloupce, `saveChecks` zapisuje jen `checks`, `spf_ok`, `dkim_ok`, `dmarc_ok`, `mx_ok`, `checked_at`, `next_check_at`, `verified_at`, `updated_at`. V celém plánu není `INSERT INTO sender_domains` ani zápis do `dkim_tokens`, `dkim_status`, `dkim_hosted_zone`, `dkim_key_length`, `mail_from_subdomain`, `mail_from_status`, `ses_verification_status`. REST API přitom vystavuje `POST /domains`, `POST /domains/:id/mail-from` a `DELETE /domains/:id` a volá služby `domains.add`, `domains.setMailFrom`, `domains.remove`, které v repository neexistují.

**Co P03 má:** `dkim_status` CHECK IN (not_started, pending, success, failed, temporary_failure), `mail_from_status` CHECK IN (not_configured, pending, success, failed), `dkim_key_length` DEFAULT `'RSA_2048_BIT'`, `ses_verification_status` bez CHECK.

**Navržená oprava:** doplnit do `packages/db/src/repo/providers/domain.ts` funkce `createDomain`, `setMailFrom` a `removeDomain`, a v úkolu 33 explicitně namapovat hodnoty SES `VerificationStatus` na `dkim_status` podle slovníku P03.

**Ke sloupcům, které zadání zmiňovalo jako možná chybějící:** DMARC politika, custom MAIL FROM MX ani poslední chyba nový sloupec nepotřebují. Všechno tohle nese `checks` jsonb, který má čtyři klíče (`spf`, `dkim`, `dmarc`, `mx`) a v každém `findings` a `checked_at` (úkol 36, ř. 6520-6528).

**Proč to vadí:** čtyři CHECK slovníky P03 nemají v P13 žádného zapisovatele, takže se proti nim nikdy nic neověřilo. Fáze G je bez zápisové cesty nespustitelná.

---

### D8. Testovací odeslání nemá kam uložit `[TEST]` v předmětu

**Místo v plánu:** fáze J, úkol 50, krok 3, ř. 9524 a 9539.

**Co plán dělá:** spočítá `const subject = ` s prefixem `[TEST] ` před `row.subject`, vrátí ho v návratové hodnotě API a do `messages` nezapíše nic.

**Co P03 má:** `messages` nemá `subject` ani jiný přepis obsahu. `content_variant_id` je rezerva pro MVP 1 a odkazuje na `campaign_content_variants`, kde `subject` je.

**Navržená oprava:** dvě varianty, obě bez změny schématu.

1. Prefix zahodit a v UI napsat, že testovací mail vypadá stejně jako ostrý.
2. Pro testovací odeslání zakládat řádek v `campaign_content_variants` s upraveným `subject` a odkázat ho z `messages.content_variant_id`.

**Proč to vadí:** uživatel dostane testovací mail nerozeznatelný od ostrého, což je přesně ten typ chyby, kterou má testovací odeslání odhalit.

---

### D9. Testovací zprávy sdílejí `created_at` s publikem kampaně, kolidují v UQ a padají do úklidu

**Místo v plánu:** fáze J, úkol 50, krok 3, ř. 9525: `const createdAt = row.audience_built_at ?? new Date().toISOString();`

**Co P03 má:** unikátní index `(campaign_id, contact_id, created_at)` na `messages`.

**Dva důsledky:**

1. Dvě testovací odeslání téže kampaně se stejným `contact_id` (a po opravě K1 bude `contact_id` povinné) poruší unikátní index. Test na opakované testovací odeslání v plánu není, takže to nikdo nechytí.
2. `cancelPendingBatch` (fáze E, úkol 23, krok 3, ř. 4105-4116) filtruje `campaign_id = $1 AND created_at = $2 AND status = 'pending'` **bez `kind`**, takže při zrušení kampaně zruší i čekající testovací zprávy. Totéž `isOutboxDrained` (fáze E, úkol 26, krok 3, ř. 4571-4578), takže kampaň se neuzavře, dokud nedoběhne test.

**Navržená oprava:** testovacím zprávám dávat `created_at = now()` a doplnit `AND kind = 'campaign'` do `cancelPendingBatch` a `isOutboxDrained`. Funkce `finishMaterialization` (úkol 15, ř. 2834-2842) ten filtr už správně má, takže jde o nekonzistenci uvnitř plánu.

**Proč to vadí:** invariant I1 je definovaný jako „všechny řádky publika mají `created_at = audience_built_at`". Míchat do té množiny testovací zprávy znamená, že se I1 nedá ověřit jedním dotazem, což je jeho jediný smysl.

---

## POZNÁMKY

### N1. `compiled_hash` a `delegation_token_hash` jsou TEXT, ostatní otisky v P03 jsou bytea

`computeCompiledHash` (úkol 47, ř. 8892) i hash delegačního tokenu (úkol 56, ř. 10635) vrací hex řetězec, takže TEXT je funkčně v pořádku. Rozchází se to ale s `templates.design_hash bytea`, `sessions.token_hash bytea`, `invitations.token_hash`, `exports.download_token_hash` a `segments.definition_hash`. Není to chyba, ale zaslouží si vědomé potvrzení, ať se to za rok neopravuje jako nedopatření.

### N2. `suppressions.source = 'ses_event'` je nová hodnota mimo slovníky ostatních tabulek

Fáze H, úkol 42, ř. 7883, 7929, 7937 a 7959. `suppressions.source` na rozdíl od `reason` v P03 žádný CHECK nemá (ověřeno na ř. 1873-1875), takže hodnota projde. `list_subscriptions.source` i `consents.source` znají `webhook`, `ses_event` ne. Vlastníkem `suppressions.add` je P07, takže rozhodnutí je jeho, ale sjednocení by stálo za to.

### N3. `message_events.type = 'circuit_breaker_open'` nemá v P13 zapisovatele

Automatická brzda (fáze I, úkol 44) zapisuje jen `campaigns.pause_reason`. Hodnota v CHECK P03 zůstává prázdná. Buď ji `evaluateGuards` s výsledkem `pause` začne psát, nebo je to mrtvá položka slovníku.

### N4. `POST /campaigns` nemá v plánu žádné SQL

Řetězec `INSERT INTO campaigns` se v celém P13 nevyskytuje ani jednou. Repository `campaign.ts` má `getCampaign`, `transitionStatus`, `bumpRevision`, `listRunningCampaignIds`, `claimDueCampaigns`, `markScheduleMissed` a `saveCompilation`. Zakládání, duplikace i měkké mazání kampaně jsou v úkolu 53 jen volání služby bez implementace (ř. 10036-10058). Není to nález proti P03, ale díra v plánu.

### N5. `reconcileSuppressed` a `countWithTimeout` píšou vlastní SQL nad `contacts` a `suppressions`

Fáze D, úkol 18, krok 3, ř. 3345-3367 (join `suppressions` a `contacts` přes `email_fingerprints`) a fáze B, úkol 11, ř. 2094-2124 (`FROM contacts c`). Sloupce proti P03 sedí, takže to není nález proti schématu, ale rozpor s vlastní kapitolou 1.3, která říká: „P13 volá jejich funkce a nikdy nepíše vlastní SQL nad `contacts`, `list_subscriptions` ani `suppressions`."

### N6. Prahy doručitelnosti sloupec nepotřebují, ale chybí požadavek na P04

Prahy jsou v `workspaces.settings.deliverability` (fáze A, úkol 6, ř. 1197-1215) a v proměnných prostředí, stav brzdy je `campaigns.pause_reason` jsonb plus `sending_providers.status`. To je správný návrh a žádný sloupec navíc nechybí. Chybí ale deklarovaný požadavek na P04, který `workspaces.settings` vlastní, aby namespace `campaigns` a `deliverability` respektoval a nepřepisoval. Kapitola 4.4 od P04 žádá jen registr sub-appů (R-P04.1).

### N7. `enforcement_status` bez CHECK je záměrně správně

P13 do něj zapisuje hodnoty AWS doslova (`HEALTHY`, `PROBATION`, `SHUTDOWN`) a `deriveProviderStatus` má bezpečný default pro neznámou hodnotu (fáze F, úkol 28, ř. 4974-4976: „Neznamy stav se povazuje za NEPOUZITELNY"). Uzavřený CHECK by při nové hodnotě AWS rozbil job `provider.refresh_quota`. Ponechat tak, jak je.

### N8. Počítadla INTEGER stačí na pět milionů

Strop 2 147 483 647 proti pěti milionům je bezpečný i po opakovaných rekoncilacích, protože `reconcileHandoverCounters` (fáze E, úkol 26, ř. 4512-4530) přepisuje absolutní hodnotou (`SET total_count = agg.total`), ne inkrementem. Bigint není potřeba.

### N9. `campaigns.audience` sedí přesně

`campaignAudienceSchema` (fáze A, úkol 3, ř. 700-710) je `{include:{lists,segments},exclude:{lists,segments}}` se `.strict()`. Žádné tagy, žádní jednotliví kontakti, žádný filtr. Sloupec pro velikost dávky, pro A/B rozdělení, pro throttling ani pro `send_rate` P13 nepotřebuje: materializační dávka je `CAMPAIGN_MATERIALIZE_BATCH_SIZE` z prostředí (rozhodnutí D11), A/B je `campaign_content_variants` jako rezerva MVP 1 (rozhodnutí D10), throttling čte sender ze `sending_providers.quota_max_send_rate` (kapitola 3).

### N10. `campaign_links` je jinak kompletní

`link_type`, `is_unsubscribe` ani `url_hash` P13 nepotřebuje. `replaceCampaignLinks` (fáze J, úkol 47, ř. 8825-8850) zapisuje jen `id`, `workspace_id`, `campaign_id`, `url`, `position`, `label`, a `unsubscribe_url` je z `usedFields` vyloučený požadavkem R-P08.1. Pozice od jedné a zrušený `DEFAULT` na `id` jsou už v evidenci.

### N11. `provider_event_receipts` je udělaný správně a je to vzor pro opravu K2

`insertReceiptOnce` (fáze H, úkol 39, ř. 7203-7213) dělá přesně to, co má: `WHERE NOT EXISTS` nad prefixem `(workspace_id, dedup_key)` s omezením na aktuální oddíl a `ON CONFLICT` jen jako pojistka proti dvěma workerům ve stejné mikrosekundě. Slovník `status` (received, processed, unmatched, invalid) sedí, `markProcessed` používá tři z nich a `received` je DEFAULT.

---

## Co bylo ověřeno jako v pořádku

Následující body byly cíleně prověřeny (většinou proto, že na ně zadání revize ukazovalo) a **nález nemají**.

**Stavový stroj kampaně.** `KNOWN_CAMPAIGN_STATUSES` (úkol 3, ř. 674-677) je přesně těch deset hodnot, které má CHECK v P03: draft, scheduled, queueing, sending, paused, sent, partially_sent, cancelled, failed, schedule_missed. Žádný `UPDATE` v plánu nezapisuje stav mimo tento seznam. `startMaterialization` přechází z (draft, scheduled, schedule_missed) do queueing, `pauseCampaign` z (queueing, sending) do paused, `cancelCampaign` z (scheduled, queueing, sending, paused, schedule_missed) do cancelled, `finishMaterialization` z queueing do sending, `markScheduleMissed` ze scheduled do schedule_missed. Vše v mezích CHECK.

**Invariant I1.** Materializační dávka (úkol 13, ř. 2509-2520) zapisuje `created_at` explicitně hodnotou `audience_built_at`, nikdy `DEFAULT now()`, a `ON CONFLICT` uvádí všechny tři sloupce indexu. `startMaterialization` nastavuje `audience_built_at` přes `COALESCE`, takže opakování hodnotu nezmění. Plán **nepotřebuje** dávkovou materializaci s více hodnotami `audience_built_at`, takže I1 zůstává neporušený. To byl potenciálně nejzávažnější scénář ze zadání revize a je čistý.

**`campaign_audience_progress` fáze a kurzor.** `phase` nabývá jen hodnot collecting, materializing, done, což sedí s CHECK. `cursor_contact_id` se plní z `progress?.cursor_contact_id ?? ZERO_UUID` a používá se jako `c.id > $2` s `ORDER BY c.id`, což je konzistentní s typem uuid a s `uuidv7()` monotónností.

**`revision` a klíč cache senderu.** `bumpRevision` (úkol 7, ř. 1430-1436) a `saveCompilation` (úkol 47, ř. 8956-8965) inkrementují správně, sloupec v P03 je.

**`pause_reason` jako jsonb.** Úkol 5 definuje jeden závazný tvar, `pauseCampaign` ho serializuje přes `JSON.stringify` a přetypovává `$3::jsonb`. `resumeCampaign` ho nuluje. Sloupcový grant senderu (`UPDATE (status, pause_reason)`) je v P03 a plán ho na ř. 1002 explicitně bere na vědomí.

**Souběh aplikace a senderu nad `campaigns.status`.** Sender má podle P03 sloupcový grant jen na `status` a `pause_reason` a podle kapitoly 3 P13 smí jen přechod `queueing|sending → paused` se čtyřmi vlastními kódy. Aplikace píše všechny přechody. Watchdog (úkol 26, ř. 4618-4627) doplňuje audit i za pauzy provedené senderem, protože sender do `audit_log` granty nemá a mít je nemá. Rozdělení odpovědnosti je konzistentní.

**Dedup SES webhooku.** Viz N11, řešeno správně a lépe než u `message_events`.

**Slovník `provider_event_receipts.status`.** Sedí, `markProcessed` píše jen processed, unmatched, invalid, `received` je DEFAULT při vložení.

**Slovník `sending_providers.status`.** `PROVIDER_STATUSES` (ř. 4749) je přesně šest hodnot z CHECK P03 a `deriveProviderStatus` (ř. 4966-4977) vrací jen tyto hodnoty.

**Slovník `message_events.source`.** `insertEventOnce` má typ `'ses_sns' | 'smtp' | 'internal' | 'tracking'`, což je přesně CHECK P03.

**Slovník `message_events.type`.** Všechny typy zapisované plánem (sent, delivered, bounced_hard, bounced_soft, complained, delivery_delayed, rejected) jsou v CHECK.

**Slovník `messages.status`.** Plán zapisuje pending, skipped, sent. Claim a failed vlastní sender. Vše v CHECK.

**Slovník `suppressions.reason`.** `hard_bounce`, `soft_bounce_threshold` a `complaint` jsou v CHECK P03.

**`messages` kontraktní sloupce.** `kind`, `content_variant_id`, `ambiguous_count`, `dispatch_started_at` jsou v P03 přesně podle požadavku R-P03.4. Rozhodnutí D1 (test podle `kind`, ne podle `render_data['_test']`) je schématem plně podpořené.

**Anonymizace při GDPR výmazu.** `UPDATE messages SET email = ..., render_data = '{}'::jsonb` a `UPDATE message_events SET recipient = ...` (úkol 19, ř. 3490-3503) sedí s grantem z migrace 0006: `GRANT UPDATE (contact_id, erased_at, recipient) ON message_events TO mlain_app`. Tvar placeholderu `erased+{contact_id}@erased.invalid` je shodný s rozhodnutím R3 P03.

**`deliverability_snapshots` sloupce.** Chybějící `opens`, `clicks`, `unsubscribes` a `reputation` nejsou nález: P13 do nich nic nepíše a otevírání i prokliky vlastní P14 přes `campaign_stats`. `rollupDay` zapisuje právě těch sedm metrik, které tabulka má.

**`campaigns.compiled_hash` jako TEXT.** Funkčně konzistentní s hex výstupem `createHash('sha256').digest('hex')`, viz N1 pro poznámku ke konvenci.

**Index `idx_messages__ws_email_pending`.** `revokePending` (úkol 17, ř. 3197-3209) na něj spoléhá a index v P03 je.

**Index `idx_message_events__recipient_bounce`.** `countSoftBounces` ho využívá a index v P03 je, včetně částečné podmínky na tři typy odrazů.

**Grant `INSERT ON message_events` pro sender.** V P03 je, plán s ním počítá v hranici z kapitoly 3.

---

## Řádky pro souhrnnou tabulku

| Co doplnit | Kdo žádá | Typ nebo tvar | Proč |
|---|---|---|---|
| messages: dohledání kontaktu u testu, nebo povolit NULL u kind='test' | P13 úkol 50, ř. 9530 `sendTest`; API schéma ř. 9998 `contact_id` optional | oprava v P13, nebo `CHECK (kind='test' OR contact_id IS NOT NULL)` + `DROP NOT NULL` | Každé testovací odeslání bez `contact_id` skončí chybou 23502, devět testů úkolu 50 nemůže projít |
| message_events.content_key text + UQ (workspace_id, content_key, received_at) | P13 úkol 41, ř. 7700 `insertEventOnce`; test ř. 7521 očekává n=1 | `ALTER TABLE message_events ADD COLUMN content_key text;` plus unikátní index | `uq_message_events__once_per_message` obsahuje `received_at DEFAULT now()`, takže nikdy nesepne; P13 tutéž past správně vyřešil u receipts |
| packages/db/package.json: exporty "./tx" a "./repo/*" | P13 ř. 471 test `import('@mlain/db/tx')`; přes 60 importů `withTx` a `@mlain/db/repo/*` | `"./tx": "./src/repo/tx.ts"`, `"./repo/*": "./src/repo/*.ts"` | P03 má jen pět exportů; bez toho se nezkompiluje žádné repository P13 |
| Rozhodnutí o `withTx(ctx, fn)` vs `withWorkspace(pool, ctx, fn)` | P13 ř. 1357 a dalších zhruba 60 míst | tenký `withTx` nad modulovým poolem v `packages/db/src/repo/tx.ts` | P03 exportuje jen tříargumentový `withWorkspace`; P13 pool nepředává a v `packages/core` ho ani mít nesmí |
| Primitivum pro odpojení partition mimo RLS a pod rolí s právem na DDL | P13 úkol 45, ř. 8508 `detachAndDrop` volá `DROP TABLE` pod `withTx` | volat `dropPartitionsBefore(client, table, column, before, veto)` z P03 plus spojení jako `mlain_migrator` | `mlain_app` není vlastník tabulky (42501) a `canDetachPartition` pod RLS vidí jen jeden projekt, takže by odpojil partition s živou kampaní cizího projektu |
| Zápis `campaigns.release_at` při startu materializace | P13 rozhodnutí D12 (potvrzeno zadavatelem), úkol 25 `undoState` ř. 4389 | `UPDATE campaigns SET release_at = ...` ve `startMaterialization` | Sloupec existuje, ale nikdo do něj nepíše; `undoState` dostane vždy null a undo okno nefunguje, aniž by cokoli spadlo |
| sending_providers.review_status text | P13 ř. 5117 `review_status` z `GetAccount`, ř. 5511 v signatuře `updateAccountSnapshot` | `ALTER TABLE sending_providers ADD COLUMN review_status text;` bez CHECK | Hodnota z AWS projde třemi vrstvami a v UPDATE tiše zmizí; preflight podle ní má rozlišit PENDING a DENIED žádost o produkční přístup |
| trg_campaigns__immutable_while_sending s explicitním seznamem sloupců | P13 R-P03.3 ř. 151, `IMMUTABLE_WHILE_SENDING` ř. 771-779, rozhodnutí D18 | trigger nad čtrnácti sloupci plus `compile_meta` a `compiled_hash` | P03 nemá jediný `CREATE TRIGGER` a konvence říká, že `updated_at` mění aplikace, ne trigger; požadavek je schovaný v odkazu na cizí dokument |
| rollupDay: join přes campaigns na provider_id | P13 úkol 43, ř. 8194-8211 (CTE `s` i `e` filtrují jen workspace_id a datum) | `JOIN campaigns c ON c.id = m.campaign_id AND c.provider_id = $2` | `deliverability_snapshots` má PK (workspace_id, provider_id, day), ale `messages` ani `message_events` provider_id nenesou; projekt se dvěma providery dostane u obou stejná čísla |
| Zápis campaigns.audience_breakdown a rozšíření gate rozpadu | P13 R-P03.1 ř. 149 (jediný výskyt), job ř. 3036-3042 slévá šest bran do tří | `UPDATE campaigns SET audience_breakdown = $3::jsonb` v `setGateCounters` | Bez zápisu je R-P03.1 mrtvý sloupec a řádek „Vyloučeno" se zase stane souhrnným, což část 6, 8.6.2 zakazuje |
| countWithTimeout přepsat na withReadOnly | P13 úkol 11, ř. 2092-2098 `withTx` plus ruční `SET LOCAL` | `withReadOnly(pool, ctx, timeoutMs, fn)` | P03 ho navrhl přesně pro dynamicky složené SQL z kompilátoru, aby chyba nemohla zapsat; P13 ho nahradil zapisovatelnou transakcí |
| Repository zápisů pro sender_domains (create, setMailFrom, remove) | P13 API ř. 10285-10305 `domains.add`, `setMailFrom`, `remove`; `DomainRow` ř. 6534 | INSERT a UPDATE nad `dkim_tokens`, `dkim_status`, `mail_from_subdomain`, `mail_from_status`, `ses_verification_status` | Sedm sloupců a čtyři CHECK slovníky P03 nemají v P13 žádného zapisovatele, fáze G je nespustitelná |
| Rozhodnutí o prefixu [TEST] v předmětu | P13 ř. 9524 `subject` s prefixem, vrací se jen v odpovědi API | buď zahodit, nebo řádek `campaign_content_variants` plus `messages.content_variant_id` | `messages` nemá `subject`; uživatel dostane testovací mail nerozeznatelný od ostrého |
| created_at = now() u testovacích zpráv plus filtr kind v úklidu | P13 ř. 9525 `createdAt = audience_built_at`; `cancelPendingBatch` ř. 4105, `isOutboxDrained` ř. 4571 | `AND kind = 'campaign'` v obou dotazech | UQ (campaign_id, contact_id, created_at) koliduje při opakovaném testu a zrušení kampaně zruší i čekající testy; `finishMaterialization` ten filtr už správně má |
