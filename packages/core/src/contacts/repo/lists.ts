import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { lists } from '@mlain/db/schema';
import { ApiError } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';
import { pgErrorCode, withWorkspace, type Tx } from '../../tx';
import { writeAudit } from '../audit';
import { contactExistsForJoinSql } from '../existence';
import {
  DEFAULT_CONFIRMATION_MAX_RESENDS,
  DEFAULT_CONFIRMATION_MODE,
  DEFAULT_CONFIRMATION_TTL_HOURS,
} from '../constants';

export type ListRow = typeof lists.$inferSelect;

export type CreateListInput = {
  name: string;
  description?: string | null;
  optIn?: 'single' | 'double';
  confirmationMode?: 'one_step' | 'two_step';
  confirmationTtlHours?: number;
  confirmationMaxResends?: number;
  confirmationTemplateId?: string | null;
  welcomeTemplateId?: string | null;
  /** Rozloučení po odhlášení. `NULL` znamená obecné znění, viz `default-emails.ts`. */
  goodbyeTemplateId?: string | null;
  sendWelcome?: boolean;
  /** Výchozí NE, rozhodnutí zadavatele z 5. 8. 2026. */
  sendGoodbye?: boolean;
  /** Kam po potvrzení a po odhlášení. `NULL` znamená „zůstane naše stránka". */
  confirmRedirectUrl?: string | null;
  unsubscribeRedirectUrl?: string | null;
  isDefault?: boolean;
  /** Nabízet ve veřejném centru předvoleb k přihlášení? Výchozí je NE, viz migrace 0014. */
  publicVisible?: boolean;
  /** Jméno pro příjemce. null znamená „nenapsáno", pak se ukáže `name`. */
  publicName?: string | null;
  publicDescription?: string | null;
};

export type UpdateListInput = Partial<Omit<CreateListInput, 'isDefault'>>;

export type ListStats = {
  pending: number;
  confirmed: number;
  unsubscribed: number;
  bounced: number;
  complained: number;
  total: number;
};

/** Název omezení, které hlídá jedinečnost jména seznamu v projektu. */
const NAME_CONSTRAINT = 'uq_lists__workspace_name';

/**
 * Prázdný veřejný text je „nevyplněno", ne prázdné jméno.
 *
 * Formulář posílá u nevyplněného pole prázdný řetězec, ale `ck_lists__public_name_len`
 * a `ck_lists__public_description_len` ho zakazují, protože by to byl třetí stav vedle
 * NULL a vyplněné hodnoty. Bez tohohle překladu by uložení nastavení s prázdným polem
 * skončilo pětistovkou na 23514.
 */
function emptyToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Přeloží porušení částečného unikátního indexu na doménovou chybu.
 * Odchytává se konkrétní omezení, ne každé 23505: kdyby se přidal další unikátní index,
 * tichý překlad na "jméno je obsazené" by poslal uživatele hledat problém úplně jinam.
 *
 * ODCHYLKA OD PLÁNU. Plán házel `new ApiError('list_name_taken')`. Kód `list_name_taken`
 * je registrovaný v `CONTACTS_ERROR_CODES` téhle domény, ale `ApiError` přijímá jen kódy
 * z registru P01 (`packages/core/src/errors/problem-codes.ts`), který ho nezná a jehož
 * soubor tenhle plán nevlastní. Neregistrovaný kód by konstruktor odmítl obyčejným
 * `Error`, takže by se uživateli místo 409 vrátila pětistovka. Vrací se proto platformní
 * kód `already_exists` s doménovou příčinou v `params.detail`, což je tvar, který plán
 * používá i u ostatních doménových chyb (`field_limit_reached`, `field_type_immutable`).
 */
function rethrowUniqueViolation(error: unknown): never {
  // POZOR NA TVAR CHYBY. drizzle-orm balí chybu ovladače do DrizzleQueryError, takže
  // `error.code` je undefined a SQLSTATE leží na `error.cause.code`.
  const code = pgErrorCode(error);
  const constraint = pgErrorField(error, 'constraint');
  if (code === '23505' && constraint === NAME_CONSTRAINT) {
    throw new ApiError('already_exists', { params: { detail: 'list_name_taken' }, cause: error });
  }
  throw error;
}

/**
 * Vytáhne pojmenované pole z chyby ovladače stejným průchodem řetězu `cause`,
 * jakým ho hledá `pgErrorCode`. Jméno porušeného omezení nese `constraint`.
 */
