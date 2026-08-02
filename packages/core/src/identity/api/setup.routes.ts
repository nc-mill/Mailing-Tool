import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { runSetup } from '../setup';
import { isSecureCookieContext, serializeSessionCookie, sessionMaxAgeSeconds } from '../session';
import { problemResponse, PublicUserSchema, type ApiEnv } from './schemas';

export const SetupInputSchema = z
  .object({
    email: z.email(),
    password: z.string().min(1).max(256),
    name: z.string().max(200).optional(),
    workspace_name: z.string().min(1).max(200),
    locale: z.string().max(20).optional(),
  })
  .strict()
  .openapi('SetupInput');

export const SetupOutputSchema = z
  .object({
    user: PublicUserSchema,
    workspace: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
  })
  .openapi('SetupOutput');

const setupRoute = createRoute({
  method: 'post',
  path: '/api/v1/setup',
  tags: ['Setup'],
  summary: 'První spuštění instalace',
  description: 'Dostupné jen dokud instalace nemá jediného uživatele. Pak vrací 409.',
  request: { body: { content: { 'application/json': { schema: SetupInputSchema } } } },
  responses: {
    201: {
      description: 'Instalace nastavena',
      content: { 'application/json': { schema: SetupOutputSchema } },
    },
    409: problemResponse('setup_already_completed'),
    422: problemResponse('validation_failed'),
    429: problemResponse('rate_limited'),
  },
});

export function registerSetupRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(setupRoute, async (c) => {
    const input = c.req.valid('json');
    const result = await runSetup({
      email: input.email,
      password: input.password,
      name: input.name,
      workspace_name: input.workspace_name,
      locale: input.locale,
      ip: c.get('clientIp'),
      userAgent: c.req.header('User-Agent') ?? '',
      requestId: c.get('requestId'),
    });
    // Průvodce uživatele zakládá, takže ho rovnou přihlásí. Bez tohohle by
    // instalace proběhla, přesměrovala na projekt a uživatel by tam našel
    // přihlašovací formulář, hned po tom, co si nastavil heslo.
    c.header(
      'Set-Cookie',
      serializeSessionCookie(result.token, {
        secure: isSecureCookieContext(),
        maxAgeSeconds: sessionMaxAgeSeconds(),
      }),
    );
    c.set('actorType', 'user');
    c.set('actorId', result.user.id);

    // Token se do těla odpovědi NEPOSÍLÁ. Patří výhradně do cookie s `HttpOnly`,
    // odkud ho JavaScript nepřečte. V těle by skončil v paměti prohlížeče,
    // v historii požadavků a případně i v logu, což je zbytečná cesta k relaci.
    // `token` se do těla NEPOSÍLÁ, patří výhradně do cookie s `HttpOnly`.
    // V těle by skončil v paměti prohlížeče, v historii požadavků a v logu.
    const body = { user: result.user, workspace: result.workspace };
    return c.json(body, 201);
  });
}
