import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import { problemResponse } from '../../identity/api/schemas';
import {
  addTrialVerifiedAddress,
  confirmTrialAddress,
  readTrialState,
  removeTrialVerifiedAddress,
  setTrialMode,
} from './trial-service';
import { verifyTrialToken } from '../trial-token';
import type { ProvidersEnv } from './index';

/**
 * Zkušební režim (část 6, 8.2.8), odpověď plánu na rozpor R2: ověření domény trvá
 * minuty až hodiny, protože se čeká na propagaci DNS. Bez zkušebního režimu se
 * v testu ani v demu nedá poslat vůbec nic.
 *
 * Cesty jsou pod stejným tagem jako zbytek nastavení odesílání a používají tatáž
 * oprávnění (`providers:read` a `providers:write`): je to nastavení projektu, ne
 * samostatná doména.
 */
const TAG = 'Sending';

const TrialAddressSchema = z
  .object({ email: z.email(), verified_at: z.string().nullable() })
  .openapi('TrialVerifiedAddress');

const TrialStateSchema = z
  .object({
    trial_mode: z.boolean(),
    trial_mode_explicit: z.boolean().nullable(),
    verified: z.array(TrialAddressSchema),
    verified_count: z.number().int(),
    max_addresses: z.number().int(),
    has_verified_domain: z.boolean(),
    /** Testovací režim u Amazonu. `null` znamená, že se stav účtu ještě nenačetl. */
    provider_sandbox: z.boolean().nullable(),
  })
  .openapi('TrialModeState');

const getTrialRoute = createRoute({
  method: 'get',
  path: '/settings/trial',
  tags: [TAG],
  summary: 'Stav zkušebního režimu a ověřené adresy',
  security: [{ bearerAuth: ['providers:read'] }],
  responses: {
    200: {
      description: 'Stav režimu, seznam adres a strop',
      content: { 'application/json': { schema: TrialStateSchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
  },
});

const patchTrialRoute = createRoute({
  method: 'patch',
  path: '/settings/trial',
  tags: [TAG],
  summary: 'Zapnutí a vypnutí zkušebního režimu',
  security: [{ bearerAuth: ['providers:write'] }],
  request: {
    body: {
      content: { 'application/json': { schema: z.object({ trial_mode: z.boolean() }).strict() } },
    },
  },
  responses: {
    200: { description: 'Uloženo', content: { 'application/json': { schema: TrialStateSchema } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const addAddressRoute = createRoute({
  method: 'post',
  path: '/settings/trial/addresses',
  tags: [TAG],
  summary: 'Přidání ověřované adresy',
  description:
    'Adresa se přidá jako nepotvrzená a na ni odejde potvrzovací odkaz. Odkaz se vrací v odpovědi jen mimo produkci.',
  security: [{ bearerAuth: ['providers:write'] }],
  request: {
    body: { content: { 'application/json': { schema: z.object({ email: z.email() }).strict() } } },
  },
  responses: {
    201: {
      description: 'Adresa čeká na potvrzení',
      content: {
        'application/json': {
          schema: z.object({
            state: TrialStateSchema,
            verification_url: z.string().nullable(),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    409: problemResponse('conflict'),
    422: problemResponse('validation_failed'),
  },
});

const removeAddressRoute = createRoute({
  method: 'delete',
  path: '/settings/trial/addresses/{email}',
  tags: [TAG],
  summary: 'Odebrání adresy ze seznamu',
  security: [{ bearerAuth: ['providers:write'] }],
  request: { params: z.object({ email: z.email() }) },
  responses: {
    200: {
      description: 'Odebráno, ve stavu je i nový zbytek stropu',
      content: { 'application/json': { schema: TrialStateSchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const confirmAddressRoute = createRoute({
  method: 'post',
  path: '/settings/trial/addresses/confirm',
  tags: [TAG],
  summary: 'Potvrzení adresy odkazem z e-mailu',
  security: [{ bearerAuth: ['providers:write'] }],
  request: {
    body: {
      content: { 'application/json': { schema: z.object({ token: z.string().min(1) }).strict() } },
    },
  },
  responses: {
    200: {
      description: 'Adresa je ověřená',
      content: {
        'application/json': { schema: z.object({ email: z.email(), state: TrialStateSchema }) },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

export function registerTrialRoutes(app: OpenAPIHono<ProvidersEnv>): void {
  app.openapi(getTrialRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:read');
    return c.json(await readTrialState(ctx), 200);
  });

  app.openapi(patchTrialRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    return c.json(await setTrialMode(ctx, c.req.valid('json').trial_mode), 200);
  });

  app.openapi(addAddressRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    // Strop `TRIAL_MAX_VERIFIED_ADDRESSES` hlídá služba a vrací 409 `conflict`
    // s důvodem `trial_max_addresses`; tady se jen předává dál.
    const result = await addTrialVerifiedAddress(ctx, c.req.valid('json').email);
    return c.json(result, 201);
  });

  app.openapi(removeAddressRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    return c.json(await removeTrialVerifiedAddress(ctx, c.req.valid('param').email), 200);
  });

  app.openapi(confirmAddressRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    const token = c.req.valid('json').token;

    // Projekt z tokenu se porovnává PŘED zápisem. Potvrzení běží pod systémovým
    // aktérem, takže by cizí token jinak zapsal do cizího projektu, i když by
    // odpověď nic neprozradila.
    const parsed = verifyTrialToken(token);
    if (!parsed.ok || parsed.workspaceId !== ctx.workspaceId) {
      throw new ApiError('not_found', {
        params: { reason: parsed.ok ? 'workspace_mismatch' : parsed.reason },
      });
    }

    const result = await confirmTrialAddress(token);
    if (!result.ok) {
      // Neplatný, poškozený i prošlý token vracejí shodně 404, aby z odpovědi
      // nešlo číst, jestli adresa v projektu existuje. Týž postup jako u pozvánek.
      throw new ApiError('not_found', { params: { reason: result.reason } });
    }
    return c.json({ email: result.email, state: await readTrialState(ctx) }, 200);
  });
}