function pgErrorField(
  error: unknown,
  field: 'constraint' | 'table' | 'detail',
): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth += 1) {
    const value = (current as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export async function create(ctx: WorkspaceContext, input: CreateListInput): Promise<ListRow> {
  return withWorkspace(ctx, async (tx) => {
    // Výchozí seznam se přehazuje před vložením, protože částečný unikátní index
    // uq_lists__workspace_default nedovolí ani okamžik se dvěma výchozími seznamy.
    if (input.isDefault === true) await clearDefault(tx, ctx);

    const rows = await tx
      .insert(lists)
      .values({
        workspaceId: ctx.workspaceId,
        name: input.name,
        description: input.description ?? null,
        optIn: input.optIn ?? 'double',
        // Doménová výchozí hodnota je 'one_step' (rozhodnutí R2 plánu). Hodnota v DDL je
        // 'two_step' a je to pojistka pro zápis mimo doménovou vrstvu, ne rozpor.
        confirmationMode: input.confirmationMode ?? DEFAULT_CONFIRMATION_MODE,
        confirmationTtlHours: input.confirmationTtlHours ?? DEFAULT_CONFIRMATION_TTL_HOURS,
        confirmationMaxResends: input.confirmationMaxResends ?? DEFAULT_CONFIRMATION_MAX_RESENDS,
        confirmationTemplateId: input.confirmationTemplateId ?? null,
        welcomeTemplateId: input.welcomeTemplateId ?? null,
        goodbyeTemplateId: input.goodbyeTemplateId ?? null,
        sendWelcome: input.sendWelcome ?? false,
        sendGoodbye: input.sendGoodbye ?? false,
        confirmRedirectUrl: emptyToNull(input.confirmRedirectUrl) ?? null,
        unsubscribeRedirectUrl: emptyToNull(input.unsubscribeRedirectUrl) ?? null,
        isDefault: input.isDefault ?? false,
        // Bezpečná výchozí hodnota: nový seznam se veřejně NENABÍZÍ, dokud to
        // správce nezapne. Zdůvodnění je v migraci 0014.
        publicVisible: input.publicVisible ?? false,
        publicName: emptyToNull(input.publicName),
        publicDescription: emptyToNull(input.publicDescription),
      })
      .returning()
      .catch(rethrowUniqueViolation);

    const row = rows[0]!;
    await writeAudit(tx, ctx, {
      action: 'list.created',
      targetType: 'list',
      targetId: row.id,
      metadata: { name: row.name, opt_in: row.optIn, confirmation_mode: row.confirmationMode },
    });
    return row;
  });
}

export async function byId(
  ctx: WorkspaceContext,
  id: string,
  options: { includeArchived?: boolean } = {},
): Promise<ListRow | null> {
  return withWorkspace(ctx, async (tx) => {
    const rows = await tx
      .select()
      .from(lists)
      .where(
        and(
          eq(lists.workspaceId, ctx.workspaceId),
          eq(lists.id, id),
          options.includeArchived === true ? undefined : isNull(lists.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  });
}

/**
 * Režim potvrzení u vyjmenovaných seznamů, jedním dotazem, uvnitř otevřené transakce.
 *
 * Import podle něj rozhoduje o stavu přihlášení: na single opt-in seznamu končí nový
 * kontakt rovnou v `confirmed`, na double opt-in v `pending`, pokud uživatel nedoloží
 * prohlášení. Bez tohohle dotazu by import musel opt-in hádat, a hádat se tady nesmí.
 *
 * Archivované seznamy se vynechávají: přihlašovat do zrušeného seznamu nedává smysl
 * a volající pozná podle chybějícího klíče, že se do něj přihlašovat nemá.
 */
export async function optInByIdsIn(
  tx: Tx,
  ctx: WorkspaceContext,
  ids: readonly string[],
): Promise<Map<string, 'single' | 'double'>> {
  const out = new Map<string, 'single' | 'double'>();
  if (ids.length === 0) return out;
  const rows = await tx
    .select({ id: lists.id, optIn: lists.optIn })
    .from(lists)
    .where(
      and(
        eq(lists.workspaceId, ctx.workspaceId),
        isNull(lists.deletedAt),
        sql`${lists.id} = ANY(${sql.param([...new Set(ids)])}::uuid[])`,
      ),
    );
  for (const row of rows) out.set(row.id, row.optIn);
  return out;
}

export async function list(
  ctx: WorkspaceContext,
  options: { includeArchived?: boolean } = {},
): Promise<ListRow[]> {
  return withWorkspace(ctx, async (tx) =>
    tx
      .select()
      .from(lists)
      .where(
        and(
          eq(lists.workspaceId, ctx.workspaceId),
          options.includeArchived === true ? undefined : isNull(lists.deletedAt),
        ),
      )
      .orderBy(asc(lists.name)),
  );
}

export async function update(
  ctx: WorkspaceContext,
  id: string,
  patch: UpdateListInput,
): Promise<ListRow> {
  return withWorkspace(ctx, async (tx) => {
    const current = await requireLive(tx, ctx, id);

    const rows = await tx
      .update(lists)
      .set({
        ...patch,
        // Prázdný řetězec z formuláře je „nevyplněno", ne prázdné jméno; omezení
        // v databázi ho zakazuje, viz `emptyToNull`.
        ...(patch.publicName === undefined ? {} : { publicName: emptyToNull(patch.publicName) }),
        ...(patch.publicDescription === undefined
          ? {}
          : { publicDescription: emptyToNull(patch.publicDescription) }),
        // Prázdné pole na obrazovce znamená „žádné přesměrování", ne prázdná
        // adresa: `ck_lists__confirm_redirect_url_len` prázdný řetězec zakazuje
        // a uložení by skončilo pětistovkou na 23514.
        ...(patch.confirmRedirectUrl === undefined
          ? {}
          : { confirmRedirectUrl: emptyToNull(patch.confirmRedirectUrl) }),
        ...(patch.unsubscribeRedirectUrl === undefined
          ? {}
          : { unsubscribeRedirectUrl: emptyToNull(patch.unsubscribeRedirectUrl) }),
        updatedAt: new Date(),
      })
      .where(and(eq(lists.workspaceId, ctx.workspaceId), eq(lists.id, id)))
      .returning()
      .catch(rethrowUniqueViolation);

    const row = rows[0]!;

    // Zapnutí veřejného nabízení je rozhodnutí o tom, kdo se smí sám přihlásit,
    // takže musí být dohledatelné stejně jako změna opt-in.
    if (patch.publicVisible !== undefined && patch.publicVisible !== current.publicVisible) {
      await writeAudit(tx, ctx, {
        action: 'list.public_visibility_changed',
        targetType: 'list',
        targetId: id,
        metadata: { from: current.publicVisible, to: patch.publicVisible },
      });
    }

    // Změna opt_in je změna úrovně ochrany příjemců, takže musí být dohledatelná i za rok.
    // Ostatní pole se do auditu nepíšou, jinak by v logu utonulo přejmenování seznamu.
    if (patch.optIn !== undefined && patch.optIn !== current.optIn) {
      await writeAudit(tx, ctx, {
        action: 'list.opt_in_changed',
        targetType: 'list',
        targetId: id,
        metadata: { from: current.optIn, to: patch.optIn },
      });
    }
    return row;
  });
}

export async function archive(ctx: WorkspaceContext, id: string): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await requireLive(tx, ctx, id);
    await tx
      .update(lists)
      // is_default se shazuje spolu s archivací. Archivovaný výchozí seznam by dál chytal
      // každé přihlášení z formuláře, který seznam neuvádí, a nikdo by to nehledal tady.
      .set({ deletedAt: new Date(), isDefault: false, updatedAt: new Date() })
      .where(and(eq(lists.workspaceId, ctx.workspaceId), eq(lists.id, id)));

    await writeAudit(tx, ctx, {
      action: 'list.archived',
      targetType: 'list',
      targetId: id,
      metadata: {},
    });
  });
}

export async function setDefault(ctx: WorkspaceContext, id: string): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await requireLive(tx, ctx, id);
    // Pořadí je závazné: nejdřív shodit starý, teprve pak nastavit nový. Opačné pořadí
    // spadne na 23505 nad uq_lists__workspace_default, protože index je nedeferrable.
    await clearDefault(tx, ctx);
    await tx
      .update(lists)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(lists.workspaceId, ctx.workspaceId), eq(lists.id, id)));

    await writeAudit(tx, ctx, {
      action: 'list.default_changed',
      targetType: 'list',
      targetId: id,
      metadata: {},
    });
  });
}

