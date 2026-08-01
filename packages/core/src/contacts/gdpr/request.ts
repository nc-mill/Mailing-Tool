export const GDPR_REQUEST_TYPES = [
  'access',
  'portability',
  'erasure',
  'rectification',
  'restriction',
  'objection',
] as const;

export type GdprRequestType = (typeof GDPR_REQUEST_TYPES)[number];

export type GdprRequestStatus =
  'received' | 'verifying' | 'processing' | 'completed' | 'rejected' | 'failed';

/**
 * Lhůta pro vyřízení je podle článku 12 odst. 3 JEDEN MĚSÍC od doručení žádosti.
 * Ověřeno proti textu nařízení.
 *
 * Počítá se kalendářně, ne jako třicet dní: žádost podaná 31. ledna má lhůtu
 * do 28. února (nebo 29. v přestupném roce), ne do 2. března.
 */
export function computeDueAt(requestedAt: Date): Date {
  return addMonths(requestedAt, 1);
}

/**
 * Prodloužení je o DALŠÍ DVA MĚSÍCE, tedy celkem tři od podání. O prodloužení
 * a jeho důvodech musí být subjekt informován do jednoho měsíce od doručení.
 */
export function computeExtendedUntil(dueAt: Date): Date {
  return addMonths(dueAt, 2);
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const targetMonth = result.getUTCMonth() + months;
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(targetMonth);
  // Poslední den cílového měsíce, když v něm původní den neexistuje (31. leden na únor).
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function isOverdue(request: {
  dueAt: Date;
  extendedUntil: Date | null;
  status: GdprRequestStatus;
}): boolean {
  if (request.status === 'completed' || request.status === 'rejected') return false;
  return (request.extendedUntil ?? request.dueAt) < new Date();
}

const ALLOWED_TRANSITIONS: Record<GdprRequestStatus, readonly GdprRequestStatus[]> = {
  received: ['verifying', 'processing', 'rejected', 'failed'],
  verifying: ['processing', 'rejected', 'failed'],
  processing: ['completed', 'rejected', 'failed'],
  completed: [],
  rejected: [],
  failed: ['processing', 'rejected'],
};

export function canTransition(from: GdprRequestStatus, to: GdprRequestStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Kolik dní zbývá do lhůty. Rozhraní pod pěti dny zobrazuje červeně. */
export function daysRemaining(request: { dueAt: Date; extendedUntil: Date | null }): number {
  const deadline = request.extendedUntil ?? request.dueAt;
  return Math.ceil((deadline.getTime() - Date.now()) / 86400000);
}
