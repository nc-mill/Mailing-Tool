/**
 * Úkol 1 plánu P13. Nic neimplementuje, jen se ptá běžících registrů, jestli v nich
 * je to, na čem doména kampaní stojí. Bez toho by se chybějící položka projevila
 * až uprostřed fáze I jako nesrozumitelná runtime chyba.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM, tři kusy:
 *  1. Plán se ptal `configSchema`. P01 exportuje `ConfigSchema` (velké C) a druhé
 *     jméno pro tentýž objekt by byl zdroj rozporu.
 *  2. Plán se ptal `ERROR_REGISTRY[code]`. Ten objekt je v repozitáři mapa DRUHŮ
 *     (`problem`, `validation`, ...) na pole položek, ne mapa kódů, takže by
 *     indexace vracela `undefined` u každého kódu a test by byl červený vždycky.
 *     Otázku „je kód registrovaný" zodpovídá `isRegisteredCode()`, což registr sám
 *     ve svém komentáři výslovně říká.
 *  3. Plán se ptal `Object.keys(QUEUE_REGISTRY)`. Registr front je POLE položek,
 *     takže klíče jsou indexy a žádné jméno fronty by v nich nebylo. Jména vrací
 *     `queueNames()`.
 *
 * Skutečný stav, ověřený spuštěním: všech dvanáct front, všech pětatřicet chybových
 * kódů (včetně sedmi `provider_smtp_*` z R-P01.4 a `contract_mismatch` z R-P01.5)
 * i všech šestadvacet konfiguračních proměnných (včetně šesti z R-P01.1) P01 už má.
 * Požadavky R-P01.1, R-P01.4 a R-P01.5 jsou tedy splněné.
 */
import { describe, expect, it } from 'vitest';
import { queueNames } from '../../queues/registry';
import { isRegisteredCode } from '../../errors/registry';
import { ConfigSchema } from '../../config/schema';

const REQUIRED_QUEUES = [
  'campaign.materialize',
  'campaign.scheduler',
  'campaign.watchdog',
  'campaign.resume_on_quota',
  'outbox.stall_watch',
  'outbox.reconcile',
  'provider_event.process',
  'provider_event.rematch',
  'provider.refresh_quota',
  'domain.recheck',
  'deliverability.rollup',
] as const;

/**
 * Fronty, které P13 kdysi na registru P01 vyžadoval, ale byly VĚDOMĚ ZRUŠENY.
 *
 * Test je obrácený schválně: hlídá, že se nevrátí, ne že existují. Kdyby tady
 * jen zmizely ze seznamu výš, nic by nebránilo tomu, aby je za rok někdo založil
 * znovu s odůvodněním „chybí přece úklid oddílů".
 *
 * Společný důvod zrušení: odpojení oddílu je DDL (`ALTER TABLE ... DETACH
 * PARTITION`) a worker běží pod rolí `mlain_app`, která schéma nevlastní.
 * Obsluha jim proto nikdy nevznikla a vzniknout nemohla; v registru jen
 * vypadaly jako běžící údržba. Práci převzal příkaz `mlain partitions` pod
 * migrátorskou rolí, pouštěný z plánovače hostitele. Viz
 * `packages/core/src/ops/partition-retention.ts`.
 */
const REMOVED_QUEUES = ['retention.drop_message_partitions'] as const;

const REQUIRED_ERROR_CODES = [
  'campaign_locked',
  'campaign_audience_changed',
  'campaign_undo_window_expired',
  'campaign_audience_empty',
  'campaign_audience_too_large',
  'campaign_not_compiled',
  'campaign_subject_missing',
  'campaign_no_unsubscribe',
  'campaign_unknown_merge_field',
  'campaign_schedule_too_soon',
  'campaign_schedule_too_far',
  'campaign_not_sendable',
  'provider_not_ready',
  'provider_sending_paused',
  'provider_quota_exceeded',
  'provider_sandbox',
  'provider_credentials_invalid',
  'provider_smtp_host_unknown',
  'provider_smtp_connection_refused',
  'provider_smtp_tls_invalid',
  'provider_smtp_auth_failed',
  'provider_smtp_timeout',
  'provider_smtp_starttls_unsupported',
  'provider_smtp_greeting_invalid',
  'domain_dkim_missing',
  'domain_spf_missing',
  'domain_dmarc_missing',
  'test_recipient_suppressed',
  'signature_invalid',
  'invalid_state_transition',
  'validation_failed',
  'not_found',
  'rate_limited',
  'conflict',
  // Nález plánu P08, viz požadavek R-P01.5. Bez něj nejde postavit kontrola z úkolu 47.
  'contract_mismatch',
] as const;

const REQUIRED_CONFIG_KEYS = [
  'CAMPAIGN_MATERIALIZE_BATCH_SIZE',
  'CAMPAIGN_MATERIALIZE_MAX_MINUTES',
  'CAMPAIGN_MAX_RECIPIENTS',
  'CAMPAIGN_PARTIAL_THRESHOLD',
  'CAMPAIGN_SCHEDULE_CATCHUP_HOURS',
  'CAMPAIGN_UNDO_WINDOW_SECONDS',
  'CAMPAIGN_QUOTA_PAUSE_REMAINING',
  'CAMPAIGN_QUOTA_RESUME_REMAINING',
  'CAMPAIGN_TEST_SEND_PER_HOUR',
  'SOFT_BOUNCE_THRESHOLD',
  'SOFT_BOUNCE_WINDOW_DAYS',
  'DELIVERABILITY_BOUNCE_GUARD_RATE',
  'DELIVERABILITY_COMPLAINT_GUARD_RATE',
  'DELIVERABILITY_BOUNCE_WARN_RATE',
  'DELIVERABILITY_COMPLAINT_WARN_RATE',
  'DELIVERABILITY_GUARD_MIN_SENT',
  'DELIVERABILITY_CONTENT_BOUNCE_LIMIT',
  'MESSAGE_RETENTION_DAYS',
  'MESSAGE_EVENT_RETENTION_DAYS',
  'SNS_CERT_CACHE_SECONDS',
  'SNS_STORE_RAW_EVENTS',
  'DNS_CHECK_TIMEOUT_MS',
  'DNS_CHECK_CONCURRENCY',
  'AWS_API_TIMEOUT_MS',
  'SENDER_BATCH_SIZE',
  'APP_URL',
] as const;

describe('predpoklady P13 o cizich registrech', () => {
  it.each(REQUIRED_QUEUES)('fronta %s je v registru P01', (name) => {
    expect(queueNames()).toContain(name);
  });

  it.each(REMOVED_QUEUES)('fronta %s se do registru P01 nevratila', (name) => {
    expect(queueNames()).not.toContain(name);
  });

  it.each(REQUIRED_ERROR_CODES)('chybovy kod %s je v registru P01', (code) => {
    expect(isRegisteredCode(code)).toBe(true);
  });

  it.each(REQUIRED_CONFIG_KEYS)('konfiguracni promenna %s je v zod schematu P01', (key) => {
    expect(ConfigSchema.shape).toHaveProperty(key);
  });

  it('CAMPAIGN_QUOTA_RESUME_REMAINING je vetsi nez PAUSE, jinak kampan cykluje', () => {
    const parsed = ConfigSchema.parse({
      ...process.env,
      APP_URL: 'https://example.test',
      SECRET_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    });
    expect(parsed.CAMPAIGN_QUOTA_RESUME_REMAINING).toBeGreaterThan(
      parsed.CAMPAIGN_QUOTA_PAUSE_REMAINING,
    );
  });
});
