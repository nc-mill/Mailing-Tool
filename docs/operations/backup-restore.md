# Zálohy a obnova

Provozní runbook. Platí pro instalaci z `docker/compose.yml`.

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
docker compose exec app mlain backup
```

Příkaz vypíše cestu k adresáři (`Záloha hotová: /data/backups/…`), počet
kontaktů v záloze a stav keyringu. Běží pod `DATABASE_URL_MIGRATOR`, protože
role, na kterou dopadá RLS, zálohu nedokončí; podrobně v kapitole 7.

## 4. Plánovaná záloha

| Proměnná | Výchozí | Význam |
|---|---|---|
| `BACKUP_SCHEDULE_CRON` | `0 3 * * *` | kdy se spustí noční záloha |

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
