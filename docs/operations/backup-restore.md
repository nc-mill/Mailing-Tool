# Zálohy a obnova

**K čemu to je:** provozní runbook pro zálohu, ověření zálohy a obnovu
samohostované instalace.

Revize: 2026-08-06, všechny příkazy níž ověřené proti `apps/cli/src/registry.ts`
a proti `packages/core/src/ops/`. Platí pro instalaci z `docker/compose.yml`.

> **Kde ty příkazy pouštět.** `compose.yml` leží v `docker/`, ne v kořeni
> repozitáře. Buď je pouštějte z adresáře, kde ten soubor máte (na serveru
> typicky `/opt/mlain`), nebo přidejte `-f docker/compose.yml`. Služba se jmenuje
> `app`; služby `worker` a `sender` existují jen v rozděleném režimu, viz
> [upgrade.md](upgrade.md).

## 1. Co v záloze je a co ne

| V záloze je | V záloze NENÍ |
|---|---|
| celá databáze (`pg_dump -Fc`, soubor `database.dump`) | `SECRET_KEY` a `SECRET_KEY_PREVIOUS` |
| obsah `/data/uploads` (soubor `uploads.tar.gz`) | konfigurace, tedy `.env` a proměnné prostředí |
| `manifest.json` s verzí aplikace, verzí schématu, kontrolními součty a otiskem klíče | obsah `/data/backups` samotný |

Záloha je tedy adresář se **třemi soubory**. Bez konfigurace a bez klíče se z ní
plná instalace nepostaví, a to je záměr: klíč vedle šifrovaných dat by z obojího
udělal jeden ukradnutelný celek.

## 2. Klíč v záloze schválně není

> Uložte si zvlášť **celý keyring**, tedy `SECRET_KEY` i všechna předchozí
> pokolení ze `SECRET_KEY_PREVIOUS`. Recovery bundle jen s aktuálním klíčem je
> nefunkční recovery bundle: otisky smazaných adres pod starými pokoleními se
> přestanou shodovat, smazaný člověk se vrátí prvním dalším importem, import
> proběhne úspěšně a nezaloguje se nic.

Tohle je druhá kapitola runbooku, ne poznámka pod čarou, protože je to jediná
ztráta, kterou po obnově nikdo nezpozoruje. Všechny ostatní se ohlásí.

Otisk aktuálního klíče vypíše `mlain doctor`. Manifest zálohy nese otisk klíče,
pod kterým vznikla, a obnova ho porovná (brána 4 níže).

## 3. Ruční záloha

```bash
docker compose exec app mlain backup                # záloha a úklid starých
docker compose exec app mlain backup --skip-prune   # záloha a staré nechat být
docker compose exec app mlain backup list           # co v /data/backups leží
```

Příkaz vypíše cestu k adresáři (`Záloha hotová: /data/backups/…`), počet
kontaktů v záloze a stav keyringu.

Běží pod `DATABASE_URL_MIGRATOR`. Bez té proměnné odmítne začít, a když by role
podléhala row level security, zastaví se taky, s vysvětlením:
`pg_dump` by u chráněných tabulek skončil na
`query would be affected by row-level security policy`. **Nepomáhejte si
přepínačem `--enable-row-security`:** chybu odstraní tím, že vyrobí zálohu, kde
jsou chráněné tabulky prázdné. Prázdná záloha je horší než žádná, protože vypadá
jako hotová práce.

Adresář se jmenuje `mlain-<RRRRMMDD>T<HHMMSS>Z`. Jméno **není kosmetika**:
`mlain backup list` i retence z něj čtou čas vzniku a adresář, který se tomu
tvaru nepodobá, oba přehlédnou.

`--skip-prune` vypne jenom mazání starých záloh na konci běhu, na samotnou
zálohu nemá vliv.

## 4. Plánovaná záloha

| Proměnná | Výchozí | Význam |
|---|---|---|
| `BACKUP_SCHEDULE_CRON` | `0 3 * * *` | kdy se spustí noční záloha |

Ve frontě úloh jsou na to **dvě** položky, ne jedna:

| Fronta | Cron | Co dělá |
|---|---|---|
| `platform.backup` | `0 3 * * *` | noční záloha podle `BACKUP_SCHEDULE_CRON` |
| `platform.backup_verify` | `0 4 * * 0` | v neděli ráno ověří **nejnovější** zálohu |

Plánovaná záloha běží **jen v `MODE=worker` a `MODE=all`**. Ve `MODE=web` se
neplánuje nic a je to správně: jinak by při horizontálním škálování běželo
tolik nočních záloh, kolik je webových instancí.

