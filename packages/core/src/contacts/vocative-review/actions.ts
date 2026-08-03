import { sql } from 'drizzle-orm';
import { ApiError } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace, type Tx } from '../../tx';
import { writeAudit } from '../audit';
import { VOCATIVE_REVIEW_SYNC_LIMIT } from '../constants';
import { enqueue } from '../jobs/enqueue';
import { buildGreeting } from '../naming/greeting';
import { resolveName } from '../naming/resolve';
import type { Gender } from '../naming/types';
import { EMPTY_OVERRIDES } from '../naming/types';
import { upsertNameOverrideIn } from '../repo/name-overrides';
import { countGroup } from '../repo/vocative-review';
import { readContactsSettings } from '../settings';

/**
 * Čtyři operace nad skupinou. Akce `defer` mezi nimi SCHVÁLNĚ NENÍ: podle rozhodnutí R15
 * je odložení volba zobrazení jednoho uživatele a žije v prohlížeči, ne na serveru.
 * Dřívější znění pro ni volalo `deferGroupForUser`, funkci bez implementace a bez
 * úložiště: `users` nemá `settings`, `memberships` má čtyři sloupce a tabulka
 * uživatelských předvoleb v projektu neexistuje. Akce by byla no-op.
 */
export type GroupAction = 'confirm' | 'set_vocative' | 'set_gender' | 'no_name';

export type GroupActionInput = {
  nameKey: string;
  kind: 'first' | 'last';
  action: GroupAction;
  vocative?: string | undefined;
  gender?: Gender | undefined;
  /**
   * Ve výchozím stavu ZAŠKRTNUTÉ. Bez přepisů konverguje fronta k nule jen náhodou:
   * příští import stejného jména by ho vyhodil znovu.
   */
  saveOverride: boolean;
};

/**
 * Hodnoty, které se u dané akce zapíšou do name_overrides.
 *
 * `ck_name_overrides__has_value` žádá `gender IS NOT NULL OR vocative IS NOT NULL`.
 * Dřívější znění posílalo do INSERTu `input.gender ?? null` a `input.vocative ?? null`,
 * jenže u akcí `confirm` a `no_name` se neplní ani jedno. Nejčastější akce celé fronty,
 * tedy "Potvrdit návrh", by proto padala na `23514` a s ní celá transakce, takže by se
 * nezamkl ani vokativ. Padalo tím přímo akceptační kritérium 24.
 */
export function overrideValuesFor(
  input: GroupActionInput,
  group: { gender: Gender; suggestedVocative: string | null },
): { gender: Gender | null; vocative: string | null } {
  switch (input.action) {
    case 'confirm':
      // Potvrzuje se to, co fronta nabídla: rod skupiny a navržený vokativ.
      return { gender: group.gender, vocative: group.suggestedVocative };
    case 'set_vocative':
      return { gender: group.gender, vocative: input.vocative ?? null };
    case 'set_gender':
      return { gender: input.gender ?? 'unknown', vocative: null };
    case 'no_name':
      // "Tohle není jméno" (typicky "Info", "Objednávky", "Recepce"). Prázdný řetězec
      // je nositelná hodnota, takže CHECK projde, a modul oslovení ho čte jako
      // "neoslovovat jménem", tedy neutrální pozdrav. Rod se zároveň fixuje na unknown,
      // aby ho příští zápis nezkoušel uhodnout znovu.
      return { gender: 'unknown', vocative: '' };
  }
}

type MemberRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  gender: Gender;
  first_name_vocative: string | null;
  last_name_vocative: string | null;
  locale: string;
};

/**
 * Kontrola vstupu, kterou musí projít OBĚ cesty, tedy synchronní i ta přes frontu.
 *
 * Je to samostatná funkce, protože job `contacts.bulk_vocative_review` je druhý
 * vstupní bod téhle operace a náklad úlohy může být starší než dnešní podoba
 * rozhraní. Prázdný vokativ by u akce `set_vocative` zamkl celé skupině prázdnou
 * hodnotu, a to je přesně ten tichý zásah do oslovení, kterému se celá doména
 * vyhýbá.
 */
export function assertGroupActionInput(input: GroupActionInput): void {
  if (input.action === 'set_vocative' && (input.vocative ?? '').trim() === '') {
    throw new ApiError('validation_failed', {
      errors: [
        { path: 'vocative', code: 'required_field_missing', message: 'Vokativ nesmí být prázdný.' },
      ],
    });
  }
}

/**
 * Operace nad celou skupinou fronty. Do pěti tisíc kontaktů běží synchronně v jedné
 * transakci, nad ně se zařadí job s ukazatelem průběhu.
 */
export async function applyGroupAction(
  ctx: WorkspaceContext,
  input: GroupActionInput,
): Promise<{ mode: 'sync' | 'queued'; affected: number }> {
  assertGroupActionInput(input);

  const size = await countGroup(ctx, input.nameKey, input.kind);

  if (size > VOCATIVE_REVIEW_SYNC_LIMIT) {
    await enqueueJobDetached(ctx, input, size);
    return { mode: 'queued', affected: size };
  }

  const affected = await applyGroupActionBatch(ctx, input, VOCATIVE_REVIEW_SYNC_LIMIT);
  return { mode: 'sync', affected };
}

