import { HARD_BOUNCE_REMOVAL_MIN_DAYS } from './limits';

export type SuppressionReason =
  | 'complaint'
  | 'gdpr_erasure'
  | 'hard_bounce'
  | 'soft_bounce_threshold'
  | 'manual'
  | 'import'
  | 'invalid'
  | 'global_unsubscribe'
  | 'one_click_unsubscribe';

export type SuppressionRow = {
  id: string;
  masked_email: string;
  reason: SuppressionReason;
  created_at: string;
};

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

export type SuppressionAffordance = {
  kind: 'removable' | 'locked' | 'waiting' | 'info';
  reasonKey: string;
  explanationKey: string | null;
  values: Record<string, number>;
};

const REASON_KEY: Record<SuppressionReason, string> = {
  complaint: 'suppressions.reason.complaint',
  gdpr_erasure: 'suppressions.reason.gdprErasure',
  hard_bounce: 'suppressions.reason.hardBounce',
  soft_bounce_threshold: 'suppressions.reason.softBounceThreshold',
  manual: 'suppressions.reason.manual',
  import: 'suppressions.reason.import',
  invalid: 'suppressions.reason.invalid',
  global_unsubscribe: 'suppressions.reason.globalUnsubscribe',
  one_click_unsubscribe: 'suppressions.reason.oneClickUnsubscribe',
};

/**
 * Popisek důvodu blokace pro libovolnou hodnotu ze serveru.
 *
 * `REASON_KEY` výš je typovaný podle `SuppressionReason`, tedy podle důvodů, které umí
 * obrazovka blokovaných adres. Ruční potvrzení kontaktu ale dostane důvod jako holý
 * řetězec z odpovědi API a mezi nimi je i `ses_suppressed`, který se v seznamu
 * blokovaných adres neobjeví, protože ho nejde odebrat u nás. Bez záchytné větve by
 * `t(undefined)` spadlo za běhu právě u toho případu, který se nedá vyzkoušet klikáním.
 */
export function suppressionReasonKey(reason: string): string {
  if (reason === 'ses_suppressed') return 'suppressions.reason.sesSuppressed';
  return REASON_KEY[reason as SuppressionReason] ?? 'suppressions.reason.other';
}

/** Důvody, které smí odebrat editor a výš, a to i hromadně (poslední řádek matice 4.10.2). */
const BULK_REMOVABLE: readonly SuppressionReason[] = [
  'soft_bounce_threshold',
  'manual',
  'import',
  'invalid',
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Promítnutí matice odebrání ze 4.10.2 části 2 do sloupce akce. Rozhraní nikdy neukáže
 * tlačítko, které skončí chybou ze serveru: buď akci nabídne, nebo řekne proč ne.
 *
 * Server tuhle funkci NEZASTUPUJE ani naopak. Autoritou je doména
 * (packages/core/src/contacts/suppression/removal.ts), tohle je jen dopředná informace,
 * aby uživatel neklikal naslepo.
 */
export function suppressionAffordance(
  row: SuppressionRow,
  role: WorkspaceRole,
  now: Date = new Date(),
): SuppressionAffordance {
  const reasonKey = REASON_KEY[row.reason];

  if (row.reason === 'complaint') {
    return {
      kind: 'locked',
      reasonKey,
      explanationKey: 'suppressions.complaintLocked',
      values: {},
    };
  }
  if (row.reason === 'gdpr_erasure') {
    return { kind: 'locked', reasonKey, explanationKey: 'suppressions.gdprLocked', values: {} };
  }
  if (row.reason === 'global_unsubscribe' || row.reason === 'one_click_unsubscribe') {
    return {
      kind: 'info',
      reasonKey,
      explanationKey: 'suppressions.unsubscribeSelfService',
      values: {},
    };
  }

  if (row.reason === 'hard_bounce') {
    // Jen vlastník a správce, jen po jedné a jen po 30 dnech. Hromadné odblokování
    // trvale nedoručitelných adres je nejrychlejší cesta k pozastavení účtu
    // u odesílací služby.
    if (role !== 'owner' && role !== 'admin') {
      return { kind: 'locked', reasonKey, explanationKey: 'suppressions.locked', values: {} };
    }
    const ageDays = Math.floor((now.getTime() - new Date(row.created_at).getTime()) / DAY_MS);
    const daysLeft = HARD_BOUNCE_REMOVAL_MIN_DAYS - ageDays;
    if (daysLeft > 0) {
      return {
        kind: 'waiting',
        reasonKey,
        explanationKey: 'suppressions.bounceTooRecent',
        values: { days: daysLeft },
      };
    }
    return { kind: 'removable', reasonKey, explanationKey: null, values: {} };
  }

  if (role === 'viewer') {
    return { kind: 'locked', reasonKey, explanationKey: 'suppressions.locked', values: {} };
  }

  return { kind: 'removable', reasonKey, explanationKey: null, values: {} };
}

export type BulkRemovalSummary = {
  removableIds: string[];
  removable: number;
  total: number;
  blocked: number;
};

/**
 * Hromadné odebrání se nabízí jen u důvodů z posledního řádku matice. Trvalé nedoručení
 * se z něj vyjímá schválně, i když jednotlivě odebrat jde: 4.10.2 části 2 hromadné
 * odebrání trvale nedoručitelných adres výslovně zakazuje.
 */
export function bulkRemovalSummary(
  rows: readonly SuppressionRow[],
  selectedIds: ReadonlySet<string>,
  role: WorkspaceRole,
  now: Date = new Date(),
): BulkRemovalSummary {
  const selected = rows.filter((row) => selectedIds.has(row.id));
  const removableIds = selected
    .filter(
      (row) =>
        BULK_REMOVABLE.includes(row.reason) &&
        suppressionAffordance(row, role, now).kind === 'removable',
    )
    .map((row) => row.id);

  return {
    removableIds,
    removable: removableIds.length,
    total: selected.length,
    blocked: selected.length - removableIds.length,
  };
}
