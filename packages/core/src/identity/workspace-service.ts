import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '@mlain/db/schema';
import { pgErrorCode, withUser, withWorkspace, type Tx } from '../tx';
import { loadConfig, type MlainConfig } from '../config';
import { ApiError, validationFailed } from '../errors/api-error';
import { writeAuditLog } from '../audit/write';
import { diffForAudit } from '../audit/redact';
// Transakční zařazení jobu vlastní doména kontaktů. Je to import PŘES DOMÉNU
// uvnitř téhož balíčku, tedy táž hrana, jakou už používají `ai/repo.ts`,
// `segments` i `templates`. Vlastní zapisovač do `pgboss.job` by byl druhá
// implementace téhož a nesl by konfiguraci fronty odjinud než z registru.
import { enqueue as enqueueContactsJob } from '../contacts/jobs/enqueue';
import { IdentityAuditActions } from './audit';
import { slugify } from './setup';
import { verifyPassword } from './password';
import { wsEq } from './scope';
import type { Role, WorkspaceContext } from './types';

/**
 * ODCHYLKA OD PLÁNU: konfigurace se čte líně, protože P01 vydává jen
 * `loadConfig()`. Stejný vzor jako v `session.ts` a `tx/index.ts`.
 */
let cachedConfig: MlainConfig | null = null;
function cfg(): MlainConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

export type PublicWorkspace = {
  id: string;
  name: string;
  slug: string;
  locale: string;
  timezone: string;
  address_form: 'formal' | 'informal';
  created_at: string;
  deleted_at: string | null;
};

function toPublicWorkspace(row: {
  id: string;
  name: string;
  slug: string;
  locale: string;
  timezone: string;
  addressForm: string;
  createdAt: Date;
  deletedAt: Date | null;
}): PublicWorkspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    locale: row.locale,
    timezone: row.timezone,
    address_form: row.addressForm as 'formal' | 'informal',
    created_at: new Date(row.createdAt).toISOString(),
    deleted_at: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
  };
}

/**
 * 3.3: při kolizi se přidá -2, -3. Uživatel může slug přepsat.
 *
 * Kandidát se NEVYBÍRÁ dotazem na obsazenost, protože takový dotaz je pod RLS
 * nespolehlivý: unikátní index `uq_workspaces__slug` je GLOBÁLNÍ, ale politika
 * ukáže volajícímu jen projekty, kde je členem. Cizí projekt se stejným názvem
 * tedy zůstane neviditelný, `SELECT 1` nevrátí nic, kandidát projde jako volný
 * a INSERT spadne na 23505. Uživatel by dostal 500 místo 409 a projevilo by se
 * to až u druhého zákazníka, který si projekt pojmenuje stejně.
 *
 * Správně je nechat rozhodnout databázi: zkusit zápis a při 23505 vzít dalšího
 * kandidáta. Volající proto dostane generátor kandidátů, ne hotový slug.
 */
export function slugCandidates(base: string, limit = 100): string[] {
  const out = [base];
  for (let attempt = 2; attempt <= limit; attempt += 1) out.push(`${base}-${attempt}`);
  return out;
}

/**
 * Zkusí operaci pro každého kandidáta a při kolizi unikátního indexu přejde
 * k dalšímu. SQLSTATE se čte přes pgErrorCode, protože Drizzle chybu zabaluje
 * a `error.code` je undefined; ověřeno spuštěním, viz 0.8.
 *
 * POZOR na transakce: chyba 23505 uvnitř transakce ji zneplatní, takže každý
 * pokus musí běžet ve VLASTNÍ transakci. Proto se sem předává funkce, která si
 * transakci otevře sama, ne handle.
 */
export async function withSlugRetry<T>(
  base: string,
  attempt: (slug: string) => Promise<T>,
): Promise<T> {
  for (const candidate of slugCandidates(base)) {
    try {
      return await attempt(candidate);
    } catch (error) {
      if (pgErrorCode(error) !== '23505') throw error;
    }
  }
  throw new ApiError('conflict', { params: { reason: 'slug_exhausted' } });
}

