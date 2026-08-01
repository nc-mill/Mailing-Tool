import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import { withUser, withWorkspace } from '../tx';
import { ApiError, validationFailed } from '../errors/api-error';
import type { Role, WorkspaceContext } from './types';
import type { Permission } from './permissions';

/**
 * TENHLE SOUBOR je jediné místo v celém monorepu, které smí importovat
 * @mlain/db/unsafe-context. P03 tu funkci z kořenového exportu záměrně vynechal,
 * aby ji našeptávač nenabízel každému, a `createWorkspaceContext` níž je ta
 * jediná legitimní továrna, protože jako jediná ověřuje členství.
 * Že se import neobjeví nikde jinde, hlídá test v úkolu 19.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AuthenticatedRequest =
  | { kind: 'session'; userId: string; workspaceRef: string }
  | { kind: 'api_key'; apiKeyId: string; workspaceId: string; scopes: readonly Permission[] }
  | { kind: 'system'; job: string; workspaceId: string };

/**
 * 3.6: jediná továrna kontextu. Ověřuje členství nebo klíč a jinou cestou
 * WorkspaceContext vzniknout nemůže, protože typ je branded.
 *
 * Odkud se bere workspaceId:
 * - aktér api_key: z api_keys.workspace_id, NIKDY z URL ani z těla requestu;
 * - aktér user: ze segmentu cesty /w/{slug} nebo z hlavičky X-Workspace-Id.
 *
 * Nečlen dostane 404, ne 403. Kdyby neexistující členství vracelo 403, dalo by
 * se z toho zjistit, které workspace ID existují.
 */
export async function createWorkspaceContext(
  input: AuthenticatedRequest,
): Promise<WorkspaceContext> {
  if (input.kind === 'api_key') {
    return unsafeWorkspaceContext(input.workspaceId, {
      type: 'api_key',
      apiKeyId: input.apiKeyId,
      scopes: input.scopes,
    });
  }

  if (input.kind === 'system') {
    return unsafeWorkspaceContext(input.workspaceId, { type: 'system', job: input.job });
  }

  const ref = input.workspaceRef;
  // Nesmyslná hodnota se nikdy nedostane do porovnání s uuid sloupcem: chyba
  // typu z databáze by se projevila jako 500 a prozradila by tvar dotazu.
  const matchesId = UUID_PATTERN.test(ref);
  const isSlugShaped = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(ref);
  if (!matchesId && !isSlugShaped) throw new ApiError('not_found');

  // Čte se pod mlain.user_id, protože politiky ws_member_visibility
  // a user_own_memberships jsou jediné, které bez workspace kontextu vracejí řádky.
  const rows = await withUser(input.userId, (tx) =>
    tx
      .select({ id: schema.workspaces.id, role: schema.memberships.role })
      .from(schema.workspaces)
      .innerJoin(
        schema.memberships,
        and(
          // Pořadí argumentů je záměrné: `eq(schema.workspaces.id, ...)` je
          // spojení sloupce se sloupcem, ne filtr podle workspace. Opačné pořadí
          // by vypadalo jako ruční obcházení wsEq a test disciplíny izolace
          // v scope.test.ts by ho označil za porušení, ačkoli o filtr nejde.
          eq(schema.workspaces.id, schema.memberships.workspaceId),
          eq(schema.memberships.userId, input.userId),
        ),
      )
      .where(
        and(
          isNull(schema.workspaces.deletedAt),
          matchesId ? eq(schema.workspaces.id, ref) : eq(schema.workspaces.slug, ref),
        ),
      )
      .limit(1),
  );

  const row = rows[0];
  if (!row) throw new ApiError('not_found');

  return unsafeWorkspaceContext(row.id, {
    type: 'user',
    userId: input.userId,
    role: row.role as Role,
  });
}

/**
 * Kontext pro joby platformy a pro vnitřní volání, která nemají request.
 *
 * Je synchronní schválně: job dostává workspace_id z payloadu fronty, kam ho
 * zapsala operace, která už kontext ověřila, takže se členství nekontroluje
 * podruhé. Systémový aktér navíc projde maticí oprávnění vždy (úkol 12).
 * Jméno jobu je povinné, protože bez něj by v auditu nešlo dohledat, co zápis
 * vyvolalo, a `audit_log.actor_label` se plní právě z něj.
 */
export function createSystemContext(workspaceId: string, job: string): WorkspaceContext {
  // Odchylka od plánu: plán volal `new ApiError('validation_failed', 'text')`,
  // jenže druhý parametr konstruktoru jsou OPTIONS, ne řetězec, a kód
  // validation_failed navíc podle 4.2 vyžaduje pole `errors`. Text v druhém
  // argumentu by se do odpovědi nikdy nedostal a jen by mlčky zmizel.
  if (!UUID_PATTERN.test(workspaceId)) {
    throw validationFailed([
      {
        path: 'workspace_id',
        code: 'invalid_format',
        message: `workspace_id není UUID: ${workspaceId}`,
      },
    ]);
  }
  if (job.length === 0) {
    throw validationFailed([
      { path: 'job', code: 'required', message: 'systémový kontext musí nést název jobu' },
    ]);
  }
  return unsafeWorkspaceContext(workspaceId, { type: 'system', job });
}

/**
 * Kontext pro přijetí pozvánky.
 *
 * Je to jediná operace, kde `createWorkspaceContext` použít NEJDE: členství
 * v té chvíli ještě neexistuje, teprve vzniká, takže by ověření členství
 * vrátilo 404 a pozvánku by nešlo přijmout nikdy.
 *
 * Bezpečné to je proto, že `workspaceId` ani `role` nepocházejí z requestu.
 * Obojí je z řádku `invitations` dohledaného podle `token_hash`, tedy z hodnoty,
 * kterou vydal někdo, kdo v projektu právo zvát měl. Volající ovlivňuje jedinou
 * věc: token. Aktérem je přijímající uživatel, ne systém, aby auditní záznam
 * o vstupu do projektu nesl skutečného člověka.
 */
export function createInvitationContext(
  workspaceId: string,
  userId: string,
  role: Role,
): WorkspaceContext {
  return unsafeWorkspaceContext(workspaceId, { type: 'user', userId, role });
}

/** Zkratka pro operace, které už mají kontext a potřebují transakci s RLS. */
export function inWorkspace<T>(
  ctx: WorkspaceContext,
  fn: Parameters<typeof withWorkspace<T>>[1],
): Promise<T> {
  return withWorkspace(ctx, fn);
}
