import { sql } from 'drizzle-orm';
import type { Tx, WorkspaceContext } from '../../tx';

/** Maximum měsíců na jeden požadavek podle 3.12.2 části 5. */
export const MAX_MONTHS_PER_REQUEST = 3;

/**
 * Zpoždění doručení WEBOVÉ události. Vynucuje ho `ck_web_events__lag` z P03:
 * `occurred_at > received_at - 7 days`. Offline fronta SDK dál nesahá,
 * dávkový import je z omezení vyňatý a `received_at` si odvozuje z `occurred_at`.
 */
export const WEB_MAX_LAG_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Dolní tolerance u webových událostí. Totéž omezení povoluje
 * `occurred_at <= received_at + 60 seconds`, takže `received_at` smí být až
 * o minutu PŘED `occurred_at`. Bez téhle rezervy by událost, která vznikla
 * těsně nad hranicí okna, z osy vypadla.
 */
export const WEB_LAG_TOLERANCE_MS = 60 * 1000;

/**
 * Zpoždění u událostí ZPRÁVY. `message_events` žádné omezení na vztah `ts`
 * a `received_at` nemá a mít nemůže (R21): asynchronní odraz od SES chodí
 * i po týdnech a `delivery_delayed` opakovaně. Mez se proto bere z retence,
 * ne ze sedmi dnů. Jedna sdílená konstanta by zpožděný odraz z osy **tiše**
 * vypustila, protože okno se posouvá spolu s ním.
 */
export function messageMaxLagMs(retentionMonths: number): number {
  return retentionMonths * 31 * 24 * 60 * 60 * 1000;
}

export type TimeWindow = {
  from: Date;
  to: Date;
  /** Dolní mez pro received_at u webových událostí, o minutu pod `from`. */
  webReceivedFrom: Date;
  /** Horní mez pro received_at u webových událostí. Prořezává partition. */
  webReceivedTo: Date;
  /** Horní mez pro received_at u událostí zprávy. Prořezává partition. */
  messageReceivedTo: Date;
};

export async function listWebEventMonths(
  tx: Tx,
  ctx: WorkspaceContext,
  contactId: string,
): Promise<Date[]> {
  const { rows } = await tx.execute<{ month: string | Date }>(sql`
    SELECT month
      FROM web_event_months
     WHERE workspace_id = ${ctx.workspaceId}
       AND subject_kind = 'contact'
       AND subject_id   = ${contactId}
     ORDER BY month DESC
  `);
  return rows.map((row) => new Date(row.month));
}

/**
 * Okno pro jeden požadavek. Jde vždy nejvýš tři kalendářní měsíce zpět od `to`,
 * a nikdy pod `scopeStart`, což je začátek rozsahu, který si uživatel zvolil.
 *
 * `retentionMonths` předává volající z `config.TRACKING_RETENTION_MONTHS` (P01).
 * Doména konfiguraci nečte sama, aby šla testovat bez prostředí.
 */
export function pickWindow(to: Date, scopeStart: Date, retentionMonths: number): TimeWindow {
  const startOfMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  const candidate = new Date(
    Date.UTC(
      startOfMonth.getUTCFullYear(),
      startOfMonth.getUTCMonth() - (MAX_MONTHS_PER_REQUEST - 1),
      1,
    ),
  );
  const from = candidate < scopeStart ? scopeStart : candidate;
  return {
    from,
    to,
    webReceivedFrom: new Date(from.getTime() - WEB_LAG_TOLERANCE_MS),
    webReceivedTo: new Date(to.getTime() + WEB_MAX_LAG_MS),
    messageReceivedTo: new Date(to.getTime() + messageMaxLagMs(retentionMonths)),
  };
}
