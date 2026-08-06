# Revize P03: čerstvý pohled

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Revize plánu P03, úhel čerstvý pohled z prověrky plánů
> (31. 7. až 1. 8. 2026), tedy kontrola **textu plánu před stavbou**, ne kontrola kódu.
> **Verdikt typu „plán není proveditelný" se týkal tehdejšího plánu, ne dnešního produktu.** Ten stojí a funguje.
> Opravy se prováděly podle `docs/superpowers/plans/POSTUP-OPRAV.md`; **stav jednotlivých nálezů neověřen**.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

Datum: 2026-08-01. Model: opus. Plán: `2026-07-31-p03-databaze-schema-rls.md`, hash `05f14f0`.
Verdikt: **NALEZENY PROBLÉMY**. 6 kritických, 12 důležitých.

**Tři nálezy jsou ověřené měřením na skutečném PostgreSQL**, ne odvozené ze čtení. Recenzent
si postavil dočasný cluster, zreplikoval návrh plánu a naměřil chování. To je přesně ten
postup, který v tomhle projektu opakovaně odhalil věci, které kontrola čtením minula.

## Kritické

**K1. RLS ani append-only neplatí při přímém dotazu na partition. OVĚŘENO MĚŘENÍM.**
`CREATE TABLE ... PARTITION OF` nedědí `relrowsecurity` ani politiky, ale `ALTER DEFAULT PRIVILEGES`
každé nové partition dá `mlain_app` plná práva. Naměřeno:

- pod kontextem projektu B vrátí `SELECT count(*) FROM web_events` jeden řádek,
  ale `SELECT count(*) FROM web_events_y2026m08` **dva, tedy i cizí projekt**
- `DELETE FROM audit_log` skončí `permission denied`,
  ale `DELETE FROM audit_log_y2026m08` **smaže všechno včetně cizích a globálních záznamů**

Týká se devíti tabulek krát 37 měsíců, tedy stovek objektů, mezi nimi `messages`,
`message_events`, `web_events` a `audit_log`. Testy to nezachytí konstrukčně, protože
filtrují `relispartition = false` a ptají se výhradně přes rodiče.

**Tentýž nález nezávisle našla i bezpečnostní recenze (její K2).** Dva recenzenti, dvě různé
cesty, stejný závěr.

**K2. Hranice partitions závisí na časové zóně session. OVĚŘENO MĚŘENÍM.**
`FOR VALUES FROM ('2026-08-01')` se přetypuje podle `TimeZone` spojení. Partition založená
pod `Europe/Prague` začíná v `+02`, další měsíc založený pod UTC v `+00`, a mezi nimi zůstane
**dvouhodinová díra**. Zápis do ní končí chybou, protože výchozí partition se schválně nezakládá.
Ztracené řádky jsou přitom právě ty, které se ztratit nesmí: odrazy a stížnosti od providera.
Opačné pořadí dá překryv a partition nejde založit vůbec.
Oprava: psát hranice jako `TIMESTAMPTZ '... 00:00:00+00'`.

**K3. Tři unikátní indexy nezaručují nic, přestože se tak jmenují.**
`uq_message_events__once_per_message`, `uq_provider_event_receipts__dedup`
a `uq_webhook_deliveries__event_endpoint` mají jako poslední složku sloupec s `DEFAULT now()`.
Dva zápisy téže události v různý čas projdou oba. Následek je dvakrát započtený odraz,
stížnost i doručení, tedy rozjeté statistiky kampaně.
Plán přitom **tentýž problém jinde řeší správně** (nepartitionovaná dedup tabulka pro příchozí
webhooky). Chybí to tam, kde jsou následky horší.

**K4. Invariant proti dvojímu odeslání nemá v databázi žádné vynucení.**
`messages.created_at` má `DEFAULT now()`, takže jakmile kterákoli cesta vloží zprávu bez
explicitního `created_at`, unikátní index přestane chránit a **kontakt dostane e-mail dvakrát**.
Nic nespadne. Materializaci publika píše P13 a grant na ten sloupec má.

