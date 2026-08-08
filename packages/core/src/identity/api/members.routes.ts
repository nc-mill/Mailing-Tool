import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { withWorkspace } from '../../tx';
import { assertPermission } from '../permissions';
import { changeMemberRole, listMembers, removeMember } from '../membership-service';
import { createMember } from '../member-create';
import { assertInstallationAdmin, deleteUserAccount, listOrphanedAccounts } from '../user-delete';
import { listWorkspaces } from '../workspace-service';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../password';
import { problemResponse, RoleSchema, type ApiEnv } from './schemas';

export const MemberSchema = z
  .object({
    user_id: z.uuid(),
    email: z.email(),
    name: z.string(),
    role: RoleSchema,
    created_at: z.iso.datetime(),
  })
  .openapi('Member');

export const UpdateMemberInput = z
  .object({ role: RoleSchema })
  .strict()
  .openapi('UpdateMemberInput');

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/members',
  tags: ['Members'],
  summary: 'Členové projektu',
  security: [{ bearerAuth: ['members:read'] }],
  responses: {
    200: {
      description: 'Seznam členů',
      content: { 'application/json': { schema: z.object({ data: z.array(MemberSchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

/**
 * Heslo je NEPOVINNÉ. Když chybí, server ho vygeneruje a v odpovědi ho vrátí
 * právě jednou. Prázdný řetězec se nepřijímá, aby se nedalo omylem odeslat
 * nevyplněné pole a dostat účet s heslem, o kterém nikdo neví, že je náhodné.
 */
export const CreateMemberInputSchema = z
  .object({
    email: z.email(),
    role: RoleSchema,
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH).optional(),
  })
  .strict()
  .openapi('CreateMemberInput');

export const CreatedMemberSchema = z
  .object({
    member: MemberSchema,
    /** Vyplněné jen tehdy, když heslo vygeneroval server. Podruhé ho nikdo nezjistí. */
    generated_password: z.string().nullable(),
    /** `false` znamená, že účet už v instalaci byl a jeho heslo se nezměnilo. */
    password_set: z.boolean(),
  })
  .openapi('CreatedMember');

const createMemberRoute = createRoute({
  method: 'post',
  path: '/api/v1/members',
  tags: ['Members'],
  summary: 'Založení člena rovnou, s heslem',
  description:
    'Cesta pro instalace, které nemají jak doručit pozvánku e-mailem. Heslo buď zadá správce, ' +
    'nebo ho vygeneruje server a vrátí právě v téhle odpovědi. Když účet s danou adresou ' +
    'v instalaci už je, přidá se jen členství a heslo zůstává beze změny.',
  security: [{ bearerAuth: ['members:invite'] }],
  request: { body: { content: { 'application/json': { schema: CreateMemberInputSchema } } } },
  responses: {
    201: {
      description: 'Člen založen',
      content: { 'application/json': { schema: CreatedMemberSchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
    422: problemResponse('validation_failed'),
  },
});

const updateRoute = createRoute({
  method: 'patch',
  path: '/api/v1/members/{user_id}',
  tags: ['Members'],
  summary: 'Změna role člena',
  security: [{ bearerAuth: ['members:update_role'] }],
  request: {
    params: z.object({ user_id: z.uuid() }),
    body: { content: { 'application/json': { schema: UpdateMemberInput } } },
  },
  responses: {
    200: {
      description: 'Změněno',
      content: { 'application/json': { schema: z.object({ member: MemberSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('last_owner_cannot_be_removed'),
    422: problemResponse('validation_failed'),
  },
});

const removeRoute = createRoute({
  method: 'delete',
  path: '/api/v1/members/{user_id}',
  tags: ['Members'],
  summary: 'Odebrání člena z projektu',
  security: [{ bearerAuth: ['members:remove'] }],
  request: { params: z.object({ user_id: z.uuid() }) },
  responses: {
    204: { description: 'Odebráno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('last_owner_cannot_be_removed'),
  },
});

export const OrphanedAccountSchema = z
  .object({
    user_id: z.uuid(),
    email: z.email(),
    name: z.string(),
    created_at: z.iso.datetime(),
    last_login_at: z.iso.datetime().nullable(),
  })
  .openapi('OrphanedAccount');

const orphanedRoute = createRoute({
  method: 'get',
  path: '/api/v1/users/orphaned',
  tags: ['Members'],
  summary: 'Účty, které nepatří do žádného projektu',
  description:
    'Účet zůstane po odebrání z projektu i po smazání projektu. Nikde jinde se nezobrazuje, ' +
    'přitom se pořád přihlásí, takže bez tohohle výpisu ho nejde ani najít, ani smazat. ' +
    'Členství ve smazaném projektu se nepočítá.',
  security: [{ bearerAuth: ['members:remove'] }],
  responses: {
    200: {
      description: 'Seznam účtů bez projektu',
      content: {
        'application/json': { schema: z.object({ data: z.array(OrphanedAccountSchema) }) },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const deleteUserRoute = createRoute({
  method: 'delete',
  path: '/api/v1/users/{user_id}',
  tags: ['Members'],
  summary: 'Smazání uživatelského účtu',
  description:
    'Maže se měkce: účet přestane existovat pro přihlášení i pro výpisy, ale zůstane ' +
    'u toho, co vytvořil, a jeho adresa je hned volná. Auditní záznamy zůstávají. Smazat jde ' +
    'jen účet, který nepatří do žádného projektu; člena projektu je nutné nejdřív odebrat.',
  security: [{ bearerAuth: ['members:remove'] }],
  request: { params: z.object({ user_id: z.uuid() }) },
  responses: {
    204: { description: 'Smazáno, relace účtu jsou zrušené' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
  },
});

export function registerMemberRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'members:read');
    const data = await withWorkspace(ctx, (tx) => listMembers(tx, ctx));
    return c.json({ data }, 200);
  });

  /**
   * TAHLE TRASA SCHVÁLNĚ NEBĚŽÍ PŘES `runIdempotent`, na rozdíl od pozvánky.
   *
   * Idempotenční mezipaměť ukládá TĚLO ODPOVĚDI do tabulky `idempotency_keys`
   * a drží ho 24 hodin. Odpověď tady nese vygenerované heslo v otevřené podobě,
   * takže by se opakovaným požadavkem se stejným klíčem dalo přehrát a hlavně by
   * leželo v databázi, přestože se nikde jinde neukládá.
   *
   * O opakované odeslání formuláře se stará samotná operace: druhý pokus se
   * stejnou adresou skončí na 409 `already_member`, ne na druhém účtu.
   */
  app.openapi(createMemberRoute, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'members:invite');
    const input = c.req.valid('json');
    const created = await withWorkspace(ctx, (tx) =>
      createMember(
        tx,
        ctx,
        { email: input.email, role: input.role, password: input.password ?? null },
        label,
      ),
    );
    return c.json(created, 201);
  });

  app.openapi(updateRoute, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'members:update_role');
    const member = await withWorkspace(ctx, (tx) =>
      changeMemberRole(
        tx,
        ctx,
        { userId: c.req.valid('param').user_id, role: c.req.valid('json').role },
        label,
      ),
    );
    return c.json({ member }, 200);
  });

  app.openapi(removeRoute, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'members:remove');
    await withWorkspace(ctx, (tx) => removeMember(tx, ctx, c.req.valid('param').user_id, label));
    return c.body(null, 204);
  });

  /**
   * Obě trasy pro účty instalace se registrují AŽ ZA členy projektu a konkrétní
   * `/users/orphaned` před `/users/{user_id}`. Hono zkouší vzory v pořadí
   * registrace, takže by opačné pořadí nechalo slovo `orphaned` matchnout jako
   * identifikátor uživatele a výpis by vracel 422 o neplatném UUID nad cestou,
   * kde žádné UUID není. Týž vzor je popsaný u importů kontaktů v openapi.ts.
   */
  app.openapi(orphanedRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'members:remove');
    // Výpis sahá na účty CELÉ INSTALACE, ne na členy projektu, takže samotné
    // `members:remove` na něj nestačí. Rozbor je u `assertInstallationAdmin`.
    await assertInstallationAdmin(ctx);
    // Běží MIMO transakci projektu: osiřelost se zjišťuje pod jednotlivými
    // uživateli, protože členství napříč projekty se z kontextu jednoho
    // projektu přečíst nedají. Viz komentář u `listOrphanedAccounts`.
    const data = await listOrphanedAccounts();
    return c.json({ data }, 200);
  });

  app.openapi(deleteUserRoute, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'members:remove');
    // Mazání účtu je nevratný zásah do instalace, ne do projektu. Táž závora
    // jako u výpisu osiřelých, aby se cesta nedala obejít uhodnutím ID.
    await assertInstallationAdmin(ctx);
    const userId = c.req.valid('param').user_id;
    // Počet projektů se zjišťuje před transakcí a ze stejného zdroje jako výpis
    // osiřelých, tedy `withUser`. Uvnitř transakce s kontextem projektu by dotaz
    // viděl jen tenhle jeden projekt a člen cizího projektu by prošel jako osiřelý.
    const workspaceCount = (await listWorkspaces(userId)).length;
    await withWorkspace(ctx, (tx) => deleteUserAccount(tx, ctx, { userId, workspaceCount }, label));
    return c.body(null, 204);
  });
}
