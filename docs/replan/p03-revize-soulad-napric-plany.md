# Revize P03: soulad schématu s doménovými plány

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Revize plánu P03, úhel soulad s doménovými plány z prověrky plánů
> (31. 7. až 1. 8. 2026), tedy kontrola **textu plánu před stavbou**, ne kontrola kódu.
> **Verdikt typu „plán není proveditelný" se týkal tehdejšího plánu, ne dnešního produktu.** Ten stojí a funguje.
> Opravy se prováděly podle `docs/superpowers/plans/POSTUP-OPRAV.md`; **stav jednotlivých nálezů neověřen**.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

Datum: 2026-08-01
Recenzovaný plán: `docs/superpowers/plans/2026-07-31-p03-databaze-schema-rls.md` (7220 řádků, 73 tabulek)
Úhel revize: co doménové plány od schématu potřebují a co jim P03 nedává.

## Verdikt: NALEZENY PROBLÉMY

Schéma je vnitřně konzistentní. Ověřil jsem strojově, že sedí všechny tři počty, na kterých
plán staví: 73 tabulek rozdělených po doménách, whitelist devíti tabulek bez `workspace_id`
a seznam 63 tabulek s politikou `ws_isolation` v migraci 0004, který přesně odpovídá výpočtu
„73 minus 9 whitelist minus `audit_log`". Nic nepřebývá ani nechybí.

Problém není uvnitř P03, ale na jeho hranici. Doménové plány vznikaly proti hotovému schématu
a **na jedenácti místech píšou proti sloupcům, primitivům nebo právům, které neexistují**.
Dvě z nich znamenají, že celá doména nebude fungovat: tracking nezapíše jedinou událost
a datová vrstva se nezkompiluje.

## Rozsah ověření a jeho meze

Všechno níže jsem ověřil přímým čtením nebo grepem v souborech plánů, ne odvozením.
U každého nálezu je uvedeno, kde v kterém plánu je požadavek napsaný.

Poctivé přiznání k pokrytí: devět paralelních recenzentů, které jsem na jednotlivé doménové
plány pustil, nedoběhlo. Co je tady, jsem ověřil sám. Pokrytí je proto nerovnoměrné:

| Plán | Hloubka ověření |
|---|---|
| P03 | úplné, celé DDL, RLS, granty, primitiva, testy |
| P04 | úplná kapitola předpokladů 0.6 a rozhodnutí 0.7, plus grep datového přístupu |
| P09 | úplná kapitola 31 a celá testovací replika schématu |
| P10 | zápis do `message_events`, kapitola rozporů, seznam požadavků |
| P11, P13 | úplné kapitoly „požadavky na jiné plány" |
| P07, P14 | kapitoly požadavků a cílené grepy, ne vyčerpávající průchod |
| P08, P16 | jen cílené grepy, kapitolu požadavků na P03 nemají |

**P08 a P16 by měly projít ještě jednou.** P07 a P14 jsou pokryté na úrovni jejich vlastních
kapitol požadavků, což u plánu o 27 tisících řádcích není totéž jako úplná kontrola.

## Nálezy, které už jsou v evidenci a tady se neopakují

`identities.shared`, `message_events.processed_at`, `withWorkspaceTx`, `createSystemContext`,
příznak ukázkovosti, `campaign_links.id` jako UUIDv5, `campaigns.compile_meta`,
kód `contract_mismatch` v registru, záloha pod rolí s RLS (N7).
Viz `docs/superpowers/plans/NALEZY-NAPRIC-PLANY.md`.

---

# Kritické

Implementace by spadla, nebo by tiše zapisovala špatně.

## K1. P10 zapisuje do `message_events` bez tří `NOT NULL` sloupců

**Kdo žádá:** P10, úkol 14, `packages/core/tracking/repo/message-events.repo.ts`,
funkce `insertMessageEvents`.

Vkládá sloupce `id, workspace_id, message_id, message_created_at, campaign_id, contact_id,
type, subtype, ts, link_id, metadata`.

**Co P03 má** (DDL na řádcích 4126 až 4158):

```
recipient   text     NOT NULL,   -- řádek 4134
rank        smallint NOT NULL,   -- řádek 4138
source      text     NOT NULL,   -- řádek 4141, CHECK IN ('ses_sns','smtp','internal','tracking')
```

Žádný z těch tří nemá `DEFAULT`.

**Co se stane:** každé otevření a každý proklik skončí chybou `23502 not_null_violation`.
Tracking nezapíše jedinou událost, `campaign_stats`, `message_engagement`
i `contact_engagement` zůstanou na nule a report kampaně bude prázdný. Zároveň to znamená,
že hlavní metrika produktu, tedy proklik, nebude existovat.

Že je schéma v pořádku a chyba je na straně zápisu, dokládá vlastní test P03 na řádku 6508,
který všechny tři sloupce vyplňuje.

**Druhotný důsledek:** P10 zapisuje přes `withSystemTx`, které `mlain.workspace_id` nenastavuje.
I kdyby sloupce doplnil, `ws_isolation` s `WITH CHECK` vyhodnoceným jako NULL zápis odmítne.
To spadá pod už evidované primitivum `createSystemContext`.

### Na které straně opravit: rozdělit podle sloupce

Koordinátor se ptal zvlášť na tenhle bod, takže rozepisuji každý sloupec samostatně.
Odpověď není u všech tří stejná a plošné doplnění `DEFAULT` by byla ta nejhorší varianta,
protože by chybu z hlasité udělalo tichou.

