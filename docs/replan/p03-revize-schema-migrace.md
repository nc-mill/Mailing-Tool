# Revize P03: schéma a migrace

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Revize plánu P03, úhel schéma a migrace z prověrky plánů
> (31. 7. až 1. 8. 2026), tedy kontrola **textu plánu před stavbou**, ne kontrola kódu.
> **Verdikt typu „plán není proveditelný" se týkal tehdejšího plánu, ne dnešního produktu.** Ten stojí a funguje.
> Opravy se prováděly podle `docs/superpowers/plans/POSTUP-OPRAV.md`; **stav jednotlivých nálezů neověřen**.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

Datum: 2026-08-01. Model: opus. Plán: `2026-07-31-p03-databaze-schema-rls.md`, hash `05f14f0`.
Verdikt: **NALEZENY PROBLÉMY**. 3 kritické, 5 důležitých, 8 poznámek.

Každý kritický i dva důležité nálezy **reprodukované spuštěním SQL proti reálnému PostgreSQL**.

## Kritické

**K1. Sender fyzicky nemůže zapsat do `campaign_render_warnings`.**
Grant je, ale chybí politika `sender_bypass` i `GRANT SELECT`. Ověřeno spuštěním, sender dostane
postupně dvě chyby: nejdřív `permission denied` (protože `INSERT ... ON CONFLICT DO UPDATE` čte
existující řádek, takže potřebuje i `SELECT`), a po jejím opravení `new row violates row-level
security policy`. Agregovaná varování z renderu se tedy nikdy nezapíšou a report je vždy prázdný.

**Totéž našla nezávisle i bezpečnostní recenze (K3).**

**K2. Append-only na partitions neplatí, nové oddíly dostávají `UPDATE` a `DELETE` zpátky.**
`ALTER DEFAULT PRIVILEGES` dává novým tabulkám plná práva, migrace je odebírá jen z rodičů,
ale partitions vznikají až po migracích. Naměřeno:

```
parent ACL     | {petr=arwdDxt/petr,p03_app=ar/petr}
partition ACL  | {petr=arwdDxt/petr,p03_app=arwd/petr}

DELETE FROM audit_log;            -> ERROR: permission denied
DELETE FROM audit_log_y2026m08;   -> DELETE 1
```

Kdokoli pod aplikační rolí může adresovat partition přímo a **smazat auditní záznam**.
Totéž ruší sloupcové granty, takže omezení „jen atribuční sloupce" je na partitions neúčinné.

**Tenhle nález našli tři nezávislí recenzenti třemi různými cestami** (bezpečnost K2,
čerstvý pohled K1, schéma K2). Je to nejjistější nález celé revize.

**K3. Čítač neúspěšných migrací nikdy nic nezapíše.**
`jsonb_set(settings, ARRAY['migration_failures', $1], ...)` vyžaduje, aby dřívější kroky cesty
existovaly. Nastavení začíná jako `'{}'`, takže:

```
jsonb_set('{}', ARRAY['migration_failures','0003_x'], to_jsonb(1), true)  ->  {}
```

Čítač zůstane navždy na nule a pravidlo „po třech neúspěších režim údržby" je neproveditelné.
Volající to navíc obaluje `.catch(() => undefined)`, takže by neprošla ani chyba. Kvůli tomuhle
čítači přitom plán zavádí celý sloupec navíc proti specifikaci.

## Důležité

**D1. `webhook_deliveries` nenese druhou složku klíče.**
Plán si sám stanoví, že každý odkaz na partitionovanou tabulku nese obě složky klíče.
`message_events` a další to dodržují, ale `webhook_deliveries.event_id` míří na
`webhook_events(id, created_at)` a sloupec s časem události v tabulce **není**. Načtení payloadu
při opakovaném pokusu tedy jde přes všechny partitions. Test, který to má hlídat, kontroluje
jmenovitě jen `message_events`.
Stejná třída, mírnější: `inbound_dedup.delivery_id`.
Oprava: doplnit sloupce a **zobecnit test tak, aby se řídil registrem a kontroloval každý odkaz**.

**D2. Test prořezávání partitions počítá výskyty řetězce, ne oddíly, takže spadne i při dokonalé
funkci.** Název partition se v plánu dotazu objeví vícekrát (uzel skenu i název indexu).
Naměřeno na reálném plánu: pruning odstranil 7 z 9 oddílů, tedy bezvadně, a test přesto hlásí
4 výskyty proti hranici 2. Na přelomu měsíce spadne vždy. Plán přitom implementátorovi zakazuje
hranici snížit a nařizuje z toho udělat evidované riziko, takže z falešného poplachu vznikne
zápis o neexistujícím problému.
Oprava: počítat unikátní názvy.

**D3. Partitions se zakládají jen dopředu a nikdo neurčil roli, která je zakládá.**
Část 5 žádá funkci, které se předá rozsah měsíců a ona chybějící oddíly doplní, kvůli dávkovému
importu historie. Plán ten požadavek necituje. Navíc žádná role nemá práva partition založit,
natož odpojit a zahodit.

**D4. Chybí index na `workspace_id` tam, kde se podle něj hledá i kaskádově maže.**
Dva případy, kde hlavní dotaz obrazovky nemá index vůbec. Širší případ: sedmnáct tabulek
s kaskádou bez použitelného indexu, takže tvrdé smazání projektu je sekvenční průchod.

**D5. `messages` dostává dvě `CHECK` omezení, která ve zmrazeném kontraktu nejsou.**
Kontrakt povoluje přidávat sloupce a indexy, omezení ne. Dnes to shodou okolností projde,
ale jakákoli budoucí cesta, která nastaví stav bez časového razítka, skončí chybou uvnitř
senderu, tedy přesně tím tvrdým selháním, kvůli kterému se kontrakt mrazí.

## Co recenze ověřila jako v pořádku

Nosná část plánu drží. Spuštěno proti PostgreSQL a prošlo: částečné unikátní indexy na
partitionovaných tabulkách, odchozí cizí klíč z partitionované tabulky, generované sloupce
nad `citext`, `pg_column_size` v `CHECK`, smíšený GIN index, GiST nad `cidr`, politika jen
s `WITH CHECK`, a hlavně **claim dotaz z kontraktu včetně `FOR UPDATE ... SKIP LOCKED` pod
pouze sloupcovým grantem**.

Kontraktní sloupce `messages` porovnány s kontraktem řádek po řádku: všech 22 sloupců, typy,
`NOT NULL`, `DEFAULT`, složený primární klíč, obě `CHECK` omezení i způsob dělení sedí doslova,
stejně jako čtyři kontraktní indexy.

Pořadí migrací je správné, rozšíření vznikají před prvním použitím. Advisory lock je
session-scoped a čtení aplikovaných migrací je uvnitř zámku, takže slib „tři repliky aplikují
každou migraci právě jednou" mechanismus **skutečně dává**, ne jen popisuje.

Žádný index neodkazuje hodnotu zakázanou `CHECK` omezením (prošlo všech patnáct částečných
indexů s výčtovým predikátem). Žádný grant nemíří na neexistující sloupec.
