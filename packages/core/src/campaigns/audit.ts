import { defineAuditActions } from '../audit/action';

/**
 * Auditní akce domény kampaní, které zapisují SYSTÉMOVÉ úlohy.
 *
 * Soubor vzniká teprve teď, protože do zapojení cronových úloh neměla doména
 * kampaní co auditovat: akce vyvolané člověkem zapisuje vrstva API pod svými
 * názvy, tyhle tři nemá kdo vyvolat než worker.
 *
 * `defineAuditActions` je jediná cesta, jak vyrobit hodnotu typu `AuditAction`,
 * takže neregistrovaný název se do `audit_log` nedostane ani omylem. Že se
 * název neopakuje s jinou doménou, hlídá `audit/audit-actions.test.ts`.
 */
export const CampaignAuditActions = defineAuditActions([
  /** Kampaň propásla catch-up okno a čeká na rozhodnutí člověka. */
  'campaign.schedule_missed',
  /** Kampaň odešla se zpožděním nad SCHEDULE_DELAY_NOTIFY_SECONDS. */
  'campaign.schedule_delayed',
  /**
   * Automatická pauza. Zapisuje ji APLIKACE i tehdy, když pauzu provedl sender:
   * ten do `audit_log` granty nemá a mít je nemá, takže bez tohohle by pauzy
   * z circuit breakeru v auditu nebyly vůbec.
   */
  'campaign.auto_paused',
]);