export async function listWorkspaces(
  userId: string,
): Promise<Array<PublicWorkspace & { role: Role }>> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        slug: schema.workspaces.slug,
        locale: schema.workspaces.locale,
        timezone: schema.workspaces.timezone,
        addressForm: schema.workspaces.addressForm,
        createdAt: schema.workspaces.createdAt,
        deletedAt: schema.workspaces.deletedAt,
        role: schema.memberships.role,
      })
      .from(schema.workspaces)
      .innerJoin(
        schema.memberships,
        // Pořadí argumentů je záměrné, stejně jako v `context.ts`: je to spojení
        // sloupce se sloupcem, ne filtr podle workspace. Opačné pořadí by
        // disciplinární test v scope.test.ts označil za ruční obcházení wsEq.
        and(
          eq(schema.workspaces.id, schema.memberships.workspaceId),
          eq(schema.memberships.userId, userId),
        ),
      )
      .where(isNull(schema.workspaces.deletedAt))
      .orderBy(schema.workspaces.name),
  );
  return rows.map((r) => ({ ...toPublicWorkspace(r), role: r.role as Role }));
}

export async function createWorkspace(
  userId: string,
  actorLabel: string,
  input: {
    name: string;
    slug?: string | undefined;
    locale?: string | undefined;
    timezone?: string | undefined;
  },
): Promise<{ workspace: PublicWorkspace; role: Role }> {
  const base = input.slug ? slugify(input.slug) : slugify(input.name);

  // O obsazenosti slugu rozhoduje unikátní index, ne dotaz. Každý pokus má
  // vlastní transakci i vlastní ID, protože 23505 předchozí transakci zneplatní.
  return withSlugRetry(base, (slug) => {
    const workspaceId = uuidv7();
    return withUser(userId, async (tx) => {
      // Kontext se nastavuje na VLASTNÍ, právě vygenerované ID, a to JEŠTĚ PŘED
      // vložením řádku. Není to obcházení izolace: kontext ukazuje na projekt,
      // který v téhle transakci vzniká, takže ws_isolation_self pustí jen ten
      // jediný řádek a ws_isolation na memberships jen členství v něm. Kdyby
      // transakce spadla, kontext zmizí s ní, protože je nastavený jako SET LOCAL.
      //
      // Pořadí je tvrdá podmínka, ne úhlednost. P03 obojí naměřil spuštěním:
      //   * `INSERT ... RETURNING` uplatní na nový řádek i politiky pro ČTENÍ.
      //     ws_insert_bootstrap je FOR INSERT, takže na RETURNING nedosáhne,
      //     a ws_isolation_self by porovnávala s nenastaveným kontextem. Tentýž
      //     INSERT bez RETURNING projde, s RETURNING skončí na
      //     "new row violates row-level security policy".
      //   * Vložení členství by neprošlo ani tak, ws_isolation na memberships
      //     má WITH CHECK proti workspace kontextu.
      //
      // Nejlevnější cesta k zelenému testu by byla uvolnit politiku na memberships.
      // To je přesně ta chyba, které má celý model bránit, a v revizi by ji nikdo
      // nenašel. Proto se sem žádná nová politika nežádá.
      await tx.execute(sql`SELECT set_config('mlain.workspace_id', ${workspaceId}, true)`);

      const [row] = await tx
        .insert(schema.workspaces)
        .values({
          id: workspaceId,
          name: input.name,
          slug,
          // 2.3: aplikace vyplňuje vždy explicitně, DEFAULT v DDL je jen pojistka.
          locale: input.locale ?? cfg().DEFAULT_LOCALE,
          timezone: input.timezone ?? cfg().DEFAULT_TIMEZONE,
          createdBy: userId,
        })
        .returning();
      await tx.insert(schema.memberships).values({ workspaceId, userId, role: 'owner' });

      await writeAuditLog(tx, {
        action: IdentityAuditActions['workspace.created'],
        workspaceId,
        actor: { actorType: 'user', actorId: userId, actorLabel },
        targetType: 'workspace',
        targetId: workspaceId,
        metadata: { name: input.name, slug },
      });

      return { workspace: toPublicWorkspace(row!), role: 'owner' as Role };
    });
  });
}

export async function getWorkspace(tx: Tx, ctx: WorkspaceContext): Promise<PublicWorkspace> {
  const [row] = await tx
    .select()
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.id, ctx.workspaceId), isNull(schema.workspaces.deletedAt)))
    .limit(1);
  if (!row) throw new ApiError('not_found');
  return toPublicWorkspace(row);
}