**`source`: opravit v P10.** Hodnota je skutečně různá podle zapisovatele a z typu události ji
odvodit nejde: `delivered` může přijít z `ses_sns`, ze `smtp` i `internal`. `NOT NULL` je tedy
správně a `DEFAULT` by byl škodlivý, protože by mlčky označil událost od providera za vlastní.
P10 doplní do zápisu konstantu `'tracking'`, kterou `CHECK` už dnes povoluje. **P03 se nemění.**

**`rank`: opravit v P03, a to změnou na generovaný sloupec.** Tady je jádro problému.
`rank` je čistá funkce typu události: P13 to sám dokládá katalogem v úkolu 40
(`sent` 20, `delivery_delayed` 25, `delivered` 30, `bounced_soft` 60, `bounced_hard` 80,
`complained` 85, `rejected` 90). Když je hodnota odvoditelná z jiného sloupce téhož řádku,
je předávání zvenčí zbytečná příležitost k chybě, a P10 do ní právě spadl. `DEFAULT` je
u `rank` obzvlášť nebezpečný: špatná hodnota nezpůsobí chybu, ale tiše rozbije odvození stavu
zprávy, což je přesně ten druh poruchy, kterému se celý projekt vyhýbá.

Doporučuji `rank smallint GENERATED ALWAYS AS (CASE type WHEN ... END) STORED`. Výraz nad
literály je `IMMUTABLE`, takže je to legální, a P03 už generované sloupce používá
(`contacts.email_domain`, `contacts.search_text`), takže to není nová konvence. Vlastnictví
škály tím přechází na P03, což dává smysl, protože P03 už vlastní slovník `type` a obojí se
pak mění jedinou migrací naráz. Zmizí tím i nález D1 níž.

Náhradní varianta, kdyby generovaný sloupec neprošel: ponechat `NOT NULL` bez defaultu
a přesunout `rankOf()` do `packages/contracts` (P02), aby P10 i P13 četly jednu tabulku.
Je to horší, protože ochranu nahrazuje dohodou.

**`recipient`: opravit v P03, uvolněním na nullable s podmíněným `CHECK`.**
`recipient` má v P03 jediného čtenáře, index `idx_message_events__recipient_bounce`
(řádek 4173), který je částečný přes `type IN ('bounced_soft','bounced_hard','complained')`.
Pro otevření a prokliky tu hodnotu nečte nikdo. Zato je to osobní údaj a `NOT NULL` znamená,
že se e-mailová adresa okopíruje na každý řádek desetimilionové tabulky a při výmazu podle
článku 17 se musí anonymizovat všude (proto je `recipient` ve sloupcovém grantu v migraci 0006).

Držet `NOT NULL` pro celý výčet dvanácti typů je tedy náklad bez užitku a zároveň
riziko z hlediska minimalizace údajů. `DEFAULT ''` je nepřijatelný: prázdné řetězce by se
dostaly do bounce indexu a rozhodování o suppression by pracovalo s tichým nesmyslem.

Doporučuji:

```sql
ALTER TABLE message_events ALTER COLUMN recipient DROP NOT NULL;
ALTER TABLE message_events ADD CONSTRAINT ck_message_events__recipient
  CHECK (type NOT IN ('sent','rejected','delivered','delivery_delayed',
                      'bounced_hard','bounced_soft','complained')
         OR recipient IS NOT NULL);
```

Doručovací rodina, na které bounce index stojí, adresu mít musí. Tracking, který ji k ničemu
nepotřebuje, ji přestane rozmnožovat. P10 pak zápis neupravuje vůbec.

**Shrnutí odpovědi:** P10 doplní jeden sloupec (`source`), P03 opraví dva (`rank` na generovaný,
`recipient` na podmíněný). Žádný z těch tří nemá dostat `DEFAULT`.

## K2. Typ `Tx` je neslučitelný mezi P03 a P04

**Kdo žádá:** P04, kapitola 0.6, tabulka předpokladů, řádek 238: „`type Tx`, typ transakčního
handle **Drizzle**". Kód to potvrzuje: `tx.select().from(schema.idempotencyKeys)` (řádek 2291),
`tx.delete(schema.idempotencyKeys)` (2335), `tx.select().from(schema.sessions)` (3759),
`tx.execute(sql\`...\`)` (2075 a dál).

**Co P03 má:** `packages/db/src/repo/tx.ts`, řádek 5604: `export type Tx = PoolClient;`,
tedy syrový klient z `pg`, jehož jediné API je `client.query(text, params)`. Metody
`.select()`, `.insert()`, `.delete()` ani `.execute()` na něm neexistují. P03 navíc Drizzle
handle nikdy nevyrobí: `withWorkspace` pracuje nad `pool.connect()` a `db.transaction()`
nevolá nikde.

**Co se stane:** neprojde typová kontrola v každém souboru, který sahá na data.
Protože P04 dodává adaptér `packages/core/tx` všem doménovým plánům, spadne to naráz
u P04, P07, P10, P11, P13, P14 a P15.

