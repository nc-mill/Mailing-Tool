/**
 * Předpočítaná čísla z campaign_stats. Uvnitř TypeScriptu camelCase,
 * převod na snake_case dělá až vrstva API (konvence 4.1 části 1).
 */
export type StatsCounts = {
  materialized: number;
  sent: number;
  skipped: number;
  failed: number;
  delivered: number;
  bouncedHard: number;
  bouncedSoft: number;
  complained: number;
  unsubscribed: number;
  opensTotal: number;
  opensUnique: number;
  opensUniqueHuman: number;
  opensUniqueApple: number;
  clicksTotal: number;
  clicksUnique: number;
  clicksUniqueHuman: number;
  clicksScanner: number;
};

export function emptyCounts(): StatsCounts {
  return {
    materialized: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    delivered: 0,
    bouncedHard: 0,
    bouncedSoft: 0,
    complained: 0,
    unsubscribed: 0,
    opensTotal: 0,
    opensUnique: 0,
    opensUniqueHuman: 0,
    opensUniqueApple: 0,
    clicksTotal: 0,
    clicksUnique: 0,
    clicksUniqueHuman: 0,
    clicksScanner: 0,
  };
}

/** Řádek campaign_stats přichází z pg jako bigint v řetězci, proto Number(). */
export function countsFromRow(row: Record<string, unknown> | undefined): StatsCounts {
  const n = (key: string): number => {
    const value = row?.[key];
    if (value === null || value === undefined) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    materialized: n('materialized'),
    sent: n('sent'),
    skipped: n('skipped'),
    failed: n('failed'),
    delivered: n('delivered'),
    bouncedHard: n('bounced_hard'),
    bouncedSoft: n('bounced_soft'),
    complained: n('complained'),
    unsubscribed: n('unsubscribed'),
    opensTotal: n('opens_total'),
    opensUnique: n('opens_unique'),
    opensUniqueHuman: n('opens_unique_human'),
    opensUniqueApple: n('opens_unique_apple'),
    clicksTotal: n('clicks_total'),
    clicksUnique: n('clicks_unique'),
    clicksUniqueHuman: n('clicks_unique_human'),
    clicksScanner: n('clicks_scanner'),
  };
}