**K5. Chybí registr pokolení klíče, takže slibovaná kontrola `mlain doctor` nemůže fungovat.**
Ze `SELECT DISTINCT fingerprint_key_id` se pozná, která čísla se používají, ne jestli klíč pod
tím číslem ještě existuje a jestli ho někdo neprohodil. Prohození `SECRET_KEY`
a `SECRET_KEY_PREVIOUS` po obnově je u samohostitele reálné a projeví se nejtišší možnou
poruchou: vymazaný člověk dostane mail a nikde se to nezaloguje.
Oprava: mapa `key_id → otisk klíče` v nastavení, nebo malá tabulka pokolení.

**K6. Po obnově ze zálohy nebude mít aplikace žádná práva. OVĚŘENO MĚŘENÍM.**
Specifikace předepisuje `pg_dump --no-privileges`. Ověřeno, co dump obsahuje: **politiky RLS ano,
granty vůbec ne** (nula výskytů). Ledger migrací se obnoví taky, takže migrace s granty jsou
označené jako aplikované a už je nikdo nevrátí. Zákazník po havárii obnoví data, aplikace
se rozeběhne a všechno skončí na `permission denied`, v okamžiku, kdy si to nejmíň může dovolit.
Oprava: granty vystavit jako **idempotentní funkci**, kterou umí zavolat obnova i `doctor`,
ne jen jako jednorázovou migraci.

## Důležité (výběr)

| # | Nález |
|---|---|
| D1 | Chybí třífázový vzor indexu na partitionované tabulce, přestože ho specifikace označuje za jediný povolený. První upgradová migrace nad velkou tabulkou vezme zámek, narazí na timeout a instalace jde do údržby |
| D3 | Nic nebrání tomu, aby se aplikace připojila jako superuživatel a tím izolaci vypnula. Samohostitel s managed Postgresem a jednou rolí dostane funkční aplikaci **bez izolace projektů** a nedozví se to |
| D5 | `DETACH PARTITION` bez `CONCURRENTLY` zastaví u velké instalace claim i příjem událostí |
| D6 | `CHECK` na zpoždění promění posunuté hodiny v prohlížeči v tvrdou chybu, nebo tichou ztrátu událostí. Plán neříká, která varianta platí |
| D8 | Devátá migrace je zbytečná, nic není vydané. Test se kvůli ní nastaví na 75 politik jen proto, aby ho pozdější úkol přepsal na 76 |
| D9 | Runner nekontroluje hash už aplikovaných migrací, takže změna bílého znaku ve vydané migraci ji nechá přehrát nad hotovým schématem |
| D11 | Čtrnáct souborů `test:db`, každý startuje vlastní kontejner a přehrává devět migrací. Limit 15 minut je vratký a doménové plány přidají další |

## Co recenze potvrdila jako v pořádku

- Generované sloupce nad `citext`, `CHECK` s `pg_column_size`, `btree_gin` nad `uuid`.
  Ověřeno spuštěním, žádné riziko.
- **73 tabulek není moc.** Jsou ze sedmi specifikací a založit je dopředu je u self-hosted
  produktu obhajitelné.
- 76 politik je naopak moc, ale jinak, než se čeká: 63 z nich je jedna politika napsaná
  63krát, navíc ve dvou zdrojích pravdy. A jak ukazuje K1, ta vrstva stejně neplatí tam,
  kde nese nejvíc dat.

## Pozorování, které stojí za zvážení

Funkce kopírující granty na nové partitions existuje kvůli jedinému akceptačnímu kritériu
(„nová partition je pro sender čitelná"), ale **sender žádnou partition jménem nečte**.
Přitom je to polovina díry K1. Kdyby se přímý přístup na partitions zakázal úplně,
zmizí to kritérium, nález K1 i půlka modulu pro partitions.
