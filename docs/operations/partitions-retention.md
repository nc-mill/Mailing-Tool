# Oddíly a retence odeslané pošty

**K čemu to je:** jak se v instalaci uklízí odeslaná pošta a události, co je
potřeba zapsat do plánovače a co se stane, když to nikdo neudělá.

Revize: 2026-08-06. Příkaz i přepínače ověřené proti
`apps/cli/src/commands/partitions.ts`, jména front proti
`packages/core/src/queues/registry.ts`, výchozí lhůty proti
`packages/core/src/config/schema-domains.ts`.

Odeslaná pošta se v databázi nedrží navždy. O úklid se stará jediný příkaz,
`mlain partitions`, a **pouští se z plánovače hostitele**, ne z fronty úloh.
Dokud ho nikam nezapíšete, retence neběží.

```sh
docker compose exec app mlain partitions --dry-run       # ukáže, co by se stalo
docker compose exec app mlain partitions                 # provede to
docker compose exec app mlain partitions --months 6      # zakládat půl roku dopředu
```

`--months` bere celé číslo 1 až 24, výchozí je 4. Mimo ten rozsah příkaz skončí
kódem 64 a nic neudělá. `compose.yml` leží v `docker/`, takže příkazy pouštějte
z adresáře, kde ten soubor máte, nebo přidejte `-f docker/compose.yml`.

## 1. Co příkaz dělá

Dvě věci v tomhle pořadí, obojí v jednom běhu:

1. **Založí oddíly dopředu** pro aktuální a další tři měsíce (`--months` mění
   počet, výchozí 4). Bez toho instalace po čtyřech měsících přestane přijímat
   zápisy: výchozí oddíl se schválně nezakládá a zápis mimo existující okno
   tvrdě selže. Oddíly zakládá **i migrační runner**, taky na čtyři měsíce
   dopředu (`packages/db/src/migrate.ts`), takže každý upgrade okno posune.
   Spoléhat se na to ale nejde: instalace, která rok neupgraduje, upgradem
   zachráněná není.
2. **Zahodí oddíly, které přesáhly retenční lhůtu.**

| tabulka | co v ní je | proměnná | výchozí lhůta |
| --- | --- | --- | --- |
| `messages` | outbox včetně `render_data`, tedy personalizačních údajů příjemce | `MESSAGE_RETENTION_DAYS` | 90 dní |
| `message_events` | odrazy od poskytovatele (doručeno, odmítnuto, stížnost) | `MESSAGE_EVENT_RETENTION_DAYS` | 365 dní |
| `web_events` | webové události z měřicího SDK | `TRACKING_RETENTION_MONTHS` | 37 měsíců |

Ostatní partitionované tabulky příkaz **nechává být**, a to schválně:

- `audit_log` má vlastní úklid po řádcích (`platform.cleanup_audit_log`, cron
  `35 2 * * *`) podle `AUDIT_RETENTION_MONTHS`, výchozí 24 měsíců. Ten běží
  ve frontě pod aplikační rolí a funguje.
- `inbound_deliveries` spadá pod projektovou retenci (`retention.run`), protože
  lhůtu si nastavuje každý projekt zvlášť, kdežto oddíl je společný všem.
- `webhook_events`, `webhook_deliveries`, `provider_event_receipts`
  a `message_engagement` žádnou retenční proměnnou nemají. Mazat je podle čísla,
  které nikde není napsané, by znamenalo ztrátu dat bez opory v nastavení.

## 2. Lhůta má měsíční granularitu, ne denní

Maže se po celých oddílech, a oddíl je jeden kalendářní měsíc. Oddíl smí zmizet
teprve tehdy, když je **celý** starší než lhůta, tedy když je jeho horní hranice
před hranicí retence.

`MESSAGE_RETENTION_DAYS=90` proto reálně drží **90 až 120 dní**. Srpnový oddíl
smí zmizet nejdřív ve chvíli, kdy je i 31. srpen starší než 90 dní. Nikdy se
nemaže dřív, než lhůta uplyne; případně později.

Kdo potřebuje přesně 90 dní na den, tohle mu nestačí a musí se změnit
granularita oddílů. Zkracovat lhůtu, aby průměr vyšel, je špatně: znamenalo by
to mazat část dat před uplynutím lhůty.