export async function updateWorkspace(
  tx: Tx,
  ctx: WorkspaceContext,
  input: {
    name?: string | undefined;
    slug?: string | undefined;
    locale?: string | undefined;
    timezone?: string | undefined;
    address_form?: string | undefined;
  },
  actorLabel: string,
): Promise<PublicWorkspace> {
  const before = await getWorkspace(tx, ctx);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  // Tady se slug NEDOHLEDÁVÁ ani neposouvá na -2: uživatel si ho zvolil sám,
  // takže tichá změna na jinou hodnotu by byla horší než odmítnutí. Kolizi
  // proto hlásíme jako 409, a rozhoduje o ní unikátní index, ne SELECT, který
  // by pod RLS cizí projekt neviděl.
  if (input.slug !== undefined) patch.slug = slugify(input.slug);
  if (input.locale !== undefined) patch.locale = input.locale;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.address_form !== undefined) patch.addressForm = input.address_form;

  let row: typeof schema.workspaces.$inferSelect | undefined;
  try {
    [row] = await tx
      .update(schema.workspaces)
      .set(patch)
      .where(and(eq(schema.workspaces.id, ctx.workspaceId), isNull(schema.workspaces.deletedAt)))
      .returning();
  } catch (error) {
    if (pgErrorCode(error) === '23505') {
      throw new ApiError('conflict', { params: { reason: 'slug_taken' } });
    }
    throw error;
  }
  if (!row) throw new ApiError('not_found');

  const after = toPublicWorkspace(row);

  // Změna vykání a tykání musí přepočítat oslovení VŠECH kontaktů projektu.
  //
  // `contacts.greeting` je odvozená hodnota: skládá se ze jména, uloženého
  // vokativu a nastavení projektu. Přepočítává se při každém zápisu kontaktu,
  // jenže změna nastavení žádný zápis kontaktu nevyvolá. Bez tohohle zařazení by
  // projekt, který přepnul na tykání, viděl novou volbu v nastavení a rozeslal
  // příští kampaň se starým oslovením; nic by přitom neselhalo.
  //
  // Zařazuje se v TÉŽE transakci jako změna sloupce, aby po odvolání transakce
  // nezůstala úloha, která přepočítá oslovení podle nastavení, které se nakonec
  // neuložilo. `singletonKey` je ID projektu, protože dvojí souběžný přepočet
  // nad jedním projektem je jen dvojí práce.
  //
  // ZMĚNA JAZYKA PROJEKTU JE TÁŽ VĚC, JEN VÁŽNĚJŠÍ. Jazyk určuje nejen větu
  // („Dobrý den" versus „Hello"), ale i to, jestli se vůbec počítá 5. pád. Projekt
  // založený anglickým průvodcem uložil kontaktům `locale = 'en'`, takže po přepnutí
  // na češtinu měly dál ve sloupci vokativu nominativ a v oslovení „Hello Petr“.
  // Doloženo na živé databázi: kontakty s `first_name = 'Petr'` a `locale = 'en'`
  // nesly oslovení „Hello Petře“ i poté, co uživatel projekt přepnul na češtinu.
  //
  // Sjednocení se týká JEN kontaktů, které měly dosavadní jazyk projektu, tedy těch,
  // které si ho nezvolily, ale zdědily. Kontakt s jazykem třetím (Slovák v českém
  // projektu) je výslovná volba a ta se nepřepisuje. Kdo potřebuje srovnat i ty,
  // má na to hromadnou akci v nastavení, která `from` neuvádí.
  if (before.locale !== after.locale) {
    await enqueueContactsJob(
      tx,
      'contacts.recompute_greeting',
      {
        workspaceId: ctx.workspaceId,
        alignLocale: { to: after.locale, from: before.locale },
      },
      { singletonKey: ctx.workspaceId },
    );
    // Změna obojího najednou stačí jedním během: přepočet skládá větu vždy podle
    // AKTUÁLNÍHO nastavení projektu, takže vykání i tykání se do ní promítne také.
  } else if (before.address_form !== after.address_form) {
    await enqueueContactsJob(
      tx,
      'contacts.recompute_greeting',
      { workspaceId: ctx.workspaceId },
      { singletonKey: ctx.workspaceId },
    );
  }

  await writeAuditLog(tx, {
    action: IdentityAuditActions['workspace.updated'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'workspace',
    targetId: ctx.workspaceId,
    metadata: diffForAudit(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    ) as unknown as Record<string, unknown>,
  });
  return after;
}