export async function getDefault(ctx: WorkspaceContext): Promise<ListRow | null> {
  return withWorkspace(ctx, async (tx) => {
    const rows = await tx
      .select()
      .from(lists)
      .where(
        and(
          eq(lists.workspaceId, ctx.workspaceId),
          eq(lists.isDefault, true),
          isNull(lists.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  });
}

/**
 * Počty přihlášení podle stavu. Počítá LIDI, ne řádky vazby.
 *
 * Smazaný kontakt si přihlášení nechává, protože měkké smazání se do třiceti dnů
 * vrací a obnovený člověk musí dostat zpět svá členství. Počítadlo se proto musí
 * zeptat, jestli kontakt ještě existuje; bez toho hlásilo „50 potvrzených kontaktů"
 * projektu, ve kterém zbyly tři, a číslo se nespravilo ani po úklidu, protože žádný
 * úklid neběžel.
 *
 * Odhlášené a zablokované to NEODEČÍTÁ. Ti lidé existují a jejich stav je ochrana
 * příjemce, kterou musí být na obrazovce vidět; proto mají v `ListStats` vlastní klíč.
 */
export async function stats(ctx: WorkspaceContext, listId: string): Promise<ListStats> {
  return withWorkspace(ctx, async (tx) => {
    // Ručně psané SQL, ne query builder: predikát existence kontaktu je sdílený text
    // s vlastním aliasem a builder by ho musel skládat přes `sql.raw` proti aliasu,
    // který si sám odvozuje z názvu tabulky. Vlastní alias `s` je čitelnější a nemůže
    // se rozejít s tím, co builder zrovna vygeneruje.
    const { rows } = await tx.execute<{ status: string; total: number }>(sql`
      SELECT s.status, count(*)::int AS total
        FROM list_subscriptions s
       WHERE s.workspace_id = ${ctx.workspaceId}::uuid
         AND s.list_id = ${listId}::uuid
         AND ${sql.raw(contactExistsForJoinSql('s'))}
       GROUP BY s.status
    `);

    // Chybějící stav se vrací jako nula, ne jako chybějící klíč. UI jinak musí řešit
    // undefined na pěti místech a jednou to zapomene.
    const result: ListStats = {
      pending: 0,
      confirmed: 0,
      unsubscribed: 0,
      bounced: 0,
      complained: 0,
      total: 0,
    };
    for (const row of rows) {
      result[row.status as keyof Omit<ListStats, 'total'>] = Number(row.total);
      result.total += Number(row.total);
    }
    return result;
  });
}

/**
 * Kolik LIDÍ ve vyjmenovaných seznamech čeká na potvrzení. Počítá se přes DISTINCT,
 * protože jeden člověk může čekat ve dvou seznamech a dvakrát započítaný by z hlášky
 * udělal další nepravdivé číslo.
 *
 * K čemu to je: publikum kampaně bere ze seznamu jen potvrzené. Když jsou všichni
 * ve stavu `pending`, vyjde nula a kontrolní seznam před odesláním hlásil „publikum
 * je prázdné", což u seznamu se třemi lidmi není pravda. Tohle číslo dovolí říct,
 * co se doopravdy stalo a co s tím uživatel udělá.
 */
export async function countPendingMembers(
  ctx: WorkspaceContext,
  listIds: readonly string[],
): Promise<number> {
  if (listIds.length === 0) return 0;
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ total: number }>(sql`
      SELECT count(DISTINCT s.contact_id)::int AS total
        FROM list_subscriptions s
       WHERE s.workspace_id = ${ctx.workspaceId}::uuid
         AND s.list_id = ANY(${sql.param([...new Set(listIds)])}::uuid[])
         AND s.status = 'pending'
         AND ${sql.raw(contactExistsForJoinSql('s'))}
    `);
    return rows[0]?.total ?? 0;
  });
}

async function clearDefault(tx: Tx, ctx: WorkspaceContext): Promise<void> {
  await tx
    .update(lists)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(lists.workspaceId, ctx.workspaceId),
        eq(lists.isDefault, true),
        isNull(lists.deletedAt),
      ),
    );
}

async function requireLive(tx: Tx, ctx: WorkspaceContext, id: string): Promise<ListRow> {
  const rows = await tx
    .select()
    .from(lists)
    .where(and(eq(lists.workspaceId, ctx.workspaceId), eq(lists.id, id), isNull(lists.deletedAt)))
    .limit(1);
  if (rows[0] === undefined) throw new ApiError('not_found');
  return rows[0];
}

/** Existuje v projektu seznam s tímhle jménem? Používá průvodce importem a formuláře. */
export async function nameTaken(ctx: WorkspaceContext, name: string): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    const rows = await tx
      .select({ one: sql<number>`1` })
      .from(lists)
      .where(
        and(
          eq(lists.workspaceId, ctx.workspaceId),
          sql`lower(${lists.name}) = lower(${name})`,
          isNull(lists.deletedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  });
}
