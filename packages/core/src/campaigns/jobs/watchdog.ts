import { WATCHDOG_QUIET_SECONDS } from '../constants';
import { isAutoPause, type PauseReason } from '../pause-reason';

export const WATCHDOG_JOB = {
  queue: 'campaign.watchdog' as const,
  cron: '*/15 * * * * *',
  retryLimit: 3,
  expireInSeconds: 12,
};

/**
 * Vysledny stav se pocita VYHRADNE ze skupiny "predani provideru", protoze uzavreni
 * kampane je otazka "doposlali jsme to?", ne "dorazilo to?". Kampan, ze ktere se
 * vsechno predalo a vsechno se pak odrazilo, se uzavre jako sent. Je to spravne:
 * odeslali jsme ji celou. Kdyby uzaviraci pravidlo koukalo na bouncy, cekalo by
 * na dobihajici udalosti a kampan by se neuzavrela hodiny po skutecnem konci.
 */
export function closingStatus(input: {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  partialThreshold: number;
}): 'sent' | 'partially_sent' | 'failed' {
  if (input.total === 0) return 'failed';
  const notDelivered = input.failed + input.skipped;
  if (notDelivered === input.total) return 'failed';
  if (notDelivered / input.total > input.partialThreshold) return 'partially_sent';
  return 'sent';
}

export type WatchdogDeps = {
  listRunning(): Promise<
    Array<{
      workspaceId: string;
      campaignId: string;
      audienceBuiltAt: string | null;
      status: string;
      pauseReason: PauseReason | null;
    }>
  >;
  reconcileHandover(workspaceId: string, campaignId: string): Promise<void>;
  reconcileDelivery(workspaceId: string, campaignId: string): Promise<void>;
  counters(
    workspaceId: string,
    campaignId: string,
  ): Promise<{ total: number; sent: number; failed: number; skipped: number; lastChangeAt: Date }>;
  drained(workspaceId: string, campaignId: string, audienceBuiltAt: string): Promise<boolean>;
  close(
    workspaceId: string,
    campaignId: string,
    status: 'sent' | 'partially_sent' | 'failed',
  ): Promise<boolean>;
  hasAuditForPause(workspaceId: string, campaignId: string, at: string): Promise<boolean>;
  writeAutoPauseAudit(workspaceId: string, campaignId: string, reason: PauseReason): Promise<void>;
  /**
   * Zařadí `sender.credentials_refresh` pro odesílací účet téhle kampaně.
   *
   * Volá se JEN u pauzy `credentials_undecryptable`, tedy když sender nedokázal
   * otevřít obálku s přístupovými údaji. Kampaň bez odesílacího účtu se
   * přeskočí, proto ta návratová hodnota.
   */
  requestCredentialsRefresh(workspaceId: string, campaignId: string): Promise<boolean>;
  emit(input: { workspaceId: string; type: string; campaignId: string }): Promise<void>;
  now(): Date;
  partialThreshold: number;
};

export async function watchdogHandler(deps: WatchdogDeps): Promise<void> {
  for (const c of await deps.listRunning()) {
    // Audit campaign.auto_paused zapisuje APLIKACE i tehdy, kdyz pauzu provedl sender.
    // Sender do audit_log nema granty a mit je nema, takze bez tohohle by pauzy
    // provedene senderem v auditu vubec nebyly.
    if (c.status === 'paused' && c.pauseReason && isAutoPause(c.pauseReason)) {
      if (!(await deps.hasAuditForPause(c.workspaceId, c.campaignId, c.pauseReason.at))) {
        await deps.writeAutoPauseAudit(c.workspaceId, c.campaignId, c.pauseReason);
        await deps.emit({
          workspaceId: c.workspaceId,
          type: 'campaign.paused',
          campaignId: c.campaignId,
        });

        /*
         * Sebeopravný krok, a jediné místo, ze kterého se `sender.credentials_refresh`
         * kdy zařadí. Bez něj byla ta fronta v registru bez producenta i bez
         * obsluhy, takže se do ní nikdy nic nedostalo.
         *
         * `credentials_undecryptable` zapisuje sender, když neotevře obálku
         * s přístupovými údaji; typicky po otočení SECRET_KEY a restartu bez
         * SECRET_KEY_PREVIOUS. Aplikace tu obálku otevřít umí (má starší pokolení
         * ve svém keyringu), takže ji přešifruje pod aktuální klíč a sender
         * pojede dál. Ruční zásah ani restart senderu k tomu potřeba není.
         *
         * Je to uvnitř větve „audit ještě nebyl", takže se to zařadí JEDNOU
         * na pauzu, ne při každém tiku hlídače. Singleton klíč fronty je
         * `provider_id`, což je druhá pojistka proti nakupení úloh.
         */
        if (c.pauseReason.code === 'credentials_undecryptable') {
          await deps.requestCredentialsRefresh(c.workspaceId, c.campaignId);
        }
      }
      continue;
    }

    if (c.status !== 'queueing' && c.status !== 'sending') continue;

    await deps.reconcileHandover(c.workspaceId, c.campaignId);
    await deps.reconcileDelivery(c.workspaceId, c.campaignId);

    if (!c.audienceBuiltAt) continue;
    if (!(await deps.drained(c.workspaceId, c.campaignId, c.audienceBuiltAt))) continue;

    const counters = await deps.counters(c.workspaceId, c.campaignId);
    const quietFor = (deps.now().getTime() - counters.lastChangeAt.getTime()) / 1000;
    if (quietFor < WATCHDOG_QUIET_SECONDS) continue;

    const status = closingStatus({ ...counters, partialThreshold: deps.partialThreshold });
    if (await deps.close(c.workspaceId, c.campaignId, status)) {
      await deps.emit({
        workspaceId: c.workspaceId,
        type: 'campaign.sent',
        campaignId: c.campaignId,
      });
    }
  }
}
