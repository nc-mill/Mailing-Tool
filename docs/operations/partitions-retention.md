# Oddíly a retence odeslané pošty

**K čemu to je:** jak se v instalaci uklízí odeslaná pošta a události, kdo to
pouští a jak se pozná, že to opravdu běží.

Revize: 2026-08-07. Příkaz i přepínače ověřené proti
`apps/cli/src/commands/partitions.ts`, fronta a její cron proti
`packages/core/src/queues/registry.ts`, obsluha proti
`packages/core/src/ops/jobs/partition-jobs.ts`, výchozí lhůty proti
`packages/core/src/config/schema-domains.ts`.

Odeslaná pošta se v databázi nedrží navždy. **Úklid dělá instalace sama:** noční
úloha workeru `platform.maintain_partitions` (cron `5 2 * * *`). Nemusíte nic
nastavovat a nemusíte na hostiteli nic zakládat.

> **Změna proti verzi z 6. 8. 2026.** Do té doby uměl úklid jedině
> `mlain partitions` z plánovače hostitele. Znamenalo to, že dodávaná instalace
> retenci NESPOUŠTĚLA VŮBEC: `docker/compose.yml` ani `compose.scale.yml` žádný
> plánovač nemají a na PaaS k hostiteli přístup není. Kdo ten cron nezaložil
> ručně, držel `messages.render_data` s údaji příjemců navěky. Postup s cronem
> níž zůstává popsaný pro instalace, které worker nepouštějí, ale **není to
> nutný krok**.

Příkaz zůstává pro ruční běh a pro pohled dopředu:

```sh
docker compose exec app mlain partitions --dry-run       # ukáže, co by se stalo
docker compose exec app mlain partitions                 # provede to
docker compose exec app mlain partitions --months 6      # zakládat půl roku dopředu
```

`--months` bere celé číslo 1 až 24, výchozí je 4. Mimo ten rozsah příkaz skončí
kódem 64 a nic neudělá. `compose.yml` leží v `docker/`, takže příkazy pouštějte
z adresáře, kde ten soubor máte, nebo přidejte `-f docker/compose.yml`.

## 1. Co se při úklidu děje

Dvě věci v tomhle pořadí, obojí v jednom běhu. Platí stejně pro noční úlohu
i pro ruční příkaz: **je to týž kód** (`runPartitionMaintenance`), jen puštěný
z jiného místa.

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

## 3. Kdo to pouští

**Worker, každou noc v 02:05 UTC** (fronta `platform.maintain_partitions`, cron
`5 2 * * *`). Běží to všude, kde běží worker, tedy v `MODE=all`, v `MODE=worker`
i na PaaS. Není potřeba nic nastavovat.

Čas není náhodný: je o deset minut dřív než ostatní noční úklidy a hodinu před
zálohou ve 3:00. `DETACH PARTITION CONCURRENTLY` sice bere jen krátký zámek, ale
záloha běžící přes odpojování by měla v dumpu tabulku ve dvou různých stavech.

**Jediná podmínka je `DATABASE_URL_MIGRATOR`.** Odpojení oddílu je DDL a
aplikační role `mlain_app` schéma nevlastní, takže si obsluha otevírá vlastní
spojení pod migrátorem, přesně jako noční záloha. Bez té proměnné úloha spadne
a `mlain doctor` to do dvou dnů ohlásí. V dodávaném compose je proměnná
vyplněná; u externího Postgresu ji doplňte do `.env`.

Zahozený tik je neškodný. Fronta má politiku `exclusive`, takže když předchozí
běh ještě neskončil, další se zahodí; úklid se řídí stářím dat, takže zítřejší
běh zahodí i to, co dnešní nestihl.

### 3.1 Instalace, která worker nepouští

Jediný případ, kdy si plánovač musíte založit sami. Postup zůstává:

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

