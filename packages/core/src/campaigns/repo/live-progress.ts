import { withWorkspace, type WorkspaceContext } from '../../tx';
import { rawSql } from './raw-sql';

/**
 * ŽIVÝ průběh rozesílky. Čte se z `messages` a `message_events`, ne ze sloupců
 * `campaigns.*_count`.
 *
 * Proč: ty sloupce plní VÝHRADNĚ cronová úloha `campaign.watchdog`, a to jednou
 * za patnáct sekund (`WATCHDOG_JOB.cron`). Obrazovka průběhu se přitom obnovuje
 * po několika sekundách, takže dokud četla uložená čísla, ukazovala mezi dvěma
 * tiky hlídače pořád tutéž hodnotu. U kampaně na tři adresy, která doběhne
 * za vteřinu, to znamenalo, že se ukazatel nepohnul ANI JEDNOU: uživatel viděl
 * nuly a pak rovnou hotovo. Přesně to zadavatel popsal.
 *
 * Dotazy jsou ZÁMĚRNĚ tytéž agregace, jaké zapisuje `reconcileHandoverCounters`
 * a `reconcileDeliveryCounters`. Kdyby se rozešly, obrazovka by během rozesílky
 * ukazovala jiné číslo než po jejím uzavření a vypadalo by to, jako by se část
 * zpráv na konci ztratila. Tenhle modul NIC NEZAPISUJE: jediným zapisovatelem
 * čítačů zůstává hlídač.
 *
 * Cena: `idx_messages__campaign_status` je nad `(campaign_id, status)`, takže
 * agregace jede po indexu jedné kampaně. Je to týž dotaz, jaký nad každou běžící
 * kampaní stejně jednou za patnáct sekund pouští hlídač. O to, aby se neopakoval
 * donekonečna každou vteřinu, se stará obrazovka: interval obnovování se
 * prodlužuje a po dojetí kampaně skončí úplně.
 */
export type LiveHandover = {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  /**
   * Nejisté odeslání se počítá stejně, jako ho počítala samostatná funkce
   * `ambiguousCount`: jen zprávy z aktuálního publika (`created_at =
   * audience_built_at`). Je to jeden dotaz místo dvou.
   */
  ambiguous: number;
  /**
   * Poslední změna V OUTBOXU, ne `campaigns.updated_at`.
   *
   * `campaigns.updated_at` se na zaseknutou rozesílku ptát NEJDE a je to
   * opravená chyba, ne detail: `reconcileHandoverCounters` dělá bezpodmínečný
   * `UPDATE campaigns ... updated_at = now()` při každém tiku hlídače, tedy
   * jednou za patnáct sekund. Podmínka „přes minutu se nic nezměnilo" tudíž
   * nebyla nikdy splněná a hláška o stojícím odesílání se NEUKÁZALA ANI
   * JEDNOU, ať se dělo cokoli. Hlídač sám si tuhle hodnotu bere z outboxu
   * ze stejného důvodu.
   *
   * `null` znamená, že kampaň zatím nemá jedinou zprávu, takže se není od čeho
   * odrazit a o zaseknutí se nedá mluvit.
   */
  lastChangeAt: string | null;
};

export type LiveDelivery = {
  delivered: number;
  bounced: number;
  complained: number;
  /**
   * Kolik událostí o doručení dorazilo OD POSKYTOVATELE.
   *
   * Nula a „neměříme" jsou dvě různé věci a bez tohohle čísla je obrazovka
   * nerozliší. Doručenost se nedozvíme odjinud než z událostí od poskytovatele
   * (`source` je `ses_sns` nebo `smtp`); dokud nedorazila ani jedna, není
   * `delivered = 0` údaj, ale absence údaje. Ve vývoji je to trvalý stav:
   * odběr u Amazonu se nepotvrdí, protože náš webhook běží na `localhost`,
   * a fronty `provider_event.process` i `tracking.process_provider_events`
   * v tomhle buildu navíc nemají obsluhu, takže by se událost nezpracovala,
   * ani kdyby přišla.
   *
   * Vlastní události aplikace (`internal`, `tracking`) se do tohohle čísla
   * NEPOČÍTAJÍ: sender zapisuje `render_failed` pod `internal` a otevření
   * s prokliky chodí pod `tracking`. Ani jedno o doručení nevypovídá nic.
   */
  providerEvents: number;
};

export async function readLiveHandover(
  ctx: WorkspaceContext,
  input: { campaignId: string; audienceBuiltAt: string | null },
): Promise<LiveHandover> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{
      total: number;
      sent: number;
      failed: number;
      skipped: number;
      ambiguous: number;
      last_change_at: string | null;
    }>(
      rawSql(
        // `kind = 'campaign'` drží stejnou hranici jako `reconcileHandoverCounters`:
        // testovací mail, který si někdo poslal minutu před odesláním, není součástí
        // publika a do průběhu kampaně nepatří.
        `SELECT
           count(*)::int                                              AS total,
           count(*) FILTER (WHERE status = 'sent')::int               AS sent,
           count(*) FILTER (WHERE status = 'failed')::int             AS failed,
           count(*) FILTER (WHERE status = 'skipped')::int            AS skipped,
           count(*) FILTER (WHERE error_code = 'ambiguous_dispatch'
                              AND created_at = $3::timestamptz)::int  AS ambiguous,
           max(updated_at)                                            AS last_change_at
         FROM messages
        WHERE campaign_id = $1 AND workspace_id = $2 AND kind = 'campaign'`,
        [input.campaignId, ctx.workspaceId, input.audienceBuiltAt],
      ),
    );
    const row = r.rows[0];
    if (!row) {
      return { total: 0, sent: 0, failed: 0, skipped: 0, ambiguous: 0, lastChangeAt: null };
    }
    return {
      total: row.total,
      sent: row.sent,
      failed: row.failed,
      skipped: row.skipped,
      ambiguous: row.ambiguous,
      lastChangeAt: row.last_change_at === null ? null : new Date(row.last_change_at).toISOString(),
    };
  });
}

export async function readLiveDelivery(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<LiveDelivery> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{
      delivered: number;
      bounced: number;
      complained: number;
      provider_events: number;
    }>(
      rawSql(
        `SELECT
           count(DISTINCT message_id) FILTER (WHERE type = 'delivered')::int   AS delivered,
           count(DISTINCT message_id) FILTER (WHERE type IN ('bounced_hard','bounced_soft'))::int
                                                                               AS bounced,
           count(DISTINCT message_id) FILTER (WHERE type = 'complained')::int  AS complained,
           count(*) FILTER (WHERE source IN ('ses_sns','smtp'))::int           AS provider_events
         FROM message_events
        WHERE campaign_id = $1 AND workspace_id = $2`,
        [campaignId, ctx.workspaceId],
      ),
    );
    const row = r.rows[0];
    if (!row) return { delivered: 0, bounced: 0, complained: 0, providerEvents: 0 };
    return {
      delivered: row.delivered,
      bounced: row.bounced,
      complained: row.complained,
      providerEvents: row.provider_events,
    };
  });
}