/**
 * JEDNA dávka skupiny v JEDNÉ transakci. Vrací počet dotčených kontaktů.
 *
 * Vzniklo rozdělením `applyGroupAction`, ne opsáním: velké skupiny vyřizuje job
 * `contacts.bulk_vocative_review` a ten potřebuje TUTÉŽ logiku po dávkách. Druhá
 * kopie by se v tichosti rozešla přesně v těch místech, na kterých tahle funkce
 * stojí (přepočet vokativu po řádcích u `set_gender`, přepočet oslovení v téže
 * transakci, zápis přepisu jména).
 *
 * VOLAT PŘÍMO SMÍ JEN JOB. Cesta z rozhraní jde přes `applyGroupAction`, protože
 * ta zároveň rozhoduje, jestli se operace vejde do jedné transakce. Job naopak
 * `applyGroupAction` volat NESMÍ: nad pěti tisíci by si sám sebe zařadil znovu
 * a fronta by se plnila donekonečna.
 *
 * Ukončení cyklu drží samotný zápis: dávka nastaví dotčeným řádkům
 * `vocative_locked = true` a výběr bere jen `vocative_locked = false`, takže
 * příští dávka dostane jiné řádky a nakonec žádné.
 */
export async function applyGroupActionBatch(
  ctx: WorkspaceContext,
  input: GroupActionInput,
  limit: number,
): Promise<number> {
  return withWorkspace(ctx, async (tx) => {
    const column = input.kind === 'first' ? sql`first_name_vocative` : sql`last_name_vocative`;
    const keyColumn = input.kind === 'first' ? sql`first_name_key` : sql`last_name_key`;

    // Řádky skupiny se čtou a ZAMYKAJÍ dřív, než se cokoli změní. Bez FOR UPDATE by
    // dva editoři nad toutéž skupinou zapsali každý svůj vokativ a poslední by vyhrál
    // jen u části kontaktů.
    const { rows: members } = await tx.execute<MemberRow>(sql`
      SELECT id, first_name, last_name, gender, first_name_vocative, last_name_vocative, locale
        FROM contacts
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND ${keyColumn} = ${input.nameKey}
         AND vocative_locked = false
         AND deleted_at IS NULL
       ORDER BY id
       LIMIT ${limit}
       FOR UPDATE
    `);
    if (members.length === 0) return 0;

    const first = members[0]!;
    const group = {
      gender: input.gender ?? first.gender,
      suggestedVocative:
        input.kind === 'first' ? first.first_name_vocative : first.last_name_vocative,
    };

    const settings = await readContactsSettings(tx, ctx);
    // Vykání a tykání je sloupec workspaces.address_form, ne větev settings.contacts.
    // Bez něj by se oslovení přepočítalo vždy jako vykání a projekt, který tyká,
    // by po každé akci fronty dostal nesprávné oslovení.
    const { rows: workspace } = await tx.execute<{ address_form: 'formal' | 'informal' }>(sql`
      SELECT address_form FROM workspaces WHERE id = ${ctx.workspaceId}::uuid
    `);
    const addressForm = workspace[0]?.address_form ?? 'formal';

    // U akce set_gender se vokativ musí PŘEPOČÍTAT, ne jen zamknout. Skupinu drží
    // pohromadě klíč bez diakritiky, takže "Tomáš" i "Tomas" jsou v jedné skupině,
    // ale jejich vokativ se liší. Přepočet proto běží po řádcích, ne jedním UPDATE.
    const perRow = new Map<string, string | null>();
    for (const member of members) {
      if (input.action === 'no_name') {
        perRow.set(member.id, null);
      } else if (input.action === 'set_vocative') {
        perRow.set(member.id, input.vocative ?? null);
      } else if (input.action === 'set_gender') {
        const resolved = resolveName(
          {
            firstName: member.first_name,
            lastName: member.last_name,
            locale: member.locale,
            gender: input.gender ?? 'unknown',
          },
          {
            overrides: EMPTY_OVERRIDES,
            settings: {
              addressForm,
              salutationBy: settings.salutation_by,
              vocativePolicy: settings.vocative_policy,
            },
          },
        );
        perRow.set(
          member.id,
          input.kind === 'first' ? resolved.firstNameVocative : resolved.lastNameVocative,
        );
      } else {
        perRow.set(
          member.id,
          input.kind === 'first' ? member.first_name_vocative : member.last_name_vocative,
        );
      }
    }

    const ids = [...perRow.keys()];
    const values = ids.map((id) => perRow.get(id) ?? null);
    const reviewedBy = ctx.actor.type === 'user' ? ctx.actor.userId : null;

    await tx.execute(sql`
      UPDATE contacts AS c
         SET ${column} = u.vocative,
             gender = ${input.action === 'set_gender' ? (input.gender ?? 'unknown') : sql`c.gender`},
             gender_source = ${input.action === 'set_gender' ? 'manual' : sql`c.gender_source`},
             vocative_confidence = 'high',
             vocative_locked = true,
             vocative_locked_for = coalesce(c.first_name, '') || '|' || coalesce(c.last_name, ''),
             vocative_reviewed_at = now(),
             vocative_reviewed_by = ${reviewedBy}::uuid,
             updated_at = now()
        FROM unnest(${sql.param(ids)}::uuid[], ${sql.param(values)}::text[]) AS u(id, vocative)
       WHERE c.id = u.id AND c.workspace_id = ${ctx.workspaceId}::uuid
    `);

    // Oslovení se musí přepočítat, protože se změnil vokativ nebo rod.
    await recomputeGreetingForGroup(tx, ctx, ids, {
      addressForm,
      salutationBy: settings.salutation_by,
      vocativePolicy: settings.vocative_policy,
    });

    if (input.saveOverride) {
      const override = overrideValuesFor(input, group);
      if (override.gender !== null || override.vocative !== null) {
        await upsertNameOverrideIn(tx, ctx, {
          kind: input.kind,
          // Klíč je už normalizovaný, ale `upsertNameOverrideIn` ho normalizuje znovu
          // a normalizace je idempotentní, takže se nic nezmění.
          name: input.nameKey,
          gender: override.gender,
          vocative: override.vocative,
        });
      }
    }

    // `targetId` je null schválně: `audit_log.target_id` je typu `uuid` a skupina fronty
    // žádné uuid nemá. Zápis klíče jména by skončil na 22P02 a shodil celou akci.
    // Klíč jde do metadat, kde je pro dohledání stejně dobrý.
    await writeAudit(tx, ctx, {
      action: 'contact.vocative_bulk_confirmed',
      targetType: 'contact_group',
      targetId: null,
      metadata: {
        name_key: input.nameKey,
        action: input.action,
        affected: ids.length,
        kind: input.kind,
      },
    });

    return ids.length;
  });
}

