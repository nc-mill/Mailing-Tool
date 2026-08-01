import type { TimelineRow } from './types';

/**
 * Trojcestné (a víc) slévání už seřazených větví. Dělá se v aplikaci schválně:
 * UNION ALL s ORDER BY v jednom SQL by Postgres přinutil seřadit celý
 * mezivýsledek, kdežto každá větev je seřazená svým indexem.
 */
export function mergeSortedBranches(branches: TimelineRow[][], limit: number): TimelineRow[] {
  const cursors = branches.map(() => 0);
  const result: TimelineRow[] = [];

  while (result.length < limit) {
    let bestBranch = -1;
    let best: TimelineRow | undefined;

    for (let i = 0; i < branches.length; i += 1) {
      const candidate = branches[i]?.[cursors[i] ?? 0];
      if (!candidate) continue;
      if (!best || isNewer(candidate, best)) {
        best = candidate;
        bestBranch = i;
      }
    }

    if (!best || bestBranch < 0) break;
    cursors[bestBranch] = (cursors[bestBranch] ?? 0) + 1;
    result.push(best);
  }

  return result;
}

function isNewer(a: TimelineRow, b: TimelineRow): boolean {
  const diff = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (diff !== 0) return diff > 0;
  return a.id > b.id;
}
