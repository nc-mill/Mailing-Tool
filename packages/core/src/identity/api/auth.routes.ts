import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '../../tx';
import { loadConfig, type MlainConfig } from '../../config';
import { ApiError } from '../../errors/api-error';
import { writeAuditLog } from '../../audit/write';
import { login, listWorkspacesOfUser, toPublicUser } from '../login';
import { changePassword } from '../change-password';
import { confirmPasswordReset, requestPasswordReset } from '../password-reset';
import { IdentityAuditActions } from '../audit';
import { csrfTokenFor } from '../csrf';
import {
  clearSessionCookie,
  isSecureCookieContext,
  listUserSessions,
  readSessionCookie,
  revokeSession,
  revokeUserSessions,
  serializeSessionCookie,
  sessionMaxAgeSeconds,
  verifySessionToken,
} from '../session';
import {
  problemResponse,
  PublicUserSchema,
  RoleSchema,
  WorkspaceSummarySchema,
  type ApiEnv,
} from './schemas';

/**
 * ODCHYLKA OD PLÁNU: plán psal `import { config } from '@mlain/core/config'`.
 * P01 žádný takový singleton nevydává, jen `loadConfig()`. Čte se proto líně
 * a memoizovaně, stejně jako v `session.ts` a `tx/index.ts`: konfigurace
 * načtená při importu modulu by shodila každý test, který se souboru dotkne.
 */
let cachedConfig: MlainConfig | null = null;
function cfg(): MlainConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

export type SessionActor = { userId: string; sessionId: string; csrfSecret: Buffer };

/**
 * Ověří session cookie. Používají ji cesty pod /api/v1/auth/**, které se
 * k žádnému projektu nevztahují, takže nepotřebují WorkspaceContext.
 * Kompletní rozpoznání aktéra pro projektové cesty je v apps/web/src/lib/api/authenticate.ts.
 */
export async function requireSession(c: Context<ApiEnv>): Promise<SessionActor> {
  const token = readSessionCookie(c.req.header('Cookie'));
  if (!token) throw new ApiError('unauthenticated');
  const verified = await withoutContext((tx) => verifySessionToken(tx, token));
  c.set('actorType', 'user');
  c.set('actorId', verified.userId);
  return {
    userId: verified.userId,
    sessionId: verified.sessionId,
    csrfSecret: verified.csrfSecret,
  };
}

export const LoginInputSchema = z
  .object({ email: z.email(), password: z.string().min(1).max(256) })
  .strict()
  .openapi('LoginInput');

export const LoginOutputSchema = z
  .object({ user: PublicUserSchema, workspaces: z.array(WorkspaceSummarySchema) })
  .openapi('LoginOutput');

export const SessionSchema = z
  .object({
    id: z.uuid(),
    ip: z.string().nullable(),
    user_agent: z.string(),
    created_at: z.iso.datetime(),
    last_used_at: z.iso.datetime(),
    current: z.boolean(),
  })
  .openapi('Session');

export const MembershipSchema = z
  .object({ workspace_id: z.uuid(), name: z.string(), slug: z.string(), role: RoleSchema })
  .openapi('Membership');

/** Platnost zóny se ověřuje proti Intl, ne proti vlastnímu seznamu. */
function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const UpdateMeSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    locale: z
      .string()
      .refine((v) => cfg().SUPPORTED_LOCALES.includes(v), { message: 'Nepodporovaný jazyk.' })
      .optional(),
    timezone: z
      .string()
      .refine(isValidTimezone, { message: 'Neplatná časová zóna IANA.' })
      .optional(),
  })
  .strict()
  .openapi('UpdateMeInput');

export const ChangePasswordSchema = z
  .object({
    current_password: z.string().min(1).max(256),
    new_password: z.string().min(1).max(256),
  })
  .strict()
  .openapi('ChangePasswordInput');

export const RequestResetSchema = z
  .object({ email: z.email() })
  .strict()
  .openapi('PasswordResetInput');

export const ConfirmResetSchema = z
  .object({ token: z.string().min(1).max(200), new_password: z.string().min(1).max(256) })
  .strict()
  .openapi('PasswordResetConfirmInput');

const loginRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/login',
  tags: ['Auth'],
  summary: 'Přihlášení e-mailem a heslem',
  request: { body: { content: { 'application/json': { schema: LoginInputSchema } } } },
  responses: {
    200: {
      description: 'Přihlášeno, v odpovědi je cookie ml_session',
      content: { 'application/json': { schema: LoginOutputSchema } },
    },
    401: problemResponse('invalid_credentials'),
    422: problemResponse('validation_failed'),
    423: problemResponse('account_locked'),
    429: problemResponse('rate_limited'),
  },
});

const logoutRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/logout',
  tags: ['Auth'],
  summary: 'Odhlášení aktuální relace',
  responses: {
    204: { description: 'Odhlášeno' },
    401: problemResponse('unauthenticated', 'session_expired'),
  },
});

const logoutAllRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/logout-all',
  tags: ['Auth'],
  summary: 'Odhlášení ze všech zařízení včetně aktuálního',
  responses: {
    204: { description: 'Odhlášeno' },
    401: problemResponse('unauthenticated', 'session_expired'),
  },
});

const listSessionsRoute = createRoute({
  method: 'get',
  path: '/api/v1/auth/sessions',
  tags: ['Auth'],
  summary: 'Výpis aktivních relací uživatele',
  responses: {
    200: {
      description: 'Seznam relací',
      content: { 'application/json': { schema: z.object({ data: z.array(SessionSchema) }) } },
    },
    401: problemResponse('unauthenticated', 'session_expired'),
  },
});

const revokeSessionRoute = createRoute({
  method: 'delete',
  path: '/api/v1/auth/sessions/{id}',
  tags: ['Auth'],
  summary: 'Zrušení jedné vlastní relace',
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: { description: 'Zrušeno' },
    401: problemResponse('unauthenticated', 'session_expired'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const meRoute = createRoute({
  method: 'get',
  path: '/api/v1/auth/me',
  tags: ['Auth'],
  summary: 'Aktuální uživatel, jeho členství a token CSRF',
  responses: {
    200: {
      description: 'Uživatel',
      content: {
        'application/json': {
          schema: z.object({
            user: PublicUserSchema,
            memberships: z.array(MembershipSchema),
            /**
             * Požadavek P06→P04.1. Server Action nemá kudy jinudy získat token
             * pro hlavičku `X-CSRF-Token`: sekret relace je v `sessions` a ven
             * se z databáze nedostane. Bez tohohle pole je sekundární obrana
             * z 3.2 jen na papíře, protože ji nemá kdo splnit.
             *
             * Vydat token je bezpečné. Není to sekret, je to HMAC ze sekretu
             * a chrání proti tomu, aby požadavek POSLALA cizí stránka, ne proti
             * tomu, aby ho znal vlastník relace. Vydává se navíc výhradně tomu,
             * kdo už platnou relaci má: bez cookie je odpověď 401.
             */
            csrf_token: z.string(),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated', 'session_expired'),
  },
});

const updateMeRoute = createRoute({
  method: 'patch',
  path: '/api/v1/auth/me',
  tags: ['Auth'],
  summary: 'Změna vlastního profilu',
  request: { body: { content: { 'application/json': { schema: UpdateMeSchema } } } },
  responses: {
    200: {
      description: 'Změněno',
      content: { 'application/json': { schema: z.object({ user: PublicUserSchema }) } },
    },
    401: problemResponse('unauthenticated', 'session_expired'),
    422: problemResponse('validation_failed'),
  },
});

const changePasswordRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/change-password',
  tags: ['Auth'],
  summary: 'Změna vlastního hesla',
  request: { body: { content: { 'application/json': { schema: ChangePasswordSchema } } } },
  responses: {
    204: { description: 'Změněno, ostatní relace jsou revokované' },
    401: problemResponse('unauthenticated', 'invalid_credentials', 'session_expired'),
    422: problemResponse('validation_failed'),
  },
});

const requestResetRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/password-reset',
  tags: ['Auth'],
  summary: 'Vyžádání odkazu na obnovu hesla',
  description:
    'Vrací vždy 202 bez ohledu na existenci účtu. Odpověď ani její latence neprozrazují, jestli účet existuje.',
  request: { body: { content: { 'application/json': { schema: RequestResetSchema } } } },
  responses: {
    202: { description: 'Přijato' },
    422: problemResponse('validation_failed'),
    429: problemResponse('rate_limited'),
  },
});

const confirmResetRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/password-reset/confirm',
  tags: ['Auth'],
  summary: 'Nastavení nového hesla podle tokenu z e-mailu',
  request: { body: { content: { 'application/json': { schema: ConfirmResetSchema } } } },
  responses: {
    204: { description: 'Heslo nastaveno, všechny relace jsou revokované' },
    401: problemResponse('unauthenticated'),
    422: problemResponse('validation_failed'),
  },
});

export function registerAuthRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(loginRoute, async (c) => {
    const input = c.req.valid('json');
    const result = await login({
      email: input.email,
      password: input.password,
      ip: c.get('clientIp'),
      userAgent: c.req.header('User-Agent') ?? '',
      requestId: c.get('requestId'),
    });

    c.header(
      'Set-Cookie',
      serializeSessionCookie(result.token, {
        secure: isSecureCookieContext(),
        maxAgeSeconds: sessionMaxAgeSeconds(),
      }),
    );
    c.set('actorType', 'user');
    c.set('actorId', result.user.id);
    return c.json({ user: result.user, workspaces: result.workspaces }, 200);
  });

  app.openapi(logoutRoute, async (c) => {
    const actor = await requireSession(c);
    await withoutContext(async (tx) => {
      await revokeSession(tx, actor.sessionId, 'logout');
      await writeAuditLog(tx, {
        action: IdentityAuditActions['user.logout'],
        workspaceId: null,
        actor: { actorType: 'user', actorId: actor.userId, actorLabel: '' },
        ip: c.get('clientIp'),
        userAgent: c.req.header('User-Agent') ?? null,
        requestId: c.get('requestId'),
      });
    });
    c.header('Set-Cookie', clearSessionCookie({ secure: isSecureCookieContext() }));
    return c.body(null, 204);
  });

  app.openapi(logoutAllRoute, async (c) => {
    const actor = await requireSession(c);
    // Bez výjimky: kritérium 18 vyžaduje, aby přestala platit i aktuální cookie.
    await withoutContext(async (tx) => {
      await revokeUserSessions(tx, actor.userId, 'logout_all');
      await writeAuditLog(tx, {
        action: IdentityAuditActions['user.logout'],
        workspaceId: null,
        actor: { actorType: 'user', actorId: actor.userId, actorLabel: '' },
        ip: c.get('clientIp'),
        userAgent: c.req.header('User-Agent') ?? null,
        requestId: c.get('requestId'),
        metadata: { scope: 'all_devices' },
      });
    });
    c.header('Set-Cookie', clearSessionCookie({ secure: isSecureCookieContext() }));
    return c.body(null, 204);
  });

  app.openapi(listSessionsRoute, async (c) => {
    const actor = await requireSession(c);
    const rows = await withoutContext((tx) => listUserSessions(tx, actor.userId));
    return c.json(
      {
        data: rows.map((r) => ({
          id: r.id,
          ip: r.ip === null ? null : String(r.ip),
          user_agent: r.user_agent,
          created_at: new Date(r.created_at).toISOString(),
          last_used_at: new Date(r.last_used_at).toISOString(),
          current: r.id === actor.sessionId,
        })),
      },
      200,
    );
  });

  app.openapi(revokeSessionRoute, async (c) => {
    const actor = await requireSession(c);
    const { id } = c.req.valid('param');
    // Cizí relace je pro aktéra neexistující zdroj, tedy 404, ne 403 (3.4).
    const revoked = await withoutContext((tx) =>
      tx
        .update(schema.sessions)
        .set({ revokedAt: new Date(), revokedReason: 'admin_action' })
        .where(
          and(
            eq(schema.sessions.id, id),
            eq(schema.sessions.userId, actor.userId),
            isNull(schema.sessions.revokedAt),
          ),
        )
        .returning({ id: schema.sessions.id }),
    );
    if (revoked.length === 0) throw new ApiError('not_found');
    return c.body(null, 204);
  });

  app.openapi(meRoute, async (c) => {
    const actor = await requireSession(c);
    const [user] = await withoutContext((tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, actor.userId)).limit(1),
    );
    if (!user) throw new ApiError('unauthenticated');
    const workspaces = await listWorkspacesOfUser(actor.userId);
    return c.json(
      {
        user: toPublicUser(user),
        memberships: workspaces.map((w) => ({
          workspace_id: w.id,
          name: w.name,
          slug: w.slug,
          role: w.role,
        })),
        csrf_token: csrfTokenFor(actor.csrfSecret),
      },
      200,
    );
  });

  app.openapi(updateMeRoute, async (c) => {
    const actor = await requireSession(c);
    const input = c.req.valid('json');
    // PATCH: chybějící klíč znamená neměnit. Prázdný objekt je platný request.
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.locale !== undefined) patch.locale = input.locale;
    if (input.timezone !== undefined) patch.timezone = input.timezone;

    const [user] = await withoutContext((tx) =>
      tx.update(schema.users).set(patch).where(eq(schema.users.id, actor.userId)).returning(),
    );
    if (!user) throw new ApiError('unauthenticated');
    return c.json({ user: toPublicUser(user) }, 200);
  });

  app.openapi(changePasswordRoute, async (c) => {
    const actor = await requireSession(c);
    const input = c.req.valid('json');
    const [user] = await withoutContext((tx) =>
      tx
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, actor.userId))
        .limit(1),
    );
    if (!user) throw new ApiError('unauthenticated');

    await changePassword({
      userId: actor.userId,
      email: user.email,
      currentSessionId: actor.sessionId,
      currentPassword: input.current_password,
      newPassword: input.new_password,
      ip: c.get('clientIp'),
      userAgent: c.req.header('User-Agent') ?? '',
      requestId: c.get('requestId'),
    });
    return c.body(null, 204);
  });

  app.openapi(requestResetRoute, async (c) => {
    const input = c.req.valid('json');
    await requestPasswordReset({
      email: input.email,
      ip: c.get('clientIp'),
      userAgent: c.req.header('User-Agent') ?? '',
      requestId: c.get('requestId'),
    });
    return c.body(null, 202);
  });

  app.openapi(confirmResetRoute, async (c) => {
    const input = c.req.valid('json');
    await confirmPasswordReset({
      token: input.token,
      newPassword: input.new_password,
      ip: c.get('clientIp'),
      userAgent: c.req.header('User-Agent') ?? '',
      requestId: c.get('requestId'),
    });
    return c.body(null, 204);
  });
}