## 3. Jak často to pouštět

**Jednou denně.** Doporučený čas je krátce po druhé hodině ráno, tedy mimo
provoz a před ranním špičkou.

> **Oprava proti starší verzi tohohle dokumentu.** Stálo tu, že se má pouštět
> „po `platform.maintain_partitions`". Taková fronta **v produktu neexistuje**,
> byla z registru odstraněná (`packages/core/src/queues/registry.ts`, řádek s
> poznámkou „TADY UŽ NENÍ a nezakládejte ji znovu"). Nic tedy oddíly ve dvě
> ráno nezakládá a čas 02:20 není synchronizace s ničím, je to jen rozumná
> hodina. **Zakládání i mazání oddílů dělá výhradně tenhle příkaz.**

Cron na hostiteli:

```cron
20 2 * * * cd /opt/mlain && docker compose exec -T app mlain partitions >> /var/log/mlain-partitions.log 2>&1
```

Nebo systemd timer, když už migrace pouštíte tak:

```ini
# /etc/systemd/system/mlain-partitions.service
[Service]
Type=oneshot
WorkingDirectory=/opt/mlain
ExecStart=/usr/bin/docker compose exec -T app mlain partitions

# /etc/systemd/system/mlain-partitions.timer
[Timer]
OnCalendar=*-*-* 02:20:00
Persistent=true
```

`Persistent=true` je tam schválně: po výpadku stroje se běh dožene, místo aby se
tiše přeskočil.

## 4. Co se stane, když úklid týden neběží

**Nic nespadne a nic se nerozbije.** Není to součást odesílací cesty: kampaně
se posílají, události se přijímají, aplikace o tom neví.

Co se stane, je tohle:

- **Data zůstanou ležet déle, než mají.** U `messages` to znamená, že
  `render_data` s údaji příjemce přežije svou lhůtu. To je ten hlavní důvod,
  proč úklid existuje; velikost databáze je vedlejší.
- **Nic vás na to neupozorní.** Příkaz si nikam nezapisuje, že běžel, takže
  „běží nám retence?" se dnes dá zodpovědět jedině tím, že si vypíšete oddíly
  (`\dt messages_*`) a podíváte se, jestli tam nejsou starší, než by měly být,
  nebo že pustíte `mlain partitions --dry-run` a uvidíte dlouhý seznam
  „ZAHODILO BY SE".

Dohnat zameškané běhy není potřeba: úklid je idempotentní a jeden běh po týdnu
zahodí všechno, co se mezitím nasbíralo. Riziko roste se **zakládáním dopředu**,
ne s mazáním: kdyby příkaz neběžel čtyři měsíce a mezitím se nespustila ani
migrace, došly by budoucí oddíly a **zápisy by začaly selhávat**. Proto ten
příkaz dělá obojí a proto nemá smysl pouštět jen půlku.

## 5. Zámky a co dělá odesílání během úklidu

Oddíl se odpojuje příkazem `ALTER TABLE ... DETACH PARTITION CONCURRENTLY`.
Varianta `CONCURRENTLY` je povinná: prosté `DETACH` bere zámek ACCESS EXCLUSIVE
na **celou** partitionovanou tabulku, takže by na dobu odpojení zastavilo claim
zpráv i příjem událostí.

S `CONCURRENTLY` se odesílání nezastaví. Naměřeno na běžící instalaci:
celý příkaz včetně připojení, plánu, dvou odpojení a dvou `DROP TABLE`
trval **0,51 s**. Odpojení je katalogová operace, takže nezávisí na tom, kolik
řádků oddíl nese; `DROP TABLE` už je nad odpojenou tabulkou, kterou nikdo nečte.

Cena za `CONCURRENTLY` je, že příkaz **nesmí běžet uvnitř transakce**. Proto si
příkaz otevírá vlastní spojení mimo transakci. Když se běh přeruší mezi
odpojením a zahozením, zůstane oddíl ve stavu „detach pending"; další běh to
sám dokončí (`FINALIZE`) a osiřelou tabulku zahodí.

## 6. Proč to není úloha ve frontě

Odpojení oddílu je DDL. Worker běží pod rolí `mlain_app`, která schéma
nevlastní, takže by úloha skončila na `permission denied`. Dát té roli právo
měnit schéma kvůli jedné úloze znamená, že tabulku může zahodit kterákoli chyba
v kterékoli obsluze v aplikaci.

Z registru proto **zmizely tři fronty**, ne dvě: `retention.drop_message_partitions`,
`tracking.enforce_retention` a `platform.maintain_partitions`. Všechny tři v něm
byly od začátku, měly nastavený cron a vypadaly jako běžící údržba, přitom
obsluhu neměly a mít nemohly. Registr na jejich místě nese poznámku, ať je tam
nikdo nezakládá znovu.

Příkaz se připojuje přes `DATABASE_URL_MIGRATOR`, stejně jako `mlain migrate`.
Bez té proměnné odmítne běžet a řekne proč. Není to formalita: `messages` má
row level security, takže pod aplikační rolí bez kontextu projektu by kontrola
„leží v tomhle oddílu nerozeslaná zpráva?" viděla **nula řádků**, usoudila, že
je oddíl zbytný, a zahodila by ho i s rozdělanou kampaní.

## 7. Co oddíl ubrání před smazáním

U `messages` se nikdy nemaže naslepo podle stáří. Oddíl zůstane, když platí
aspoň jedno:

- **leží v něm zpráva ve stavu `pending` nebo `claimed`**, tedy nerozeslaná
  nebo právě zabraná senderem;
- **některá kampaň v něm má publikum a ještě nedoběhla** (stav jiný než `sent`,
  `partially_sent`, `cancelled`, `failed` nebo `schedule_missed`).

Důvod je invariant I1: všechny zprávy jedné kampaně mají `created_at` rovné
`campaigns.audience_built_at`, takže **celá kampaň leží v jednom oddílu**
vybraném při materializaci publika. Kampaň materializovaná 31. srpna má všechny
zprávy v srpnovém oddílu, i když se dorozesílá v listopadu. Bez téhle pojistky
by dlouho pozastavená kampaň přišla o outbox pod rukama a po obnovení by se
tvářila jako doběhlá, přestože by neodeslala nic.

Hranice oddílu se čte z katalogu (`pg_get_expr(relpartbound)`), ne z jeho jména.
Jméno je jen řetězec, který někdo zvolil, a nic nezaručuje, že sedí na skutečné
hranice. Když se hranice přečíst nedá, oddíl **zůstává**.

Ve výpisu je u každého ponechaného oddílu napsané proč:

```
messages: lhůta 90 dní (MESSAGE_RETENTION_DAYS), hranice 2026-05-07T09:01:32.547Z
  ZAHODILO BY SE  messages_y2025m01  FOR VALUES FROM ('2025-01-01 00:00:00+00') TO ('2025-02-01 00:00:00+00')
  ponecháno     messages_y2025m02  (leží v něm nerozeslané zprávy ve stavu pending)
```

## 8. Zálohy

Úklid oddílů zálohy ani obnovu neovlivní. `pg_dump` zálohuje tabulku podle
aktuálního stavu, takže odpojený oddíl v záloze prostě není. Kontrola počtu
řádků při `mlain backup verify` se dívá na `BACKUP_ROW_COUNT_TABLES`, a v tom
seznamu žádná z uklízených tabulek není (`messages`, `message_events` ani
`web_events`), takže se úklidem nemůže rozejít.

Ze staré zálohy se ovšem obnoví i data, která už retence smazala. Po obnově
proto pusťte `mlain partitions` a uklidí se znovu.

## 9. Transakční pošta

Transakční zprávy mají navíc **vlastní** úklid: `transactional.purge_render_data`
vynuluje `render_data` odeslané transakční zprávy po 24 hodinách
(`TRANSACTIONAL_RENDER_DATA_TTL_HOURS`), protože v něm leží odkaz s jednorázovým
tokenem na reset hesla. Fronta tiká **každou hodinu** (cron `15 * * * *`), takže
skutečné stáří vynulovaného záznamu je 24 až 25 hodin. Běží dál ve frontě, po
řádcích, pod aplikační rolí, a s tímhle příkazem si nepřekáží: pracuje uvnitř
oddílu, kdežto `mlain partitions` pracuje s oddílem jako celkem. Zpráva, které
se vynulovalo `render_data`, zmizí i tak později celá se svým oddílem podle
`MESSAGE_RETENTION_DAYS`.