**Opravit v P03.** Je to jediné místo, kde to jde opravit jednou. Transakční obálky mají
otevírat transakci přes `drizzle(pool).transaction()` a vracet Drizzle handle;
`set_config` se uvnitř provede přes `tx.execute(sql\`select set_config(...)\`)`.
Kdo potřebuje syrový přístup, dostane ho přes `tx.execute`. Opravovat to na straně P04
by znamenalo přepsat datovou vrstvu na `client.query` se stringy, což ruší smysl Drizzle
i typovanou vazbu na schéma.

## K3. Transakční primitiva se jmenují jinak a mají jiné signatury

**Kdo žádá:** P04, kapitola 0.6, tabulka předpokladů:

| Co P04 čeká | Co P03 exportuje |
|---|---|
| `withWorkspaceId(workspaceId, fn)` | `withWorkspace(pool, ctx, fn)` |
| `withUserId(userId, fn)` | `withUser(pool, userId, fn)` |
| `withoutContext(fn)` | neexistuje |
| (P10 volá `withSystemTx`) | neexistuje |

Liší se jméno, počet argumentů, a hlavně typ prvního parametru: P03 chce branded
`WorkspaceContext`, P04 vědomě chce `workspaceId: string`, aby nevznikl cyklus
`db → core → db` (rozhodnutí R2, řádek ~270). Navíc žádná z obálek P03 nebere `pool`
implicitně, takže volající musí pool protáhnout všude.

**Opravit v P03**, protože primitiva vlastní. Rozhodnout jednu sadu jmen a signatur
a promítnout ji do P04 a P10. P04 má na to připravený sloupec „adaptér", takže náklad
je jedním souborem, ale sada musí být úplná, tedy včetně varianty bez kontextu.

## K4. `WorkspaceContext` má dvě domovské adresy

**Kdo žádá:** P04, rozhodnutí R2 (řádek ~270): „`WorkspaceContext` je definovaný
v `packages/core/identity/types.ts`. Typ a jeho jediná továrna patří k sobě, jinak vznikne
branded typ, který jde vyrobit ze dvou míst."

**Co P03 má:** definuje `WorkspaceContext` i `Actor` v `packages/db/src/context.ts`
(řádky 5560 až 5594) a oba exportuje z `src/index.ts`.

Argument P04 je věcně správný, ale P03 dnes vyrábí přesně ten stav, před kterým P04 varuje:
existují dva typy téhož jména ve dvou balíčcích a `unsafeWorkspaceContext` je druhá továrna.

**Opravit rozhodnutím, provést v P03.** Doporučuji ponechat definici typu v P03 (potřebuje ho
`withWorkspace` a nemůže záviset na `core`) a v P04 typ jen reexportovat, nikoli redefinovat,
přičemž jediná legitimní továrna žije v `packages/core/identity`. `unsafeWorkspaceContext`
zůstane, ale výhradně pro testy a migrační joby, jak už P03 píše.

## K5. Idempotence zápisu událostí v P10 nefunguje

**Kdo žádá:** P10, úkol 14, test „zápis dávky do `message_events` proběhne jedním příkazem
a je idempotentní". Zápis končí `ON CONFLICT (id, received_at) DO NOTHING`.

**Proč to nefunguje:** `received_at` není v seznamu vkládaných sloupců, takže se doplní
`DEFAULT now()` a je při každém běhu jiné. Konflikt na primárním klíči `(id, received_at)`
proto **nikdy nenastane** a opakovaný běh jobu vloží tytéž události znovu.

Je to táž past, kterou P03 sám popsal a vyřešil u `provider_event_receipts` (řádky 4204 až 4210):
„`received_at` je `now()`, takže samotný `ON CONFLICT` by NIKDY nesepnul. Skutečnou
deduplikaci dělá explicitní `WHERE NOT EXISTS`."

**Opravit v P10.** Buď `received_at` do zápisu vkládat explicitně, nebo deduplikovat přes
`WHERE NOT EXISTS` nad `(workspace_id, id)`, po vzoru, který P03 už má.

## K6. P13 žádá trigger, který P03 zakazuje a testem vylučuje

**Kdo žádá:** P13, kapitola 4.2, požadavek R-P03.3: „včetně triggeru
`trg_campaigns__immutable_while_sending`".

