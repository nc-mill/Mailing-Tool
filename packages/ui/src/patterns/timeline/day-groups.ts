import type { DayGroup, TimelineItem } from './types';

/** Klíč dne ve tvaru YYYY-MM-DD **v zadané zóně**, ne v UTC. */
function dayKey(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
  return parts;
}

function shiftDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Oddělovače dnů se počítají v časové zóně uživatele.
 * Událost ve 23:30 UTC je v Praze už další den a uživatel to tak vidí.
 */
export function groupByDay(
  items: TimelineItem[],
  { timeZone, now = new Date() }: { timeZone: string; now?: Date },
): DayGroup[] {
  const todayKey = dayKey(now, timeZone);
  const yesterdayKey = dayKey(shiftDays(now, -1), timeZone);

  const groups = new Map<string, DayGroup>();
  for (const item of items) {
    const key = dayKey(item.occurredAt, timeZone);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(key, {
      key,
      label: key === todayKey ? 'today' : key === yesterdayKey ? 'yesterday' : 'date',
      date: item.occurredAt,
      items: [item],
    });
  }

  return [...groups.values()];
}