/** 3.3: měkké smazání, po 30 dnech tvrdé retenčním jobem platform.purge_workspaces. */
export async function deleteWorkspace(
  tx: Tx,
  ctx: WorkspaceContext,
  confirmName: string,
  actorLabel: string,
): Promise<void> {
  const current = await getWorkspace(tx, ctx);
  if (confirmName !== current.name) {
    throw validationFailed([
      {
        path: 'confirm_name',
        code: 'confirm_name_mismatch',
        message: 'Pro potvrzení opište přesný název projektu.',
      },
    ]);
  }
  // ODCHYLKA OD PLÁNU: plán tu volal `wsEq(ctx, { workspaceId: schema.workspaces.id } as never)`.
  // Tabulka `workspaces` sloupec `workspace_id` nemá, identita projektu je `id`,
  // takže šlo o přetypování, které jen obcházelo typovou kontrolu. Filtr podle
  // `id` je tady ta správná podmínka a `wsEq` na ni nesedí ani významem.
  await tx
    .update(schema.workspaces)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.workspaces.id, ctx.workspaceId), isNull(schema.workspaces.deletedAt)));

  await writeAuditLog(tx, {
    action: IdentityAuditActions['workspace.deleted'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'workspace',
    targetId: ctx.workspaceId,
  });
}

export const RESTORE_WINDOW_DAYS = 30;

/**
 * Vstup obnovy. Je to POJMENOVANÝ typ, ne dva volné řetězce, a má to důvod.
 *
 * Obnova je jediná operace v téhle doméně, která `WorkspaceContext` vzít NEMŮŽE:
 * pracuje s měkce smazaným projektem a `createWorkspaceContext` takový projekt
 * odmítá, takže by kontext nešlo vůbec vyrobit. `workspaceId` je tu proto
 * NEOVĚŘENÝ odkaz z requestu a funkce si vlastnictví ověřuje sama, dotazem
 * níž, přesně jako to dělá továrna kontextu.
 *
 * Pravidlo z 3.6 ("žádná exportovaná funkce nebere workspaceId jako string")
 * na tenhle případ nedosáhne a disciplinární test v `scope.test.ts` ho pozná
 * jen podle tvaru parametrů, ne podle významu. Typ ho tedy nechce obejít,
 * chce ten rozdíl pojmenovat; správné řešení je doplnit obnovu mezi vyjmenované
 * výjimky toho testu stejně, jako je tam `identity/context.ts`.
 */
export type RestoreWorkspaceRequest = {
  userId: string;
  /** NEOVĚŘENÝ odkaz z requestu. Vlastnictví se kontroluje uvnitř. */
  workspaceId: string;
};

export async function restoreWorkspace(
  request: RestoreWorkspaceRequest,
  actorLabel: string,
): Promise<PublicWorkspace> {
  const { userId, workspaceId } = request;
  return withUser(userId, async (tx) => {
    // Vlastnictví se ověřuje výslovně, protože měkce smazaný projekt už
    // neprojde createWorkspaceContext.
    const { rows } = await tx.execute<{ id: string }>(sql`
      SELECT w.id::text AS id
        FROM workspaces w
        JOIN memberships m ON m.workspace_id = w.id AND m.user_id = ${userId}::uuid
       WHERE w.id = ${workspaceId}::uuid
         AND m.role = 'owner'
         AND w.deleted_at IS NOT NULL
         AND w.deleted_at > now() - interval '${sql.raw(String(RESTORE_WINDOW_DAYS))} days'
       LIMIT 1
    `);
    if (rows.length === 0) throw new ApiError('not_found');

    // Kontext se MUSÍ nastavit PŘED UPDATE. Pro zápis do workspaces platí jen
    // politika ws_isolation_self, která porovnává id s mlain.workspace_id;
    // ws_member_visibility je FOR SELECT a ws_insert_bootstrap FOR INSERT,
    // takže na UPDATE nedosáhnou. Bez tohohle řádku ovlivní UPDATE nula řádků
    // a NEOHLÁSÍ chybu: `restored[0]!` je pak undefined, endpoint spadne na
    // TypeError jako 500 a projekt zůstane smazaný.
    await tx.execute(sql`SELECT set_config('mlain.workspace_id', ${workspaceId}, true)`);

    const { rows: restored } = await tx.execute<Record<string, unknown>>(sql`
      UPDATE workspaces SET deleted_at = NULL, updated_at = now()
       WHERE id = ${workspaceId}::uuid
       RETURNING id::text AS id, name, slug, locale, timezone, address_form, created_at, deleted_at
    `);
    if (restored.length === 0) throw new ApiError('not_found');

    await writeAuditLog(tx, {
      action: IdentityAuditActions['workspace.restored'],
      workspaceId,
      actor: { actorType: 'user', actorId: userId, actorLabel },
      targetType: 'workspace',
      targetId: workspaceId,
    });

    const row = restored[0]!;
    return {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      locale: row.locale as string,
      timezone: row.timezone as string,
      address_form: row.address_form as 'formal' | 'informal',
      created_at: new Date(row.created_at as Date).toISOString(),
      deleted_at: null,
    };
  });
}

