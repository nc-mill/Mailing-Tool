import { sql } from 'drizzle-orm';
import type { Tx, WorkspaceContext } from '../../tx';
import { loadConfig, type MlainConfig } from '../../config/index';
import { decodeCursor, encodeCursor } from '../cursor';
import { dependencyTimeout, notFound, timelineWindowTooLarge } from '../errors';
import { contactBranch, messageBranch, messageEventBranch, webEventBranch } from './branches';
import { mergeSortedBranches } from './merge';
import { MAX_MONTHS_PER_REQUEST, pickWindow } from './months';
import { composeTitle, type Gender, type Translate } from './titles';
import { TIMELINE_ORDER, type TimelineFilter, type TimelineItem, type TimelineRow } from './types';

/** Výchozí rozsah je posledních dvanáct měsíců, dál se jde tlačítkem "načíst starší". */
const DEFAULT_SCOPE_MONTHS = 12;

/** Kolik oken smí jeden požadavek projít, než vrátí i prázdnou stránku. */
const MAX_WINDOWS_PER_REQUEST = 4;

/** Rozpočet z 7.2 části 5. Přes něj se vrací dependency_timeout, ne prázdno. */
const QUERY_BUDGET_MS = 3000;

/**
 * ODCHYLKA OD PLÁNU: plán psal `import { config } from '@mlain/core/config'`.
 * P01 žádný takový singleton neexportuje, vystavuje jen `loadConfig()`.
 * Konfigurace se proto čte líně a jednou, stejně jako v `src/tx/index.ts`.
 * Modul, který si ji načte při importu, nejde naimportovat bez kompletního
 * prostředí a shodil by každý jednotkový test, který se ho jen dotkne.
 */
let configSingleton: MlainConfig | null = null;

function retentionMonths(): number {
  configSingleton ??= loadConfig();
  return configSingleton.TRACKING_RETENTION_MONTHS;
}

export type TimelinePage = {
  items: TimelineItem[];
  /**
   * Rod kontaktu. Věty ze slotů na něm stojí (13.1) a klient kontakt sám
   * nečte, takže bez něj by osa v UI skládala věty v neutrálním tvaru,
   * ačkoliv server rod zná.
   */
  gender: Gender;
  hasMore: boolean;
  nextCursor: string | null;
};

export type TimelineInput = {
  contactId: string;
  limit: number;
  translate: Translate;
  cursor?: string;
  types?: TimelineFilter[];
  from?: Date;
  to?: Date;
  now?: Date;
};

export async function readContactTimeline(
  tx: Tx,
  ctx: WorkspaceContext,
  input: TimelineInput,
): Promise<TimelinePage> {
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(input.limit, 1), 200);

  const { rows: contactRows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT id, gender FROM contacts
     WHERE workspace_id = ${ctx.workspaceId} AND id = ${input.contactId}
  `);
  const contact = contactRows[0];
  if (!contact) throw notFound('contact');
  const gender = normalizeGender(contact['gender']);

  const scopeEnd = input.to ?? now;
  const scopeStart =
    input.from ??
    new Date(Date.UTC(scopeEnd.getUTCFullYear(), scopeEnd.getUTCMonth() - DEFAULT_SCOPE_MONTHS, 1));

  if (input.from && input.to && monthsBetween(input.from, input.to) > MAX_MONTHS_PER_REQUEST) {
    throw timelineWindowTooLarge();
  }

  const before = input.cursor ? cursorToPosition(input.cursor) : null;
  const wanted = input.types ?? null;

  const startedAt = Date.now();
  let windowTo = before ? before.occurredAt : scopeEnd;
  const collected: TimelineRow[] = [];

  for (let round = 0; round < MAX_WINDOWS_PER_REQUEST; round += 1) {
    if (windowTo <= scopeStart) break;
    if (Date.now() - startedAt > QUERY_BUDGET_MS) throw dependencyTimeout();

    const window = pickWindow(windowTo, scopeStart, retentionMonths());
    const branchInput = {
      contactId: input.contactId,
      window,
      limit: limit + 1,
      ...(before === null ? {} : { before }),
    };

    const branches = await Promise.all([
      enabled(wanted, 'email') ? messageBranch(tx, ctx, branchInput) : Promise.resolve([]),
      enabled(wanted, 'email') ? messageEventBranch(tx, ctx, branchInput) : Promise.resolve([]),
      enabled(wanted, 'web') ? webEventBranch(tx, ctx, branchInput) : Promise.resolve([]),
      enabled(wanted, 'contact') || enabled(wanted, 'consent')
        ? contactBranch(tx, ctx, branchInput)
        : Promise.resolve([]),
    ]);

    const filtered = branches.map((rows) =>
      rows.filter((row) =>
        wanted === null ? true : wanted.includes(row.source as TimelineFilter),
      ),
    );

    collected.push(...mergeSortedBranches(filtered, limit + 1 - collected.length));
    if (collected.length > limit) break;
    windowTo = window.from;
  }

  const hasMore = collected.length > limit;
  const page = collected.slice(0, limit);
  const last = page[page.length - 1];

  return {
    items: page.map((row) => toItem(row, input.translate, gender)),
    gender,
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeCursor({ k: [last.occurredAt.toISOString(), last.id], d: 'n', o: TIMELINE_ORDER })
        : null,
  };
}

function enabled(wanted: TimelineFilter[] | null, source: TimelineFilter): boolean {
  return wanted === null || wanted.includes(source);
}

function cursorToPosition(raw: string): { occurredAt: Date; id: string } {
  const cursor = decodeCursor(raw, TIMELINE_ORDER);
  return { occurredAt: new Date(cursor.k[0] ?? ''), id: cursor.k[1] ?? '' };
}

function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) + 1
  );
}

function normalizeGender(value: unknown): Gender {
  return value === 'female' || value === 'male' ? value : 'unknown';
}

function toItem(row: TimelineRow, translate: Translate, gender: Gender): TimelineItem {
  return {
    id: row.id,
    occurred_at: row.occurredAt.toISOString(),
    source: row.source,
    type: row.type,
    title: composeTitle(translate, row, gender),
    ...(row.detail ? { detail: row.detail } : {}),
    ...(row.campaign ? { campaign: row.campaign } : {}),
    ...(row.sessionId ? { session_id: row.sessionId } : {}),
    ...(row.reliability ? { reliability: row.reliability } : {}),
  };
}
