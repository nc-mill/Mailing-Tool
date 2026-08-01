import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace } from '../../tx';

export type VocativeReviewGroup = {
  name_key: string;
  kind: 'first' | 'last';
  gender: 'female' | 'male' | 'unknown';
  gender_source: string;
  suggested_vocative: string | null;
  contact_count: number;
  sample_surnames: string[];
  sample_contact_id: string;
  reasons: string[];
};

type GroupRow = {
  name_key: string;
  gender: 'female' | 'male' | 'unknown';
  gender_source: string;
  suggested_vocative: string | null;
  contact_count: number;
  sample_contact_id: string;
  sample_names: string[] | null;
};

/**
 * Fronta ke kontrole oslovení. Zobrazuje se VŽDY po skupinách, nikdy po jednotlivých
 * kontaktech: import tří tisíc kontaktů se stočtyřiceti nejistými vyrobí třicet
 * až šedesát skupin, ne sto čtyřicet řádků. Je to rozdíl mezi "proklikám to za dvě
 * minuty" a "na to nemám čas".
 *
 * Klíč skupiny je first_name_key, tedy sloupec plněný aplikací funkcí normalizeNameKey.
 * Kdyby se seskupovalo přes lower(first_name), "Tomáš" a "Tomas" by tvořily dvě skupiny
 * a ani jednu z nich by netrefil přepis, který je bez diakritiky. Viz kritérium 30.
 */
export async function listReviewGroups(
  ctx: WorkspaceContext,
  filter: {
    importId?: string | undefined;
    kind?: 'first' | 'last' | undefined;
    limit?: number | undefined;
  },
): Promise<VocativeReviewGroup[]> {
  const kind = filter.kind ?? 'first';
  // Dřívější znění mělo kind ve filtru i v operacích nad skupinou, ale ve výpisu
  // ho ignorovalo a do výsledku psalo natvrdo 'first'. Fronta by tedy u příjmení
  // nabídla skupiny křestních jmen a akce by dopadla na jiné kontakty, než jaké
  // uživatel viděl.
  const keyColumn = kind === 'first' ? sql`first_name_key` : sql`last_name_key`;
  const vocativeColumn = kind === 'first' ? sql`first_name_vocative` : sql`last_name_vocative`;
  const sampleColumn = kind === 'first' ? sql`last_name` : sql`first_name`;
  const importId = filter.importId ?? null;

  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<GroupRow>(sql`
      SELECT ${keyColumn} AS name_key, gender, gender_source,
             ${vocativeColumn} AS suggested_vocative,
             count(*)::int AS contact_count,
             -- NE min(id): PostgreSQL 18 nemá agregát min() nad uuid (přidává se až ve 20),
             -- dotaz by spadl na 42883 "function min(uuid) does not exist" a fronta by
             -- nefungovala vůbec. array_agg s řazením vrátí libovolný, ale deterministický
             -- vzorek a funguje na každé podporované verzi.
             (array_agg(id ORDER BY created_at DESC))[1] AS sample_contact_id,
             array_agg(DISTINCT ${sampleColumn}) FILTER (WHERE ${sampleColumn} IS NOT NULL)
               AS sample_names
        FROM contacts
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND vocative_confidence = 'low'
         AND vocative_locked = false
         AND deleted_at IS NULL
         AND status <> 'deleted'
         AND ${keyColumn} IS NOT NULL
         AND (${importId}::text IS NULL OR source_ref = ${importId})
       GROUP BY 1, 2, 3, 4
       ORDER BY contact_count DESC, name_key ASC
       LIMIT ${filter.limit ?? 50}
    `);

    return rows.map((row) => ({
      name_key: row.name_key,
      kind,
      gender: row.gender,
      gender_source: row.gender_source,
      suggested_vocative: row.suggested_vocative,
      contact_count: row.contact_count,
      // DISTINCT s ORDER BY nad jiným výrazem PostgreSQL nedovolí (42P10), takže se
      // vzorek řadí až tady. Je to nejvýš pár desítek hodnot na skupinu.
      sample_surnames: [...(row.sample_names ?? [])].sort((a, b) => a.localeCompare(b, 'cs')),
      sample_contact_id: row.sample_contact_id,
      reasons: deriveReasons(row),
    }));
  });
}

