import type { ConfigIssue } from './load';
import type { MlainConfig } from './schema';

/**
 * Kontroly, které se týkají vztahu mezi proměnnými. Zod je neumí vyjádřit
 * na úrovni jednoho pole a vracejí se ve stejném seznamu jako zbytek, aby
 * platilo "všechny chyby naráz" z akceptačního kritéria 3.
 */
export function crossChecks(config: MlainConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  // Kritérium 8c. Při MODE=all jsou to potomci jednoho kontejneru se sdíleným
  // prostředím, takže shodný port znamená EADDRINUSE u druhého z nich.
  if (config.MODE === 'all') {
    if (config.SENDER_HEALTH_PORT === config.WORKER_HEALTH_PORT) {
      issues.push({
        variable: 'SENDER_HEALTH_PORT',
        message: `při MODE=all se nesmí rovnat WORKER_HEALTH_PORT (${config.WORKER_HEALTH_PORT}), potomci sdílejí prostředí`,
      });
    }
    if (config.PORT === config.WORKER_HEALTH_PORT || config.PORT === config.SENDER_HEALTH_PORT) {
      issues.push({
        variable: 'PORT',
        message: 'při MODE=all se nesmí rovnat WORKER_HEALTH_PORT ani SENDER_HEALTH_PORT',
      });
    }
  }

  // Kritérium 8d. Aplikační role mlain_app schéma nevlastní a migrovat nemůže.
  if (config.MIGRATE_ON_START && !config.DATABASE_URL_MIGRATOR) {
    issues.push({
      variable: 'DATABASE_URL_MIGRATOR',
      message:
        'migrace vyžadují DATABASE_URL_MIGRATOR (role mlain_migrator). Aplikační role mlain_app schéma nevlastní a migrovat nesmí. Buď proměnnou doplňte, nebo nastavte MIGRATE_ON_START=false.',
    });
  }

  // Část 4b: pod čtyřnásobkem by hlídač zaseknuté dávky hlásil planý poplach
  // na každé normálně běžící dávce.
  if (config.SENDER_CLAIM_TTL_SECONDS <= 4 * config.SENDER_DISPATCH_TIMEOUT_SECONDS) {
    issues.push({
      variable: 'SENDER_CLAIM_TTL_SECONDS',
      message: `musí být větší než 4 x SENDER_DISPATCH_TIMEOUT_SECONDS (${4 * config.SENDER_DISPATCH_TIMEOUT_SECONDS})`,
    });
  }

  if (config.METRICS_ENABLED && !config.METRICS_TOKEN) {
    issues.push({
      variable: 'METRICS_TOKEN',
      message: 'je povinná (required), když je METRICS_ENABLED=true, a musí mít aspoň 32 znaků',
    });
  }

  if (config.STORAGE_DRIVER === 's3') {
    for (const variable of [
      'S3_BUCKET',
      'S3_REGION',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ] as const) {
      if (!config[variable]) {
        issues.push({
          variable,
          message: 'je povinná (required), když je STORAGE_DRIVER=s3',
        });
      }
    }
  }

  if (!config.SUPPORTED_LOCALES.includes(config.DEFAULT_LOCALE)) {
    issues.push({
      variable: 'DEFAULT_LOCALE',
      message: `musí být v SUPPORTED_LOCALES (${config.SUPPORTED_LOCALES.join(', ')})`,
    });
  }

  if (config.SESSION_IDLE_TTL_DAYS > config.SESSION_ABSOLUTE_TTL_DAYS) {
    issues.push({
      variable: 'SESSION_IDLE_TTL_DAYS',
      message: `nesmí být větší než SESSION_ABSOLUTE_TTL_DAYS (${config.SESSION_ABSOLUTE_TTL_DAYS})`,
    });
  }

  // Bez tohohle by se kampaň pozastavila a hned obnovila dokola.
  if (config.CAMPAIGN_QUOTA_RESUME_REMAINING <= config.CAMPAIGN_QUOTA_PAUSE_REMAINING) {
    issues.push({
      variable: 'CAMPAIGN_QUOTA_RESUME_REMAINING',
      message: `musí být větší než CAMPAIGN_QUOTA_PAUSE_REMAINING (${config.CAMPAIGN_QUOTA_PAUSE_REMAINING}), jinak kampaň cykluje mezi pauzou a obnovením`,
    });
  }

  if (config.DELIVERABILITY_BOUNCE_WARN_RATE > config.DELIVERABILITY_BOUNCE_GUARD_RATE) {
    issues.push({
      variable: 'DELIVERABILITY_BOUNCE_WARN_RATE',
      message:
        'nesmí být vyšší než DELIVERABILITY_BOUNCE_GUARD_RATE, varování má přijít před brzdou',
    });
  }

  if (config.DELIVERABILITY_COMPLAINT_WARN_RATE > config.DELIVERABILITY_COMPLAINT_GUARD_RATE) {
    issues.push({
      variable: 'DELIVERABILITY_COMPLAINT_WARN_RATE',
      message:
        'nesmí být vyšší než DELIVERABILITY_COMPLAINT_GUARD_RATE, varování má přijít před brzdou',
    });
  }

  if (config.TRACKING_STORE_COUNTRY && !config.TRACKING_GEOIP_DB_PATH) {
    issues.push({
      variable: 'TRACKING_GEOIP_DB_PATH',
      message: 'je povinná (required), když je TRACKING_STORE_COUNTRY=true',
    });
  }

  if (config.NODE_ENV === 'production' && config.LOG_FORMAT === 'pretty') {
    issues.push({
      variable: 'LOG_FORMAT',
      message: 'hodnota pretty je povolená jen mimo produkci',
    });
  }

  if (config.MODE !== 'all' && config.MODE !== 'web' && config.MIGRATE_ON_START) {
    issues.push({
      variable: 'MIGRATE_ON_START',
      message: `migrace pouští jen MODE=web a MODE=all, ne MODE=${config.MODE}`,
    });
  }

  return issues;
}
