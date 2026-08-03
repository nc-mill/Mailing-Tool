import { loadConfig } from '../../config/index';
import { once, perJob } from '../../queues';
import { keyringEnvFromConfig } from '../keyring';
import { rebuildEngagement } from '../rebuild-engagement';
import { backupJob, backupVerifyJob, type BackupJobContext } from './backup-jobs';

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

/**
 * Náklad `tracking.rebuild_engagement`.
 *
 * Registr front deklaruje pole `workspace_id` a `batch_size`, doménové joby
 * kontaktů a kampaní ale posílají `workspaceId`. Producent téhle fronty
 * v repozitáři zatím není (přepočet se dnes spouští jen z CLI `mlain`), takže
 * se přijímají OBA tvary. Je to levnější než čekat, až se první skutečná úloha
 * rozejde s registrem a přepočet tiše spadne na `undefined` v UUID.
 */
type RebuildEngagementPayload = {
  workspace_id?: string;
  workspaceId?: string;
  batch_size?: number;
  batchSize?: number;
};

function requireWorkspaceId(payload: RebuildEngagementPayload): string {
  const workspaceId = payload.workspace_id ?? payload.workspaceId;
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    throw new Error(
      'Fronta tracking.rebuild_engagement dostala náklad bez workspace_id. ' +
        'Přepočet běží nad jedním projektem a bez něj by pod aplikační rolí zpracoval ' +
        'nula kontaktů a ohlásil hotovo.',
    );
  }
  return workspaceId;
}

/**
 * Připojení pro přepočet zapojení.
 *
 * MUSÍ to být migrátorské URL. `contacts`, `contact_engagement`
 * i `message_engagement` mají `ws_isolation`, takže pod `mlain_app` by přepočet
 * prošel, zpracoval nula kontaktů a ohlásil hotovo. Chybějící proměnná se proto
 * hlásí výjimkou, ne tichým během.
 */
function requireAdminUrl(): string {
  const url = loadConfig().DATABASE_URL_MIGRATOR;
  if (url === undefined || url.length === 0) {
    throw new Error(
      'Přepočet zapojení vyžaduje DATABASE_URL_MIGRATOR. Pod aplikační rolí platí row ' +
        'level security, přepočet by zpracoval nula kontaktů a ohlásil hotovo.',
    );
  }
  return url;
}

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

  'tracking.rebuild_engagement': perJob<RebuildEngagementPayload>(async (job) => {
    await rebuildEngagement({
      adminUrl: requireAdminUrl(),
      workspaceId: requireWorkspaceId(job.data),
      ...((job.data.batch_size ?? job.data.batchSize)
        ? { batchSize: (job.data.batch_size ?? job.data.batchSize) as number }
        : {}),
    });
  }),
} as const;