/**
 * Index `idx_contacts__ws_vocative_review` z P03 je nad `(workspace_id, first_name_key,
 * created_at DESC)` s predikátem `vocative_confidence = 'low' AND vocative_locked = false
 * AND deleted_at IS NULL`, tedy přesně nad větví `kind: 'first'`. Větev `kind: 'last'`
 * vlastní index nemá a projde kontakty projektu.
 *
 * Je to přijatelné, protože fronta podle příjmení je vedlejší cesta: výchozí pohled
 * i odznak v navigaci jdou přes křestní jméno a příjmení se řeší jen tam, kde se
 * nepodařilo určit rod z něj.
 */

/** Proč je skupina ve frontě. Rozhraní podle toho volí vysvětlující větu. */
function deriveReasons(row: { gender: string; gender_source: string }): string[] {
  const reasons: string[] = [];
  if (row.gender === 'unknown') reasons.push('gender_unknown');
  if (row.gender_source === 'library_heuristic') reasons.push('library_heuristic');
  if (row.gender_source === 'given_name_dict') reasons.push('ambiguous_given_name');
  return reasons;
}

/** Velikost skupiny. Rozhoduje o tom, jestli akce běží synchronně, nebo ve frontě. */
export async function countGroup(
  ctx: WorkspaceContext,
  nameKey: string,
  kind: 'first' | 'last',
): Promise<number> {
  const keyColumn = kind === 'first' ? sql`first_name_key` : sql`last_name_key`;
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM contacts
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND ${keyColumn} = ${nameKey}
         AND vocative_locked = false
         AND deleted_at IS NULL
    `);
    return rows[0]?.total ?? 0;
  });
}

/**
 * Počty pro odznak v navigaci a pro strop ruční práce z kritéria 42.
 * `ratio` je podíl nejistých kontaktů na všech živých, ne na těch ve frontě: strop
 * má hlídat, jestli je ruční práce přiměřená velikosti projektu.
 */
export async function countReviewTotals(
  ctx: WorkspaceContext,
  importId?: string | undefined,
): Promise<{ groups: number; contacts: number; ratio: number }> {
  const filterImport = importId ?? null;
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ groups: number; contacts: number; live: number }>(sql`
      WITH pending AS (
        SELECT first_name_key, count(*)::int AS n
          FROM contacts
         WHERE workspace_id = ${ctx.workspaceId}::uuid
           AND vocative_confidence = 'low'
           AND vocative_locked = false
           AND deleted_at IS NULL
           AND status <> 'deleted'
           AND first_name_key IS NOT NULL
           AND (${filterImport}::text IS NULL OR source_ref = ${filterImport})
         GROUP BY 1
      )
      SELECT (SELECT count(*)::int FROM pending) AS groups,
             (SELECT coalesce(sum(n), 0)::int FROM pending) AS contacts,
             (SELECT count(*)::int FROM contacts
               WHERE workspace_id = ${ctx.workspaceId}::uuid
                 AND deleted_at IS NULL AND status <> 'deleted') AS live
    `);
    const row = rows[0];
    if (row === undefined) return { groups: 0, contacts: 0, ratio: 0 };
    return {
      groups: row.groups,
      contacts: row.contacts,
      // Dělení nulou dá v JavaScriptu NaN, a NaN prošlé do JSON je null, takže by
      // se strop u prázdného projektu vyhodnotil jako false a nikdo by to nepoznal.
      ratio: row.live === 0 ? 0 : row.contacts / row.live,
    };
  });
}