**Co P03 má:** konvenci na řádku 1199 („`updated_at` aktualizuje aplikace explicitně, ne
trigger. Trigger je neviditelná magie, kterou Go strana nezná.") a test na řádku 3681
(„žádná tabulka nemá trigger", `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal`).

**Co se stane:** kdo splní P13, shodí test P03. Kdo splní P03, nesplní R-P03.3.

**Opravit rozhodnutím.** Doporučuji zůstat u zákazu triggerů, protože argument o Go straně
platí (sender `campaigns` mění a trigger by nečekaně sáhl do jeho transakce), a neměnnost
kampaně za běhu vynutit sloupcovým grantem plus aplikační kontrolou. Kdyby zvítězil trigger,
musí se změnit i test P03, jinak je ochrana proti driftu jen na papíře.

## K7. Chybí tabulka `platform.rate_limits`

**Kdo žádá:** P04, kapitola 0.6: „`@mlain/db` (migrace), tabulka `platform.rate_limits`,
pro `RATE_LIMIT_BACKEND=postgres`, ověřuje preflight".

**Co P03 má:** nic. Grep na `rate_limit` v celém P03 nevrací jediný výskyt, tabulka není
v registru 73 ani ve whitelistu.

**Co se stane:** preflight P04 (úkol 1) selže a rate limiting s postgresovým backendem
nejde spustit.

**Opravit v P03.** Pozor na dvě věci: schéma `platform` v P03 neexistuje (všechno je
v `public`), takže je potřeba rozhodnout jméno, a tabulka nemá `workspace_id` v obvyklém
smyslu (rozsah je `user` i `workspace`), takže patří buď na whitelist, nebo dostane
`workspace_id` nullable a vlastní politiku po vzoru `audit_log`.

## K8. Chybí sloupce pro odklad při rotaci API klíče

**Kdo žádá:** P04, kapitola 0.6: „sloupce `api_keys.previous_secret_hash bytea`
a `api_keys.previous_expires_at timestamptz`, doplněk k DDL 2.3 podle 3.5, **bez nich
nefunguje `grace_seconds`**".

**Co P03 má:** `api_keys` má `secret_hash`, `expires_at`, `revoked_at`, nic pro předchozí klíč.

**Co se stane:** rotace API klíče je buď okamžitá, nebo se musí obejít druhým řádkem
v `api_keys`, což rozbije `uq_api_keys__prefix` a ověřovací algoritmus, který podle prefixu
dělá jediný lookup.

**Opravit v P03.**

## K9. `campaign_render_warnings` má senderský grant, ale ne politiku `sender_bypass`

**Kdo žádá:** nikdo, a to je součást nálezu. Je to vnitřní rozpor P03.

**Co P03 má:** tabulka je v seznamu 63 tabulek s `ws_isolation` (řádek 5050), sender na ni
má `GRANT INSERT, UPDATE` (řádek 5243) s komentářem „Sender je drží v paměti a zapisuje jednou
za 10 sekund", ale **není mezi sedmi tabulkami s politikou `sender_bypass`** (řádky 5136 až 5148).
Sender `mlain.workspace_id` z principu nikdy nenastavuje, takže `WITH CHECK` se vyhodnotí
jako NULL a zápis skončí chybou row-level security. Žádný ze sedmnácti testů
v `sender-role.test.ts` do té tabulky nezapisuje, takže to testy nezachytí.

**Druhá polovina nálezu:** do tabulky nezapisuje nikdo. Grep na `campaign_render_warnings`
vrací nula výskytů v P08, P09, P13 i P14. P09 (sender) ji nezmiňuje ani jednou, přestože
P03 tvrdí, že ji zapisuje sender, a P14 (report) ji nečte, přestože P03 tvrdí, že ji čte report.

**Opravit v P03 a rozhodnutím.** Nejdřív rozhodnout, jestli agregovaná varování z renderu
v MVP 0 vůbec jsou. Pokud ano, doplnit `sender_bypass`, doplnit senderu `SELECT`
(bez něj neprojde `ON CONFLICT DO UPDATE`, které čte `count` existujícího řádku)
a zapsat požadavek na P09, protože dnes tu funkci neimplementuje. Pokud ne, zrušit grant
a nechat tabulku bez práv, ať neexistuje mrtvá zapisovací cesta do projektových dat.

---

# Důležité

## D1. `message_events.rank` nemá definovanou škálu a P13 používá jiný klíč než `CHECK`

**Kdo žádá:** P13, úkol 40, katalog událostí. Test na řádku 7308 volá `rankOf('opened')`,
zatímco `ck_message_events__type` v P03 povoluje `open`, ne `opened`.

P03 sloupec jen zakládá (`rank smallint NOT NULL`, bez `CHECK`, bez komentáře),
P10 slovo `rank` nezná vůbec, P14 taky ne. Škála existuje jen uvnitř P13.

**Opravit v P03 a P13.** Pokud projde generovaný sloupec z K1, škála se přesune do P03
a `opened` v P13 se opraví na `open` automaticky, protože katalog přestane být zdrojem hodnoty.

## D2. P09 si drží vlastní repliku schématu a už teď se rozchází

**Kdo žádá:** P09, `apps/sender/internal/testsupport/schema.sql` (úkol 8, řádky 2398 až 2610).
Plán to přiznává na řádku 15462: „testovací replika, kdykoliv se rozejde se skutečnými
migracemi z P03, platí P03 a replika se srovná."

Přiznání je poctivé, ale mechanismus chybí a replika se **už teď rozchází na šesti místech**:

| Věc | P09 replika | P03 |
|---|---|---|
| `message_events` partiční klíč | `PARTITION BY RANGE (ts)`, PK `(id, ts)` | `PARTITION BY RANGE (received_at)`, PK `(id, received_at)` |
| `message_events.source` | `DEFAULT 'sender'`, bez `CHECK` | `NOT NULL`, `CHECK IN ('ses_sns','smtp','internal','tracking')` |
| `message_events` sloupce | chybí `campaign_id`, `recipient`, `rank`, `contact_id`, `erased_at`, `subtype`, `link_id` | všechny `NOT NULL` kromě posledních tří |
| `messages.contact_id` | nullable | `NOT NULL` (rozhodnutí R3) |
| `sending_providers.quota_max_send_rate` | `double precision` | `numeric(10,2)` |
| `suppressions.email`, `reason` | nullable `text` | `citext NOT NULL`, resp. `text NOT NULL` |
| `messages` omezení | chybí `ck_messages__attempts`, `ck_messages__sent_has_timestamp` | obojí je |

Partiční klíč podle `ts` je přesně ta chyba, kterou P03 označuje za tvrdou
(řádky 4121 až 4124): zpožděný bounce s časovou značkou mimo okno by tvrdě selhal.

**Opravit v P09**, plus doplnit vynucení. P09 se odvolává na CI job `contracts-schema`,
ale ten podle P03 porovnává jen kontraktní podmnožinu sloupců `messages` ze 4.10.1,
takže rozchod v `message_events`, `suppressions` ani v typech nezachytí.
Buď se replika generuje ze skutečných migrací, nebo job musí porovnávat všechno,
co replika obsahuje.

## D3. Chybějící sloupce, které doménové plány výslovně žádají

Všechny jsem ověřil grepem v P03, žádný neexistuje.

| Sloupec | Kdo žádá | Kde je to napsané |
|---|---|---|
| `contacts.search_key text` | P07 | rozhodnutí R12, řádek 216: „Je to požadavek na P03: sloupec `search_key text` na `contacts` a trigramový index nad ním místo nad `search_text`" |
| `imports.stored_error_count` | P11 | kapitola „Na P03", požadavek 3.2 |
| `imports.resume_from_import_id` | P11 | kapitola „Na P03", požadavek 3.3, kritérium 35 části 6 |
| `campaigns.audience_breakdown jsonb` | P13 | kapitola 4.2, R-P03.1, část 6 bod 8.6.2 |
| `sender_domains.delegation_token_hash text` | P13 | kapitola 4.2, R-P03.2, část 6 bod 8.2.5 |
| `sender_domains.delegation_expires_at timestamptz` | P13 | tamtéž |
| `sender_domains.delegation_created_by uuid` | P13 | tamtéž, plus částečný unikátní index |

`contacts.search_key` je z nich nejzávažnější: bez něj hledání bez diakritiky nefunguje
obousměrně a P07 na to nemá náhradní cestu, protože rozšíření `unaccent` je zamítnuté
a generovaný sloupec ho použít nemůže (funkce je `STABLE`, ne `IMMUTABLE`).

**Opravit v P03.**

## D4. P13 žádá funkci v adresáři, který výhradně vlastní P03

**Kdo žádá:** P13, kapitola 4.3, požadavek R-P07.1: „**`countAudienceGates(ctx, audience, opts)`**
v `packages/db/src/repo/segments.ts`".

**Proč je to nález:** kapitola 7 P03 vyjmenovává čtyři soubory v `packages/db/src/repo`
(`tx.ts`, `registry.ts`, `workspaces-global.ts`, `audit-global.ts`) a kapitola 8 zakazuje
ostatním plánům zakládat cokoli v `packages/db`. P13 tady adresuje požadavek P07,
ale umisťuje ho do balíčku P03. Porušení řídicího pravidla „každý soubor má právě jeden plán".

**Opravit v P13** přeformulováním: funkce patří do `packages/core/segments`, kde ji P11
už vlastní, a P03 se jí netýká.

## D5. Neshoda jmen u rollupu `contact_engagement`

**Kdo žádá:** P11, kapitola „Na P10 a P14", požadavek 10.1: sloupce `sent_count`,
`delivered_count`, `opened_count`, `clicked_count`, `bounced_count`.

**Co P03 má:** `sent_total`, `delivered_total`, `opens_total`, `clicks_total`, `bounces_total`.
Časové sloupce (`last_sent_at`, `last_open_at`, ...) sedí.

**Opravit v P11.** Schéma se nemění: P10, který do rollupu skutečně zapisuje, používá jména
z P03 (`opens_total` na řádcích 8182 a 8199, `sent_total` na 8563), takže jediný, kdo se
odchyluje, je text požadavku v P11.

## D6. Není potvrzené, že transakční obálka pustí `SET LOCAL` uvnitř

**Kdo žádá:** P11, kapitola „Na P03", požadavek 3.6: „Potvrzení, že `withWorkspaceId` dovolí
uvnitř transakce `SET LOCAL transaction_read_only`, `statement_timeout` a `work_mem`.
Náhled segmentu na tom stojí."

**Co P03 má:** `withReadOnly` (řádek 5671) otevírá `BEGIN READ ONLY` a nastavuje
`statement_timeout` z parametru, ale `work_mem` neumí a `transaction_read_only` už je dané
otevřením. `withWorkspace` `SET LOCAL` nebrání, ale P03 to nikde negarantuje ani netestuje.

**Opravit v P03** doplněním `work_mem` do `withReadOnly` a testem, který to tvrzení ověří
spuštěním, ne slovem.

## D7. Indexy nad `contacts.attributes` nikdo nezakládá, přestože schéma s nimi počítá

**Kdo žádá:** implicitně P11 (segmenty nad vlastními poli). P03 má v `contact_fields` sloupce
`indexed boolean` a `index_state text CHECK IN ('none','building','ready','failed')`.

Stav `building` znamená, že někdo za běhu vytváří index nad `contacts.attributes`.
Kapitola 8 P03 ale zakazuje ostatním plánům zakládat indexy a P03 sám žádnou utilitu
na to nedodává. `idx_contacts__attributes_gin` s `jsonb_path_ops` umí jen operátor `@>`,
což na rozsahové a porovnávací operátory ze čtyřicetiprvkové matice části 2 nestačí.

**Opravit v P03** dodáním utility po vzoru `createMonthlyPartitions`
(například `ensureAttributeIndex`), aby DDL zůstalo v jednom balíčku,
nebo rozhodnutím, že `indexed` je v MVP 0 mrtvý sloupec.

## D8. Šifrované obálky mají tři různé typy pro tentýž formát

**Kdo žádá:** P16 (`mlain rotate-credentials` musí přešifrovat všechny čtyři),
P13 (R-P02.1, `encryptCredential` vrací `string`), P04 (`encryptEnvelope` vrací `enc:v1:<base64>`).

**Co P03 má:**

| Sloupec | Typ |
|---|---|
| `sending_providers.config_encrypted` | `text` |
| `webhook_endpoints.secret_encrypted` | `text` |
| `inbound_endpoints.secret_encrypted` | **`bytea`** |
| `ai_provider_credentials.api_key_encrypted` | **`bytea`** |

Obálka kontraktu 4.10.4 je textová (`enc:v1:<base64>`). Dva sloupce ze čtyř ji tedy nemohou
uložit bez konverze a rotace klíče by na nich musela pracovat jinak než na zbylých dvou.

**Opravit v P03** sjednocením na `text`.

## D9. `@mlain/db` nereexportuje `schema`

**Kdo žádá:** P04, řádky 386 a 469: `import { schema, withWorkspaceId, ... } from '@mlain/db'`,
dále `schema.sessions`, `schema.idempotencyKeys`.

**Co P03 má:** `src/index.ts` (řádky 7001 až 7031) schéma nereexportuje vůbec.
Podcesta `@mlain/db/schema` existuje v `exports` mapě, ale `schema/index.ts` je
`export * from './identity.js'` a dál, tedy pojmenované exporty, ne jmenný objekt.

**Opravit v P04** adaptérem (`import * as schema from '@mlain/db/schema'`), což je jeden řádek.
Doporučuji ale zároveň v P03 doplnit `export * as schema from './schema/index.js'`,
aby existoval jeden zjevný způsob a plány si ho neodvozovaly každý po svém.

## D10. Sender má zapisovací právo do `message_events`, které nikdy nepoužije

**Kdo žádá:** kontrakt 4.10.1, přenesený do P03 (`GRANT INSERT`, `sender_bypass`)
i do repliky P09.

**Co P09 říká:** řádek 15304, u scénáře `OB-15`: „sender do `message_events` v běžném provozu
nezapisuje". Grep to potvrzuje: P09 tabulku zmiňuje jen v DDL repliky, v grantech
a v testu, který ověřuje, že z ní **nesmí** číst.

**Opravit rozhodnutím.** Buď se právo zúží (least privilege: sender má dnes zapisovací
přístup do append-only tabulky s osobními údaji, kterou nepotřebuje), nebo se P09 doplní
o zápis `circuit_breaker_open`, což je zjevně zamýšlené použití, viz N1 níž.

---

# Poznámky

**N1. `circuit_breaker_open` nezapisuje nikdo.** Hodnota se v celém repozitáři vyskytuje
pouze v P03 (rozhodnutí R5, `CHECK` na řádku 4149 a vlastní test na řádku 6514, který ji
vkládá s `rank` 90 a `source` `'internal'`). P09 circuit breaker řeší pozastavením kampaně,
P13 zápisem do `pause_reason`. Souvisí s D10: test P03 ukazuje zamýšlené použití,
které žádný doménový plán neimplementuje.

**N2. `campaign_conversion_stats` je v pořádku.** P03 ji nezakládá a P14 to na řádku 10288
potvrzuje („Konverze a tržby se nedělají, `campaign_conversion_stats` se nezakládá").
Bez rozporu.

**N3. Nejednotné typy hashů.** `templates.design_hash` a `template_versions.design_hash`
jsou `bytea`, ale `campaigns.compiled_hash` je `text`. Stejná věc, dva typy.

**N4. Nejednotná šířka počitadel.** `campaigns.total_count` a spol. jsou `integer`,
zatímco `campaign_stats.sent` a spol. jsou `bigint`. U cílové velikosti pěti milionů kontaktů
`integer` stačí, ale rozdíl vynutí přetypování v každém dotazu, který obojí porovnává,
a P14 takové dotazy má.

**N5. Nejednotné primární klíče statistik.** `campaign_stats` má PK jen `campaign_id`,
zatímco `campaign_link_stats` má PK `(workspace_id, campaign_id, link_id)` s odůvodněním,
že se politika RLS má vyhodnocovat nad indexovaným sloupcem. U `campaign_stats` totéž
odůvodnění platí, ale klíč to nereflektuje.

**N6. `gdpr_requests.subject_email_fingerprint_key_id` nemá index**, zatímco
`suppressions.fingerprint_key_id` ho má kvůli `mlain doctor`. Pokud doctor kontroluje
pokolení klíčů i tady, bude to seq scan.

**N7. Sender vidí celé `campaigns` včetně `compiled_html`.** Sloupcový grant je jen na `UPDATE`,
`SELECT` je na celou tabulku. Je to nutné (sender obsah renderuje), ale stojí za zaznamenání
vedle důsledně zúženého zápisu.

**N8. P10 ukládá pozici odkazu do `message_events.metadata.link_position`** místo sloupce
(vlastní rozpor 7, řádek 12641) s odůvodněním, že `campaign_link_stats` vlastní P03.
Vědomé obcházení, funkční, ale stojí za zvážení při doplňkovém průchodu.

---

# Souhrnná tabulka: zadání pro jediný doplňkový průchod schématem

Řazeno podle závažnosti. Sloupec „strana" říká, kde se má oprava provést.

| Co doplnit nebo změnit | Kdo to žádá | Typ nebo tvar | Proč, jednou větou | Strana |
|---|---|---|---|---|
| `message_events.rank` na generovaný sloupec | P10 (zápis), P13 (katalog) | `smallint GENERATED ALWAYS AS (CASE type WHEN 'sent' THEN 20 ... END) STORED` | Hodnota je čistá funkce typu, takže ji nemá předávat volající, který na ni může zapomenout nebo ji uvést špatně. | P03 |
| `message_events.recipient` uvolnit na nullable s podmíněným `CHECK` | P10 | `text` NULL + `CHECK (type NOT IN ('sent','rejected','delivered','delivery_delayed','bounced_hard','bounced_soft','complained') OR recipient IS NOT NULL)` | Adresu čte jen bounce index, takže její kopírování na každé otevření je náklad i riziko podle GDPR. | P03 |
| `message_events.source` doplnit do zápisu trackingu | P10 | konstanta `'tracking'` | Bez ní každé otevření a proklik skončí chybou 23502 a tracking nezapíše nic. | **P10** |
| Transakční obálky musí vracet Drizzle handle | P04 a všechny doménové plány | `db.transaction()` místo `pool.connect()`, `type Tx` = Drizzle tx | Dnešní `Tx = PoolClient` nemá `.select()`, `.insert()` ani `.execute()`, takže se datová vrstva nezkompiluje. | P03 |
| Sjednotit jména a signatury primitiv | P04, P10 | `withWorkspaceId(workspaceId, fn)`, `withUserId(userId, fn)`, `withoutContext(fn)`, plus varianta pro systémové joby | P04 a P10 volají čtyři jména, z nichž P03 neexportuje ani jedno ve stejném tvaru. | P03 |
| `WorkspaceContext` mít definovaný na jednom místě | P04 (R2) | typ v P03, jediná továrna v `packages/core/identity`, v P04 jen reexport | Branded typ, který jde vyrobit ze dvou míst, přestává být branded. | P03 + P04 |
| Tabulka `rate_limits` | P04 (kapitola 0.6) | nová tabulka pro `RATE_LIMIT_BACKEND=postgres`, rozsah `user` i `workspace`, rozhodnout whitelist nebo vlastní politiku | Bez ní neprojde preflight P04 a rate limiting nad Postgresem nejde spustit. | P03 |
| `api_keys.previous_secret_hash` | P04 (kapitola 0.6) | `bytea` NULL | Bez něj nefunguje `grace_seconds` a rotace klíče je nutně okamžitá. | P03 |
| `api_keys.previous_expires_at` | P04 (kapitola 0.6) | `timestamptz` NULL | Tamtéž, určuje konec odkladu. | P03 |
| `sender_bypass` na `campaign_render_warnings`, nebo zrušit grant | vnitřní rozpor P03 | `CREATE POLICY sender_bypass ON campaign_render_warnings TO mlain_sender USING (true) WITH CHECK (true)` plus `GRANT SELECT` | Sender má na tabulku zápis, ale RLS ho nepustí, a žádný test to nezachytí. | P03 + rozhodnutí |
| `contacts.search_key` | P07 (R12, řádek 216) | `text` NULL, plní aplikace přes `normalizeNameKey()`, GIN trgm index nad ním | Bez něj nefunguje hledání bez diakritiky obousměrně a `unaccent` je zamítnutý. | P03 |
| `imports.stored_error_count` | P11 (3.2) | `bigint NOT NULL DEFAULT 0` | Odlišuje počet uložených chybných řádků od celkového, jinak se počítá `count(*)` na každou dávku. | P03 |
| `imports.resume_from_import_id` | P11 (3.3) | `uuid` NULL, FK na `imports(id)` | Pokračování zrušeného importu, kritérium 35 části 6. | P03 |
| `campaigns.audience_breakdown` | P13 (R-P03.1) | `jsonb` NULL | Kontrolní seznam, potvrzovací dialog i report mají ukazovat totéž číslo z jednoho zdroje. | P03 |
| `sender_domains.delegation_token_hash` | P13 (R-P03.2) | `text` NULL + částečný unikátní index | Delegační odkaz na DNS záznamy podle části 6, bodu 8.2.5. | P03 |
| `sender_domains.delegation_expires_at` | P13 (R-P03.2) | `timestamptz` NULL | Tamtéž, platnost odkazu. | P03 |
| `sender_domains.delegation_created_by` | P13 (R-P03.2) | `uuid` NULL, FK `users(id) ON DELETE SET NULL` | Tamtéž, kdo odkaz vydal. | P03 |
| Sjednotit typ šifrovaných obálek | P16, P13, P04 | `inbound_endpoints.secret_encrypted` a `ai_provider_credentials.api_key_encrypted` z `bytea` na `text` | Obálka kontraktu 4.10.4 je textová, takže dva sloupce ze čtyř ji dnes nemohou uložit bez konverze. | P03 |
| `work_mem` v `withReadOnly` a test na `SET LOCAL` | P11 (3.6) | parametr obálky plus test spuštěním | Náhled segmentu na tom stojí a dnes to není ani garantované, ani ověřené. | P03 |
| Utilita pro indexy nad `contacts.attributes` | P11, implikováno `contact_fields.index_state` | `ensureAttributeIndex()` po vzoru `createMonthlyPartitions` | Stav `building` předpokládá zakládání indexů za běhu, ale DDL smí jen P03 a utilitu nemá. | P03 |
| `export * as schema` z `@mlain/db` | P04 (řádky 386, 469) | reexport v `src/index.ts` | Aby existoval jeden zjevný způsob importu schématu místo čtyř odvozených. | P03 (+ adaptér v P04) |
| `campaign_links.id` zrušit `DEFAULT` | P13 (R-P03.6), navazuje na evidovaný nález N1 | `ALTER COLUMN id DROP DEFAULT` | `INSERT` bez explicitního ID pak selže v migraci místo tichým prázdným reportem. | P03 |
| Rozhodnout trigger `trg_campaigns__immutable_while_sending` | P13 (R-P03.3) | buď trigger a změna testu P03, nebo zamítnutí a jiná ochrana | P03 má konvenci zákazu triggerů a test, který je vylučuje, takže obojí naráz nejde. | rozhodnutí |
| Opravit idempotenci zápisu událostí | P10 (úkol 14) | `WHERE NOT EXISTS` nad `(workspace_id, id)` místo `ON CONFLICT (id, received_at)` | `received_at` je `now()`, takže konflikt nikdy nenastane a opakovaný běh vyrobí duplicity. | **P10** |
| Srovnat repliku schématu senderu | P09 (`testsupport/schema.sql`) | partiční klíč `received_at`, `contact_id NOT NULL`, `numeric(10,2)`, chybějící sloupce a `CHECK` | Replika je dnes volnější než produkce, takže testy senderu projdou i u kódu, který v produkci spadne. | **P09** |
| Rozšířit job `contracts-schema` na celou repliku | P09, P01 | porovnání všeho, co replika obsahuje, ne jen podmnožiny `messages` ze 4.10.1 | Bez toho je pravidlo „platí P03" jen věta, kterou nic nevynucuje. | P09 + P01 |
| Opravit `rankOf('opened')` na `'open'` | P13 (úkol 40) | klíč katalogu | `CHECK` v P03 hodnotu `opened` nedovolí. | **P13** |
| Přesunout `countAudienceGates` mimo `packages/db` | P13 (R-P07.1) | do `packages/core/segments` | Požadavek dnes umisťuje cizí funkci do balíčku, který výhradně vlastní P03. | **P13** |
| Srovnat jména sloupců `contact_engagement` | P11 (10.1) | `sent_total`, `delivered_total`, `opens_total`, `clicks_total`, `bounces_total` | P10, který do rollupu skutečně zapisuje, už používá jména z P03. | **P11** |
| Rozhodnout osud `campaign_render_warnings` | P03 vs P08, P09, P13, P14 | doplnit zapisovatele, nebo tabulku i grant zrušit | Zakládá se, má granty a politiku, ale nikdo do ní nezapisuje a nikdo z ní nečte. | rozhodnutí |
| Rozhodnout osud `circuit_breaker_open` | P03 vs P09, P13 | doplnit zápis v P09, nebo hodnotu z `CHECK` odebrat | Hodnota existuje jen v P03, žádný doménový plán ji nezapisuje. | rozhodnutí |
| Rozhodnout osud senderského `INSERT` na `message_events` | kontrakt 4.10.1 vs P09 (řádek 15304) | zúžit právo, nebo doplnit zápis | Sender má zapisovací přístup do append-only tabulky s osobními údaji, který nepoužívá. | rozhodnutí |

## Rozpočet průchodu

Tabulka má 31 řádků. Rozdělení podle strany opravy:

| Strana | Počet | Co to je |
|---|---|---|
| P03 sám | 17 | schéma, granty, primitiva, utility |
| P03 společně s jiným plánem nebo rozhodnutím | 3 | `WorkspaceContext`, reexport `schema`, `sender_bypass` |
| jen doménový plán | 7 | P10 dva, P13 dva, P09 dva (jeden s P01), P11 jeden |
| čisté rozhodnutí bez kódu | 4 | trigger, `campaign_render_warnings`, `circuit_breaker_open`, senderský `INSERT` |

Práce na straně P03 se dělí na dvě části. **Migrace `0009`** obsahuje devět nových sloupců
(`api_keys` dva, `contacts.search_key`, `imports` dva, `campaigns.audience_breakdown`,
`sender_domains` tři), jednu novou tabulku (`rate_limits`), dvě změny typu (`bytea` na `text`),
změnu `rank` na generovaný sloupec, uvolnění `recipient` s novým `CHECK`,
zrušení `DEFAULT` u `campaign_links.id` a jednu politiku RLS.

Změny typu a nullability patří do téže migrace právě teď, protože tabulky jsou zatím prázdné.
Po vydání by to byly přepisy dat, tedy přesně ta operace, kterou P03 označuje
za nejrizikovější u self-hosted instalace.

**Druhá část je kód, ne DDL**: transakční obálky nad Drizzle, sjednocení jmen primitiv,
`work_mem` ve `withReadOnly`, utilita pro indexy nad `attributes` a reexport schématu.
Ta je rozsahem větší než migrace a je na kritické cestě, protože na ní stojí P04 a přes něj
všechny doménové plány.

**Čtyři rozhodnutí musí padnout dřív**, než se migrace napíše. Tři z nich
(trigger, `campaign_render_warnings`, `circuit_breaker_open`) mění obsah migrace,
čtvrté mění granty.