**Když worker běží, tenhle cron nepotřebujete a je lepší ho zrušit.** Nerozbije
nic, oba běhy jsou idempotentní a čas 02:20 se s úlohou v 02:05 nepotká, ale
znamená to dvě místa, kde se dá úklid vypnout, a tedy dvě místa, kde se to dá
přehlédnout. Kdo si ho nechá, pozná v auditu podle popisku aktéra, která z cest
běžela (viz kapitola 4.1).

## 4. Co se stane, když úklid týden neběží

**Nic nespadne a nic se nerozbije.** Není to součást odesílací cesty: kampaně
se posílají, události se přijímají, aplikace o tom neví.

Co se stane, je tohle:

- **Data zůstanou ležet déle, než mají.** U `messages` to znamená, že
  `render_data` s údaji příjemce přežije svou lhůtu. To je ten hlavní důvod,
  proč úklid existuje; velikost databáze je vedlejší.
- **Upozorní vás na to `mlain doctor`,** a to od 7. 8. 2026. Do té doby si
  příkaz nikam nezapisoval, že běžel, takže „běží nám retence?" se dalo
  zodpovědět jedině výpisem oddílů (`\dt messages_*`) nebo během
  `mlain partitions --dry-run`, kde by se objevil dlouhý seznam „ZAHODILO BY SE".
  Obojí funguje dál, ale ptát se na to musíte vy. Jak to funguje dnes, je
  v kapitole 4.1.
- **Je to vidět v logu workeru.** Selhaná úloha `platform.maintain_partitions`
  nese důvod, typicky chybějící `DATABASE_URL_MIGRATOR` nebo chybějící právo.

Dohnat zameškané běhy není potřeba: úklid je idempotentní a jeden běh po týdnu
zahodí všechno, co se mezitím nasbíralo. Riziko roste se **zakládáním dopředu**,
ne s mazáním: kdyby příkaz neběžel čtyři měsíce a mezitím se nespustila ani
migrace, došly by budoucí oddíly a **zápisy by začaly selhávat**. Proto ten
příkaz dělá obojí a proto nemá smysl pouštět jen půlku.

## 4.1 Jak se pozná, že úklid opravdu běží

Každý ostrý běh zapíše na konci do auditu záznam `partition.maintained`. Je
globální (`workspace_id` je NULL), aktér je `system` a v metadatech nese počty,
ne jména oddílů:

```json
{ "created": 1, "dropped": 2, "tables": { "messages": 2, "message_events": 0, "web_events": 0 } }
```

**Zapisuje se i běh, který nic nezahodil.** Nula zahozených oddílů je běžný
a správný výsledek, protože lhůta zatím nikomu neuplynula. Kdyby se zapisovaly
jen běhy, které něco smazaly, vypadala by správně fungující instalace stejně
jako instalace, kde úklid vůbec neběží.

**Popisek aktéra říká, která cesta běžela:** `platform.maintain_partitions` je
noční úloha workeru, `mlain partitions` je ruční běh nebo váš vlastní cron.
Doktoru je to jedno, ptá se jen na akci, ale vám ne: bez toho rozdílu se nedá
zjistit, která z těch dvou přestala běžet.

**Běh nanečisto (`--dry-run`) se nezapisuje.** Nic neuklidil, takže by jeho
záznam v doktoru vypadal jako doklad o úklidu, tedy by uklidnil přesně ve chvíli,
kdy data leží přes lhůtu.

Na ten záznam se dívá `mlain doctor` a hlásí dvě věci:

| Nález | Kdy | Co s tím |
| --- | --- | --- |
| `no_partition_maintenance_yet` | v auditu není jediný takový záznam | neběží worker, nebo mu chybí `DATABASE_URL_MIGRATOR`; viz kapitola 3 |
| `partition_maintenance_stale` | poslední záznam je starší než **dva dny** | běhy se pouští, ale poslední selhaly; podívejte se do logu workeru |