/**
 * Přepočet oslovení pro zadané kontakty. Běží po řádcích ze stejného důvodu jako
 * přepočet vokativu: greeting závisí na konkrétním tvaru jména, ne na klíči skupiny.
 * Funkce je záměrně v téže transakci, aby nemohl vzniknout stav, kdy je vokativ
 * zamknutý a oslovení odpovídá tomu předchozímu.
 */
async function recomputeGreetingForGroup(
  tx: Tx,
  ctx: WorkspaceContext,
  ids: readonly string[],
  settings: {
    addressForm: 'formal' | 'informal';
    salutationBy: 'first_name' | 'surname';
    vocativePolicy: 'strict' | 'balanced';
  },
): Promise<void> {
  if (ids.length === 0) return;

  const { rows } = await tx.execute<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    first_name_vocative: string | null;
    last_name_vocative: string | null;
    gender: Gender;
    locale: string;
  }>(sql`
    SELECT id, first_name, last_name, first_name_vocative, last_name_vocative, gender, locale
      FROM contacts
     WHERE workspace_id = ${ctx.workspaceId}::uuid AND id = ANY(${sql.param([...ids])}::uuid[])
  `);

  const greetings = rows.map((row) => {
    const built = buildGreeting({
      firstName: row.first_name,
      lastName: row.last_name,
      firstNameVocative: row.first_name_vocative,
      lastNameVocative: row.last_name_vocative,
      gender: row.gender,
      locale: row.locale,
      addressForm: settings.addressForm,
      salutationBy: settings.salutationBy,
      vocativePolicy: settings.vocativePolicy,
      // Po zásahu uživatele je jistota vždy vysoká: rozhodl o ní člověk, ne heuristika.
      vocativeConfidence: 'high',
    });
    return { id: row.id, greeting: built.greeting, neutral: built.greetingNeutral };
  });

  await tx.execute(sql`
    UPDATE contacts AS c
       SET greeting = g.greeting, greeting_neutral = g.neutral, updated_at = now()
      FROM unnest(
        ${sql.param(greetings.map((g) => g.id))}::uuid[],
        ${sql.param(greetings.map((g) => g.greeting))}::text[],
        ${sql.param(greetings.map((g) => g.neutral))}::text[]
      ) AS g(id, greeting, neutral)
     WHERE c.id = g.id AND c.workspace_id = ${ctx.workspaceId}::uuid
  `);
}

/**
 * Zařazení jobu pro velkou skupinu. Otevírá si vlastní krátkou transakci, protože
 * hlavní transakce se v téhle větvi vůbec neotevírá: kdyby se job zařadil uvnitř
 * transakce, která pak nic nedělá, drželo by se spojení zbytečně.
 */
async function enqueueJobDetached(
  ctx: WorkspaceContext,
  input: GroupActionInput,
  size: number,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await enqueue(
      tx,
      'contacts.bulk_vocative_review',
      {
        workspaceId: ctx.workspaceId,
        nameKey: input.nameKey,
        kind: input.kind,
        action: input.action,
        vocative: input.vocative ?? null,
        gender: input.gender ?? null,
        saveOverride: input.saveOverride,
        expected: size,
      },
      { singletonKey: `${ctx.workspaceId}:${input.kind}:${input.nameKey}` },
    );
  });
}