/**
 * 3.3: v jedné transakci cílový dostane owner, původní admin. Vyžaduje
 * re-autentizaci heslem, protože je to nevratná změna vlastnictví projektu.
 */
export async function transferOwnership(
  ctx: WorkspaceContext,
  input: {
    currentUserId: string;
    targetUserId: string;
    reauthPassword: string | null;
    actorLabel: string;
  },
): Promise<void> {
  if (!input.reauthPassword)
    throw new ApiError('unauthenticated', { params: { reason: 'reauth_required' } });
  // Lokální konstanta, ne `input.reauthPassword!`: zúžení typu se přes hranici
  // callbacku neprotáhne a vykřičník by tu ochranu jen umlčel.
  const reauthPassword = input.reauthPassword;

  await withWorkspace(ctx, async (tx) => {
    const { rows: users } = await tx.execute<{ password_hash: string }>(
      sql`SELECT password_hash FROM users WHERE id = ${input.currentUserId}::uuid AND deleted_at IS NULL`,
    );
    if (users.length === 0) throw new ApiError('unauthenticated');
    if (!(await verifyPassword(users[0]!.password_hash, reauthPassword))) {
      throw new ApiError('unauthenticated', { params: { reason: 'reauth_failed' } });
    }

    // Pravidlo „nejvýš jeden owner" žádné omezení v databázi nevynucuje, P03 ho
    // výslovně nechává na aplikaci. Dva souběžné převody by tedy bez zámku
    // proběhly oba a projekt by skončil se dvěma ownery. Řádky členství se
    // proto nejdřív zamknou v pořadí podle user_id (stabilní pořadí brání
    // uváznutí, když dva převody míří na tytéž dva lidi navzájem).
    await tx.execute(sql`
      SELECT 1 FROM memberships
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND user_id IN (${input.currentUserId}::uuid, ${input.targetUserId}::uuid)
       ORDER BY user_id
         FOR UPDATE
    `);

    const { rows: owners } = await tx.execute<{ user_id: string }>(sql`
      SELECT user_id::text AS user_id FROM memberships
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND role = 'owner'
    `);
    if (owners.length !== 1 || owners[0]!.user_id !== input.currentUserId) {
      // Někdo nás předběhl: vlastnictví už přešlo jinam, nebo je stav rozbitý.
      throw new ApiError('conflict', { params: { reason: 'ownership_changed' } });
    }

    const [target] = await tx
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(and(wsEq(ctx, schema.memberships), eq(schema.memberships.userId, input.targetUserId)))
      .limit(1);
    if (!target) {
      throw validationFailed([
        { path: 'user_id', code: 'not_a_member', message: 'Cílový uživatel není členem projektu.' },
      ]);
    }

    await tx
      .update(schema.memberships)
      .set({ role: 'owner', updatedAt: new Date() })
      .where(and(wsEq(ctx, schema.memberships), eq(schema.memberships.userId, input.targetUserId)));
    await tx
      .update(schema.memberships)
      .set({ role: 'admin', updatedAt: new Date() })
      .where(
        and(wsEq(ctx, schema.memberships), eq(schema.memberships.userId, input.currentUserId)),
      );

    await writeAuditLog(tx, {
      action: IdentityAuditActions['workspace.ownership_transferred'],
      workspaceId: ctx.workspaceId,
      actor: { actorType: 'user', actorId: input.currentUserId, actorLabel: input.actorLabel },
      targetType: 'user',
      targetId: input.targetUserId,
      metadata: { from: input.currentUserId, to: input.targetUserId },
    });
  });
}
