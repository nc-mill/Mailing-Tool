import { loadConfig } from '../../config/index';
import { once } from '../../queues';
import { keyringEnvFromConfig } from '../keyring';
import { backupJob, backupVerifyJob, type BackupJobContext } from './backup-jobs';
import { partitionMaintenanceJob } from './partition-jobs';

/**
 * Rejstřík obsluh provozní domény, který hledá codegen workeru (rozhodnutí D4).
 *
 * Jméno souboru (`queue-handlers.ts`), jeho umístění (`<domena>/jobs/`) i jméno
 * exportu (`handlers`) jsou ZÁVAZNÁ. Codegen (`apps/worker/codegen.mjs`) globuje
 * přesně tuhle cestu a generuje z ní `import { handlers as hN } from
 * '@mlain/core/ops/jobs'`. Pod jiným jménem se soubor přeloží, testy zůstanou
 * zelené a fronty se zaregistrují BEZ OBSLUHY: záloha se každou noc zařadí,
 * nikdo si ji nevyzvedne a instalace nemá zálohu, aniž by cokoli spadlo.
 *
 * K souboru patří klíč `"./ops/jobs"` v `packages/core/package.json`. Bez něj se
 * import nerozřeší až při stavbě produkční image; hlídá to `assertExportsMapCovers`
 * v codegenu.
 *
 * `loadConfig()` se volá VÝHRADNĚ uvnitř funkcí. Na úrovni modulu by shodila
 * každý import, tedy i jednotkový test, který se souboru jen dotkne.
 *
 * MIGRAČNÍ RUNNER: `verifyBackup` si `@mlain/db/migrate` načítá dynamickým
 * importem uvnitř funkce (`ops/backup-verify.ts`), takže se do statického grafu
 * nedostane. Ve workeru je to jedno, ale právě tenhle modul by ho jinak přitáhl
 * do každého balíčku, který na `@mlain/core/ops/*` sáhne (nálezy I19 a I33).
 * Statický `import { runMigrations }` se sem tedy nesmí dostat ani omylem.
 */

/**
 * Konfigurace pro obě zálohovací úlohy.
 *
 * Skládá se při KAŽDÉM běhu, ne jednou při načtení modulu: proměnné prostředí se
 * v kontejneru mění restartem, ne za běhu, ale modul se načítá i v testech, kde
 * kompletní prostředí není.
 *
 * KLÍČE SE MUSÍ PŘEVÉST. `loadConfig()` nevrací `SECRET_KEY` jako řetězec, ale
 * jako `{ keyId, key, raw }`, a `SECRET_KEY_PREVIOUS` jako pole takových objektů;
 * `backupJob` přitom předává obojí do `loadOpsKeyring`, které čeká řetězce.
 * Předání beze změny by skončilo na `value.trim is not a function`, tedy až za
 * běhu první noční zálohy. Převod vlastní `keyringEnvFromConfig` a je jediný.
 */
function backupContext(): BackupJobContext {
  const config = loadConfig();
  const keys = keyringEnvFromConfig(config);
  return {
    config: {
      DATABASE_URL: config.DATABASE_URL,
      DATABASE_URL_MIGRATOR: config.DATABASE_URL_MIGRATOR,
      BACKUP_DIR: config.BACKUP_DIR,
      UPLOADS_DIR: config.UPLOADS_DIR,
      DATA_DIR: config.DATA_DIR,
      BACKUP_RETENTION_DAYS: config.BACKUP_RETENTION_DAYS,
      IMAGE_VERSION: config.IMAGE_VERSION,
      SECRET_KEY: keys.secretKey,
      SECRET_KEY_PREVIOUS: keys.secretKeyPrevious,
    },
  };
}

/*
 * OBSLUHA `tracking.rebuild_engagement` TU UŽ NENÍ, a odešla i s frontou.
 *
 * Rekonstrukci `contact_engagement` dělá příkaz `mlain rebuild-engagement`, který
 * volá `ops/rebuild-engagement.ts` přímo. Obsluha vedle něj byla cesta, kterou
 * nikdo nikdy nespustil, a bylo to na ní vidět: přijímala náklad ve dvou tvarech
 * (`workspace_id` i `workspaceId`) naslepo, protože se nedalo ověřit, který z nich
 * by producent posílal. Kontrolu na chybějící `DATABASE_URL_MIGRATOR` má CLI
 * vlastní (`apps/cli/src/commands/rebuild-engagement.ts`) a vrací u ní exit kód,
 * ne výjimku, takže se odstraněním téhle nic neztratilo.
 *
 * Důvod a podmínky případného návratu jsou u náhrobku v registru front.
 */

export const handlers = {
  /**
   * Obě zálohovací fronty jede cron s PRÁZDNÝM nákladem (`boss.schedule(name,
   * cron, {}, …)` v `apps/worker/src/boss.ts`), takže si berou všechno
   * z konfigurace.
   *
   * Obal `once`, ne `perJob`, a je to rozdíl v chování: dávka dvou tiků znamená
   * dvě zmeškané noci, ne dvě zálohy k pořízení. S `perJob` by po výpadku
   * workeru vznikly dva úplné dumpy za sebou, ten druhý úplně zbytečně.
   * Obal je i tak POVINNÝ, protože pg-boss volá obsluhu s DÁVKOU úloh; bez něj
   * by funkce dostala pole.
   */
  'platform.backup': once(async () => {
    await backupJob(backupContext());
  }),
  'platform.backup_verify': once(async () => {
    await backupVerifyJob(backupContext());
  }),
  /**
   * Údržba oddílů, tedy retence odeslané pošty a zakládání oddílů dopředu.
   * Zdůvodnění, proč to od 7. 8. 2026 dělá worker a ne jenom plánovač
   * hostitele, je v `partition-jobs.ts`.
   *
   * `once` ze stejného důvodu jako u zálohy: dávka dvou tiků znamená dvě
   * zmeškané noci, ne dvakrát tolik práce. Druhý průchod by nenašel nic,
   * protože první už oddíly založil i zahodil.
   *
   * Konfigurace se čte při KAŽDÉM běhu, ne při načtení modulu. `loadConfig()`
   * na úrovni modulu by shodila každý jednotkový test, který se souboru jen
   * dotkne.
   */
  'platform.maintain_partitions': once(async () => {
    const config = loadConfig();
    await partitionMaintenanceJob({
      config: { DATABASE_URL_MIGRATOR: config.DATABASE_URL_MIGRATOR },
    });
  }),
} as const;
