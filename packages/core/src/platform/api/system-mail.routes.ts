import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { withWorkspace } from '../../tx';
import { loadConfig } from '../../config';
import { assertPermission } from '../../identity/permissions';
import { problemResponse, type ApiEnv } from '../../identity/api/schemas';
import { getSystemMailStatus, updateSystemMailSettings } from '../system-mail-config';

/**
 * Stav a nastavení systémové pošty projektu.
 *
 * Existuje proto, aby obrazovka nemusela nabízet akci, kterou instalace neumí
 * provést, a aby uživatel na jednom místě viděl, ČÍM se systémová pošta odesílá,
 * Z JAKÉ adresy a CO chybí, když nefunguje. Pozvánka do projektu, obnova hesla
 * i ověření adresy ve zkušebním režimu jdou systémovým e-mailem, a ten potřebuje
 * použitelný odesílací účet projektu. Bez tohohle dotazu se to uživatel dozvěděl
 * až z chyby po odeslání, nebo, u obnovy hesla, vůbec.
 */

export const SystemMailAccountSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    type: z.string(),
    status: z.string(),
    is_default: z.boolean(),
    capable: z.boolean(),
    domain: z.string().nullable(),
  })
  .openapi('SystemMailAccount');

export const SystemMailSettingsSchema = z
  .object({
    provider_id: z.uuid().nullable(),
    from_address: z.string().nullable(),
  })
  .openapi('SystemMailSettings');

export const SystemMailStatusSchema = z
  .object({
    available: z.boolean(),
    reason: z.enum(['no_account', 'provider_unsupported', 'selected_account_missing']).nullable(),
    provider_id: z.uuid().nullable(),
    provider_type: z.string().nullable(),
    from_address: z.string(),
    from_source: z.enum(['configured', 'verified_domain', 'app_url']),
    capable_types: z.array(z.string()),
    settings: SystemMailSettingsSchema,
    accounts: z.array(SystemMailAccountSchema),
  })
  .openapi('SystemMailStatus');

export const UpdateSystemMailSettingsInput = z
  .object({
    provider_id: z.uuid().nullable(),
    from_address: z.string().max(320).nullable(),
  })
  .strict()
  .openapi('UpdateSystemMailSettingsInput');

const statusRoute = createRoute({
  method: 'get',
  path: '/api/v1/system-mail/status',
  tags: ['Platform'],
  summary: 'Stav systémové pošty projektu',
  description:
    'Systémové e-maily (pozvánka, obnova hesla, ověření adresy ve zkušebním režimu) odesílá ' +
    'aplikace sama, mimo rozesílku kampaní, účtem typu SES i SMTP. Projekt bez použitelného ' +
    'odesílacího účtu je odeslat nemá čím; `capable_types` říká, které typy účtů to umí.',
  security: [{ bearerAuth: ['providers:read'] }],
  responses: {
    200: {
      description: 'Stav systémové pošty',
      content: {
        'application/json': { schema: z.object({ system_mail: SystemMailStatusSchema }) },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const updateRoute = createRoute({
  method: 'put',
  path: '/api/v1/system-mail/settings',
  tags: ['Platform'],
  summary: 'Nastavení systémové pošty',
  description:
    'Účet, kterým systémová pošta chodí, a adresa odesílatele. `null` u obou znamená ' +
    '„vyber automaticky", tedy výchozí odesílací účet a adresa z jeho ověřené domény.',
  security: [{ bearerAuth: ['providers:write'] }],
  request: {
    body: { content: { 'application/json': { schema: UpdateSystemMailSettingsInput } } },
  },
  responses: {
    200: {
      description: 'Uloženo, vrací se přepočítaný stav',
      content: {
        'application/json': { schema: z.object({ system_mail: SystemMailStatusSchema }) },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

export function registerSystemMailRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(statusRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:read');
    const appUrl = loadConfig().APP_URL;
    const status = await withWorkspace(ctx, (tx) =>
      getSystemMailStatus(tx, ctx.workspaceId, appUrl),
    );
    return c.json({ system_mail: status }, 200);
  });

  app.openapi(updateRoute, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    const input = c.req.valid('json');
    const appUrl = loadConfig().APP_URL;
    const status = await withWorkspace(ctx, async (tx) => {
      await updateSystemMailSettings(tx, ctx, input, label);
      return getSystemMailStatus(tx, ctx.workspaceId, appUrl);
    });
    return c.json({ system_mail: status }, 200);
  });
}
