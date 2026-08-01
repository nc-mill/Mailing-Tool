import type { Context, MiddlewareHandler } from 'hono';
import { eq, sql } from 'drizzle-orm';
import type { Role, WorkspaceContext } from '@mlain/db';
import * as schema from '@mlain/db/schema';
import { withoutContext, withWorkspace, type Tx } from '@mlain/core/tx';
import { ApiError } from '@mlain/core/errors/api-error';
import { createWorkspaceContext } from '@mlain/core/identity/context';
import { roleHasPermission } from '@mlain/core/identity/permissions';
import { verifyApiKey } from '@mlain/core/identity/api-key';
import { loadApiKeyRow, touchApiKeyLastUsed } from '@mlain/core/identity/api-key-service';
import { readSessionCookie, verifySessionToken } from '@mlain/core/identity/session';
import type { ApiEnv } from '@mlain/core/identity/api/schemas';
import { validateIdempotencyKey, withIdempotency } from './idempotency';
import { consumeAll, limiterRegistry } from './rate-limit';

const BEARER = /^bearer\s+(.+)$/i;

export function bearerFromHeader(value: string | undefined | null): string | null {
  if (!value) return null;
  return value.match(BEARER)?.[1]?.trim() ?? null;
}

/**
 * 3.6: workspaceId aktéra typu user pochází ze segmentu cesty /w/{slug} v UI
 * nebo z hlavičky X-Workspace-Id u API se session. Nikdy z těla requestu.
 */
