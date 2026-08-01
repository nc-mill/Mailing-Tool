import { sql } from 'drizzle-orm';
import { ApiError } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace, type Tx } from '../../tx';
import { writeAudit } from '../audit';
import { normalizeNameKey } from '../naming/normalize';
import type { Gender, NameOverrideLookup } from '../naming/types';

/**
 * Přepisy jmen na úrovni projektu. Jsou to jediná data, kterými modul oslovení sahá
 * mimo sebe, a jsou důvod, proč fronta kontroly konverguje k nule: bez nich by příští
 * import stejného jména vyhodil tutéž skupinu znovu.
 *
 * Klíč je VŽDY `normalizeNameKey(name)`, tedy bez diakritiky a malými písmeny. Kdyby se
 * ukládal syrový tvar, přepis pro "Tomáš" by netrefil kontakt zapsaný jako "Tomas",
 * přestože oba jsou v jedné skupině fronty.
 */

export type NameOverride = {
  id: string;
  kind: 'first' | 'last';
  name_key: string;
  gender: Gender | null;
  vocative: string | null;
  note: string | null;
  created_at: Date | string;
};

export async function listNameOverrides(
  ctx: WorkspaceContext,
  filter: {
    kind?: 'first' | 'last' | undefined;
    q?: string | undefined;
    limit?: number | undefined;
  },
): Promise<NameOverride[]> {
  const kind = filter.kind ?? null;
  const q = filter.q === undefined ? null : normalizeNameKey(filter.q);
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<NameOverride>(sql`
      SELECT id, kind, name_key, gender, vocative, note, created_at
        FROM name_overrides
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND (${kind}::text IS NULL OR kind = ${kind})
         AND (${q}::text IS NULL OR name_key LIKE ${q === null ? null : `%${q}%`})
       ORDER BY name_key ASC
       LIMIT ${filter.limit ?? 200}
    `);
    return rows;
  });
}

export type UpsertNameOverrideInput = {
  kind: 'first' | 'last';
  /** Jméno v libovolném tvaru. Klíč se z něj počítá tady, ne u volajícího. */
  name: string;
  gender?: Gender | null | undefined;
  vocative?: string | null | undefined;
  note?: string | null | undefined;
};

/**
 * Zápis přepisu ve stávající transakci.
 *
 * `ck_name_overrides__has_value` žádá `gender IS NOT NULL OR vocative IS NOT NULL`.
 * Přepis bez obou hodnot by shodil celou transakci na 23514, takže se odmítne dřív
 * a se srozumitelným kódem.
 */
export async function upsertNameOverrideIn(
  tx: Tx,
  ctx: WorkspaceContext,
  input: UpsertNameOverrideInput,
): Promise<string> {
  const gender = input.gender ?? null;
  const vocative = input.vocative ?? null;
  if (gender === null && vocative === null) {
    throw new ApiError('validation_failed', {
      errors: [
        {
          path: 'gender',
          code: 'required_field_missing',
          message: 'Přepis musí nést rod nebo vokativ, jinak nemá co přepsat.',
        },
      ],
    });
  }

  const nameKey = normalizeNameKey(input.name);
  const { rows } = await tx.execute<{ id: string }>(sql`
    INSERT INTO name_overrides (workspace_id, kind, name_key, gender, vocative, note, created_by)
    VALUES (${ctx.workspaceId}::uuid, ${input.kind}, ${nameKey}, ${gender}, ${vocative},
            ${input.note ?? null},
            ${ctx.actor.type === 'user' ? ctx.actor.userId : null}::uuid)
    ON CONFLICT (workspace_id, kind, name_key) DO UPDATE SET
      gender = coalesce(excluded.gender, name_overrides.gender),
      vocative = coalesce(excluded.vocative, name_overrides.vocative),
      note = coalesce(excluded.note, name_overrides.note)
    RETURNING id
  `);
  const id = rows[0]!.id;

  // POZOR: `audit_log.target_id` je sloupec typu `uuid`, ne text. Klíč jména
  // ("nikola") do něj zapsat nejde: skončí to na 22P02 a shodí celou transakci.
  // Ověřeno curlem proti běžící aplikaci, kde to vracelo 500. Do target_id jde
  // proto ID řádku přepisu a klíč jména do metadat, kde je stejně dohledatelný.
  await writeAudit(tx, ctx, {
    action: 'name_override.created',
    targetType: 'name_override',
    targetId: id,
    metadata: { kind: input.kind, name_key: nameKey, gender, vocative },
  });
  return id;
}

export async function upsertNameOverride(
  ctx: WorkspaceContext,
  input: UpsertNameOverrideInput,
): Promise<string> {
  return withWorkspace(ctx, async (tx) => upsertNameOverrideIn(tx, ctx, input));
}

export async function deleteNameOverride(
  ctx: WorkspaceContext,
  overrideId: string,
): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`
      DELETE FROM name_overrides
       WHERE id = ${overrideId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
      RETURNING id
    `);
    return rows.length > 0;
  });
}

/**
 * Přepisy projektu jako lookup pro `resolveName`. Načítají se najednou, protože zápis
 * kontaktu je nesmí dohledávat po jednom: u dávky pěti tisíc řádků by to bylo deset
 * tisíc dotazů.
 */
export async function loadNameOverrides(ctx: WorkspaceContext): Promise<NameOverrideLookup> {
  const rows = await withWorkspace(ctx, async (tx) => {
    const { rows: found } = await tx.execute<{
      kind: 'first' | 'last';
      name_key: string;
      gender: Gender | null;
      vocative: string | null;
    }>(sql`
      SELECT kind, name_key, gender, vocative FROM name_overrides
       WHERE workspace_id = ${ctx.workspaceId}::uuid
    `);
    return found;
  });

  const index = new Map<string, { gender?: Gender; vocative?: string }>();
  for (const row of rows) {
    index.set(`${row.kind}:${row.name_key}`, {
      ...(row.gender === null ? {} : { gender: row.gender }),
      ...(row.vocative === null ? {} : { vocative: row.vocative }),
    });
  }
  return { find: (kind, nameKey) => index.get(`${kind}:${nameKey}`) };
}