## 5. Retence

| Proměnná | Výchozí | Význam |
|---|---|---|
| `BACKUP_RETENTION_DAYS` | `14` | po kolika dnech se záloha maže |

**Tři poslední zálohy zůstávají vždycky**, bez ohledu na stáří. Bez téhle
pojistky by instalace, která dva týdny stála, přišla po prvním spuštění o
všechny zálohy naráz.

## 6. Ověření zálohy

```bash
docker compose exec app mlain backup verify /data/backups/<adresář>
```

Ověření **obnoví dump do dočasné databáze** `ml_verify_<náhodné>`, porovná počty
řádků proti manifestu a databázi zase zahodí. Kontrola, že soubor existuje a má
nenulovou velikost, nedokáže rozlišit platný dump od uříznutého: `pg_dump`
přerušený v půlce vyrobí soubor, který vypadá stejně dobře jako celý, a pozná
se to až ve chvíli, kdy je potřeba.

Po ověření nesmí zůstat žádná databáze `ml_verify_%`. Když zůstane, ověření
spadlo uprostřed a je to nález, ne kosmetika.

> **Nález z 6. 8. 2026 je OPRAVENÝ, tenhle odstavec ho drží jen jako historii.**
> Znělo to tak, že se na nedělní ověření nedá spoléhat, protože úloha volala
> `verifyBackup()` bez cesty k migracím a padala na ENOENT. Cesta dnes není
> volitelný vstup od volajícího: skládá ji `resolveMigrationsFolder()`
> a `runMigrations` ji vyžaduje (`packages/core/src/ops/backup-verify.ts`),
> takže obě cesty, ruční příkaz i nedělní úloha, používají tutéž.
>
> **Co ověřené NENÍ:** že se ta cesta správně odvodí v sestaveném produkčním
> obrazu. To se dá vyzkoušet jedině proti němu, ne testem. Do té doby platí:
> **jednou za čas si zálohu ověřte ručně** a podívejte se na nálezy doktoru
> z kapitoly 6.1, protože ty tenhle případ chytí (`backup_verify_failed`,
> respektive `no_backup_verify_yet`).

### 6.1 Jak se pozná, že ověřování běží

Od 7. 8. 2026 se na to nemusíte ptát sami, dívá se na to `mlain doctor`:

| Nález | Kdy | Co s tím |
|---|---|---|
| `no_backup_verify_yet` | instalace zálohuje **přes dva týdny** a v auditu není jediný záznam `backup.verified` | neběží worker, nebo mu chybí `DATABASE_URL_MIGRATOR`; ověřte ručně |
| `backup_verify_stale` | poslední ověření je starší než **dva týdny** | podívejte se do logu workeru, proč `platform.backup_verify` selhala |
| `backup_verify_failed` | poslední ověření má v metadatech `ok: false` | z poslední zálohy se **nepodařilo obnovit**; důvody jsou v metadatech pod `problems` |

Všechno jsou to **varování**, takže `mlain doctor` kvůli nim skončí nulou;
nenulový kód dostanete s `--strict`.

Tři nálezy, ne dva, a je to podstatné: úloha zapisuje auditní záznam **i tehdy,
když ověření neprošlo**. Instalace, které se ověření každou neděli nepovede, má
tedy záznam čerstvý a podle stáří by vypadala v pořádku. Přesně tenhle případ
nastane u nálezu z předchozího odstavce, tedy u chybějící cesty k migracím.

Instalace, která ještě nikdy nezálohovala, tenhle nález **nedostane**: patří
`no_backup_yet` z kontroly úložiště, a dvě věty o jednom problému znamenají, že
se přestanou číst obě. Stejně tak mlčí čerstvá instalace, protože ověření tiká
v neděli a šest dní po nasazení je „ještě se neověřovalo" správný stav.

> **Proč to nehlídá hlídač ticha ve workeru.** `apps/worker/src/cron-watch.ts`
> pozná frontu, do které se přestalo tikat, jenže jen potud, pokud je to vidět
> v tabulce úloh. pg-boss maže dokončené úlohy po sedmi dnech a tahle fronta
> tiká **týdně**, takže delší ticho než týden se z tabulky doložit nedá.
> V auditu ten strop není: `AUDIT_RETENTION_MONTHS` drží záznamy měsíce.

## 7. Obnova a její čtyři brány

```bash
docker compose exec app mlain restore /data/backups/<adresář> [--force] \
  [--skip-uploads] [--i-know-the-key-differs]
```

Obnova nespustí `pg_restore` dřív, než projdou všechny čtyři brány. Každá z nich
skončí nenulově a **databázi nechá nedotčenou**.