export function workspaceRefFrom(input: {
  header: string | undefined;
  path: string;
}): string | null {
  if (input.header && input.header.length > 0) return input.header;
  return input.path.match(/^\/w\/([^/]+)/)?.[1] ?? null;
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Cesty, které se k žádnému projektu nevztahují, takže kontext nepotřebují
 * a middleware je přeskakuje.
 */
export const CONTEXT_FREE_PREFIXES = [
  '/api/v1/auth',
  '/api/v1/setup',
  '/api/v1/openapi.json',
  '/api/v1/docs',
  '/api/v1/invitations/accept',
];

const WORKSPACE_COLLECTION_PATHS = new Set(['/api/v1/workspaces']);

/**
 * Obnova smazaného projektu. Kontext se pro ni sestavit NEDÁ:
 * `createWorkspaceContext` hledá projekt s `deleted_at IS NULL`, takže by
 * middleware vrátil 404 dřív, než se handler vůbec spustí, a smazaný projekt
 * by nešlo obnovit nikdy. Endpoint si proto ověřuje relaci sám
 * (`requireSession`) a členství si dohledává obnovovací služba.
 */
const CONTEXT_FREE_PATTERNS = [/^\/api\/v1\/workspaces\/[^/]+\/restore$/];

/**
 * ODCHYLKA OD PLÁNU: seznam se rozšiřuje o testovací cesty kostry
 * (`/api/v1/__test/**`), které existují jen mimo produkci a slouží k ověření
 * middleware. Bez toho by `app.test.ts` dostal na každou z nich 401, protože
 * autentizace běží dřív než handler.
 */
const TEST_PREFIX = '/api/v1/__test';

/**
 * Rozpozná aktéra a sestaví WorkspaceContext pro projektové cesty /api/v1/**.
 */
export function authenticate(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (
      path === TEST_PREFIX ||
      path.startsWith(`${TEST_PREFIX}/`) ||
      CONTEXT_FREE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`)) ||
      CONTEXT_FREE_PATTERNS.some((p) => p.test(path)) ||
      WORKSPACE_COLLECTION_PATHS.has(path)
    ) {
      await next();
      return;
    }

    const bearer = bearerFromHeader(c.req.header('Authorization'));

    if (bearer) {
      const verified = await withoutContext((tx) =>
        verifyApiKey(bearer, (prefix, kind) => loadApiKeyRow(tx, prefix, kind)),
      );

      // 4.5: čtení a zápis mají vlastní limit na klíč.
      const headers = await consumeAll(limiterRegistry(), [
        {
          rule: WRITE_METHODS.has(c.req.method) ? 'api_key_write' : 'api_key_read',
          key: verified.apiKeyId,
        },
      ]);
      for (const [k, v] of Object.entries(headers)) c.header(k, v);

      // 3.5: integrátor musí poznat, že jede na dožívajícím sekretu.
      if (verified.rotated) c.header('ML-Key-Rotated', 'true');

      const ctx = await createWorkspaceContext({
        kind: 'api_key',
        apiKeyId: verified.apiKeyId,
        workspaceId: verified.workspaceId,
        scopes: verified.scopes,
      });

      const [row] = await withWorkspace(ctx, (tx) =>
        tx
          .select({ name: schema.apiKeys.name })
          .from(schema.apiKeys)
          .where(eq(schema.apiKeys.id, verified.apiKeyId))
          .limit(1),
      );

      c.set('auth', { ctx, label: row?.name ?? 'api key' });
      c.set('workspaceId', ctx.workspaceId);
      c.set('actorType', 'api_key');
      c.set('actorId', verified.apiKeyId);
      setIdempotentRunner(c, ctx, path);

      // Zápis last_used_at mimo hlavní transakci, fire and forget (7).
      void withoutContext((tx) => touchApiKeyLastUsed(tx, verified.apiKeyId)).catch(
        () => undefined,
      );

      await next();
      return;
    }

    const token = readSessionCookie(c.req.header('Cookie'));
    if (!token) throw new ApiError('unauthenticated');
    const session = await withoutContext((tx) => verifySessionToken(tx, token));

    const headers = await consumeAll(limiterRegistry(), [
      { rule: 'session_user', key: session.userId },
    ]);
    for (const [k, v] of Object.entries(headers)) c.header(k, v);

    const ref = workspaceRefFrom({ header: c.req.header('X-Workspace-Id'), path });
    // Bez reference na projekt není co izolovat; pro aktéra projekt neexistuje.
    if (!ref) throw new ApiError('not_found');

    const ctx = await createWorkspaceContext({
      kind: 'session',
      userId: session.userId,
      workspaceRef: ref,
    });

    const [user] = await withoutContext((tx) =>
      tx
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, session.userId))
        .limit(1),
    );

    c.set('auth', { ctx, label: user?.email ?? '' });
    c.set('workspaceId', ctx.workspaceId);
    c.set('actorType', 'user');
    c.set('actorId', session.userId);
    setIdempotentRunner(c, ctx, path);

    await next();
  };
}

/**
 * Doplní do chyby `forbidden` seznam kolegů, které jde požádat o vyšší roli.
 *
 * Proč to nedělá assertPermission: potřebuje dotaz do databáze a chce být čistá
 * a synchronní. Proč to nedělá katalog hlášek: nemá kontext ani transakci.
 *
 * PRAVIDLO O SOUKROMÍ, které tu je záměrně: jména a e-maily kolegů se doplní
 * JEN tomu, kdo smí členy vidět (`members:read`). Viewer to právo nemá, takže
 * by mu 403 jinak prozradila seznam lidí, na který přes API nedosáhne, a chyba
 * by se stala obchvatem oprávnění. Kdo členy vidět nesmí, dostane prázdný
 * seznam a obrazovka použije obecnou větu bez jmen.
 */
export async function enrichForbidden(ctx: WorkspaceContext, error: ApiError): Promise<ApiError> {
  if (error.code !== 'forbidden' || ctx.actor.type !== 'user') return error;

  const grantedByRoles = (error.params?.['grantedByRoles'] ?? []) as Role[];
  if (grantedByRoles.length === 0) return error;
  if (!roleHasPermission(ctx.actor.role, 'members:read')) return error;

  const members = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ name: string; email: string; role: string }>(sql`
      SELECT u.name, u.email::text AS email, m.role
        FROM memberships m
        JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
       WHERE m.workspace_id = ${ctx.workspaceId}::uuid
         AND m.role = ANY(${grantedByRoles})
       ORDER BY array_position(ARRAY['owner','admin','editor','viewer']::text[], m.role), u.email
       LIMIT 5
    `);
    return rows;
  });

  return error.withParams({
    ...error.params,
    contactableMembers: members.map((m) => ({ name: m.name, email: m.email, role: m.role })),
  });
}

/**
 * 4.4: Idempotency-Key je povinný jen pro zápisy iniciované klientem na
 * /api/v1/**. U ostatních metod runner operaci jen spustí v transakci.
 */
function setIdempotentRunner(c: Context<ApiEnv>, ctx: WorkspaceContext, path: string): void {
  const workspaceId = ctx.workspaceId;
  c.set(
    'runIdempotent',
    async <T>(operation: (tx: Tx) => Promise<T>, options?: { successStatus?: number }) => {
      if (!WRITE_METHODS.has(c.req.method)) {
        const result = await withWorkspace(ctx, operation);
        return { status: 200, body: result, replay: false };
      }

      const key = validateIdempotencyKey(c.req.header('Idempotency-Key'));
      /**
       * ODCHYLKA OD PLÁNU: tělo se čte přes `c.req.json()`, ne přes
       * `c.req.raw.clone().json()`. Klon SELŽE, protože tělo v té chvíli už
       * spotřeboval validátor cesty, a `catch` by to spolkl a dosadil `null`.
       * Otisk požadavku by pak byl pro KAŽDÉ tělo stejný a idempotence by
       * mlčky přestala rozlišovat requesty: druhý zápis se stejným klíčem
       * a JINÝM tělem by se místo 409 tvářil jako opakování prvního.
       * Naměřeno spuštěním. `c.req.json()` vrací tělo z cache Hona.
       */
      let body: unknown = null;
      try {
        body = await c.req.json();
      } catch {
        body = null;
      }

      const status = options?.successStatus ?? (c.req.method === 'POST' ? 201 : 200);

      const outcome = await withWorkspace(ctx, (tx) =>
        withIdempotency(tx, { workspaceId, key, method: c.req.method, path, body }, async () => {
          const result = await operation(tx);
          return { status, body: result, result };
        }),
      );

      if (outcome.replay) {
        c.header('Idempotent-Replay', 'true');
        return { status: outcome.status, body: outcome.body, replay: true };
      }
      return { status, body: outcome.result, replay: false };
    },
  );
}