Obojí je **varování**, ne kritický nález, takže `mlain doctor` kvůli němu skončí
nulou; nenulový kód dostanete s `--strict`. Hranice jsou dva dny schválně: úklid
má běžet denně a jeden vynechaný den je běžná věc (restart stroje, delší upgrade,
nasazení přes noc). Varování, které chodí planě, se přestane číst.

Když se úklid povedl, ale zápis do auditu ne, chová se to podle toho, kdo běh
pustil, a je to úmysl. **Příkaz** to řekne na chybový výstup a **skončí nulou**:
úklid v tu chvíli už proběhl a nenulový kód by o něm lhal, čtenářem je plánovač
hostitele a ten chybový výstup dostane. **Noční úloha naopak spadne**, protože
ve workeru je tabulka úloh jediné trvalé místo, kde takový problém uvidíte;
bez toho by doktor za dva dny hlásil, že údržba neběží, a nikdo by nevěděl proč.

## 5. Zámky a co dělá odesílání během úklidu

Oddíl se odpojuje příkazem `ALTER TABLE ... DETACH PARTITION CONCURRENTLY`.
Varianta `CONCURRENTLY` je povinná: prosté `DETACH` bere zámek ACCESS EXCLUSIVE
na **celou** partitionovanou tabulku, takže by na dobu odpojení zastavilo claim
zpráv i příjem událostí.

S `CONCURRENTLY` se odesílání nezastaví. Naměřeno na běžící instalaci:
celý příkaz včetně připojení, plánu, dvou odpojení a dvou `DROP TABLE`
trval **0,51 s**. Odpojení je katalogová operace, takže nezávisí na tom, kolik
řádků oddíl nese; `DROP TABLE` už je nad odpojenou tabulkou, kterou nikdo nečte.

Cena za `CONCURRENTLY` je, že se **nesmí běžet uvnitř transakce**. Proto si
úklid otevírá vlastní spojení mimo transakci. Když se běh přeruší mezi
odpojením a zahozením, zůstane oddíl ve stavu „detach pending"; další běh to
sám dokončí (`FINALIZE`) a osiřelou tabulku zahodí.

## 6. Proč to má JEDNU frontu, ne tři, a proč neběží pod aplikační rolí

Odpojení oddílu je DDL. Aplikační role `mlain_app`, pod kterou jede worker i web,
schéma nevlastní, takže by úloha skončila na `permission denied`. Dát TÉ ROLI
právo měnit schéma nepřipadá v úvahu: pak by tabulku mohla zahodit kterákoli
chyba v kterékoli obsluze v aplikaci.

Řešení není v právech role, ale ve spojení. Obsluha si otevře vlastní spojení
pod `DATABASE_URL_MIGRATOR`, stejně jako `mlain migrate` a stejně jako noční
záloha (ta pod aplikační rolí narazí na row level security). Aplikační role tedy
žádné nové právo nedostává.

Není to formalita ani u čtení: `messages` má row level security, takže pod
aplikační rolí bez kontextu projektu by kontrola „leží v tomhle oddílu
nerozeslaná zpráva?" viděla **nula řádků**, usoudila, že je oddíl zbytný,
a zahodila by ho i s rozdělanou kampaní.

**Fronta je na tuhle práci jedna, a to schválně.** V registru byly původně tři
(`platform.maintain_partitions`, `retention.drop_message_partitions`,
`tracking.enforce_retention`), všechny s cronem, všechny bez obsluhy. Dvě z nich
zůstávají zrušené natrvalo a registr na jejich místě nese poznámku, ať je tam
nikdo nezakládá znovu: dva úklidy téhož ze dvou míst by znamenaly dvě různá
pravidla a dvě místa, kde se dá zahodit tabulka. Zakládání dopředu a mazání za
lhůtou zůstávají v JEDNÉ úloze, protože kdo pustí jen půlku, buď hromadí data,
nebo si za čtyři měsíce zastaví zápisy.

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