| # | Brána | Hláška | Co s tím |
|---|---|---|---|
| 1 | kontrolní součet dumpu | „Kontrolní součet database.dump nesedí, záloha je poškozená." | Zálohu nepoužívej, vezmi předchozí. Poškozený dump se nedá dolepit. |
| 2 | verze aplikace | `backup_from_newer_version: záloha je z verze X, tahle image je Y` | Aktualizuj image na aspoň verzi ze zálohy a zopakuj. Novější zálohu do starší aplikace obnovit nejde, poškodila by schéma. |
| 3 | prázdnost cíle | „Cílová databáze není prázdná a obnova by ji přepsala. Nic jsem nezměnil." | Když to opravdu chceš, zopakuj s `--force`; použije se `pg_restore --clean --if-exists`. |
| 4 | otisk klíče | „Otisk SECRET_KEY v záloze se liší od otisku aktuálního klíče." | Doplň chybějící pokolení do `SECRET_KEY_PREVIOUS`. Když víš, co děláš, zopakuj s `--i-know-the-key-differs`: uložené přístupy k odesílání a AI klíče bude nutné zadat znovu a otisky smazaných adres pod starými pokoleními přestanou platit. |

Po obnově se pouští migrační runner, takže záloha ze starší verze schématu se
dorovná na aktuální. Oprávnění se obnovují funkcí `mlain_apply_grants()`,
protože `pg_restore --no-owner --no-privileges` je nepřenáší.

> **Nález k 2026-08-06, ODVOZENÝ ZE ZDROJOVÉHO KÓDU, ne ověřený spuštěním.**
> V produkční image tenhle krok podle všeho selže.
> `packages/core/src/ops/restore.ts` volá `runMigrations({ url })` **bez cesty
> k migracím**, takže se použije výchozí odvození `../migrations` vůči modulu.
> CLI je ale zabundlované do jediného souboru `/app/apps/cli/dist/main.js`,
> kdežto migrace leží v `/app/packages/db/migrations`, takže cesta vyjde na
> `/app/apps/cli/migrations` a runner skončí na
> `ENOENT: open '/app/apps/cli/migrations/meta/_journal.json'`.
>
> **Proč to bolí:** `mlain_apply_grants()` se volá až ZA migracemi, takže se
> vůbec nespustí. Data v databázi jsou, oprávnění ne, a první dotaz aplikace
> spadne na `permission denied for table contacts`.
>
> Že je to reálná past, ne teorie: přesně tahle vada se už jednou opravovala
> u `mlain backup verify` a je popsaná v `apps/cli/src/migrations-folder.ts`.
> `restore` a `upgrade` z té opravy vypadly, cestu si nepředávají.
>
> **Než se to opraví:** po obnově si ověřte, že aplikace čte data. Když padá na
> „permission denied", dožeňte granty ručně pod rolí migrátora:
>
> ```bash
> docker compose --profile bundled exec postgres \
>   psql -U mlain_migrator -d mlain -c "SELECT mlain_apply_grants();"
> ```
>
> (U externího Postgresu se připojte svým `psql` pod rolí `mlain_migrator`.
> `--profile bundled` je nutné proto, že služba `postgres` je za profilem.)
>
> Ta funkce je idempotentní, takže se dá volat opakovaně. Migrace tím ale
> dohnané NEJSOU: obnovujte proto zálohu do image téže verze, ze které záloha
> pochází, aby nebylo co migrovat.

## 8. Externí cíl

Hook `/data/hooks/post-backup.sh` se spustí po každé úspěšné záloze a dostane
**cestu k adresáři jako první argument**. Typické použití je nahrání jinam:

```bash
#!/bin/sh
# /data/hooks/post-backup.sh
set -eu
rclone copy "$1" remote:mlain-backups/"$(basename "$1")"
```

Hook musí být spustitelný. Když skončí nenulově, záloha se **nepovažuje za
neúspěšnou**, ale selhání se zaloguje: záloha na disku existuje a to je hlavní.

## 9. Soukromí

Zálohy obsahují **osobní údaje**: e-mailové adresy, jména, města, historii
otevření a prokliků. Adresář `/data/backups` proto:

- drž na šifrovaném svazku (LUKS, FileVault, šifrovaný bucket),
- nekopíruj do sdílených složek bez šifrování,
- při ukončení provozu maž bezpečně, ne jen `rm`.

Otisky smazaných adres v `suppressions` jsou v záloze taky. Jsou to otisky, ne
adresy, ale za osobní údaj se počítají.
