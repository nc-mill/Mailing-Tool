import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { loadConfig } from '../../config';
import { ApiError } from '../../errors/api-error';
import { problemResponse, type ApiEnv } from '../../identity/api/schemas';
import { assertPermission } from '../../identity/permissions';
import { listBackups, runBackup } from '../backup';
import { readManifest } from '../backup-manifest';
import { keyringEnvFromConfig, loadOpsKeyring } from '../keyring';

const TAG = 'Zálohy';

/**
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán psal endpointy jako soubory
 * `route.ts` v App Routeru s `defineRoute` a `requirePermission` z `@/lib/api`.
 * Ani jedna z těch dvou funkcí v repozitáři neexistuje: veřejné API je jeden
 * Hono router skládaný v `apps/web/src/lib/api/openapi.ts` a jednotlivé domény
 * do něj přidávají `register*Routes(app)`. Tenhle soubor tu konvenci drží,
 * shodně s `demo-data.routes.ts` a `onboarding.routes.ts`.
 *
 * ENDPOINT PRO OVĚŘENÍ ZÁLOHY TU SCHVÁLNĚ NENÍ, a jsou pro to dva důvody.
 *
 * První je provozní: `verifyBackup` zakládá dočasnou databázi, nahraje do ní
 * celý dump, přehraje migrace a spočítá řádky. U reálné instalace to trvá
 * minuty. Držet na tom otevřený HTTP požadavek je špatný tvar bez ohledu
 * na bundlery.
 *
 * Druhý je tvrdý: `backup-verify.ts` potřebuje migrační runner a ten si
 * skládá cestu k migracím přes `new URL('../migrations', import.meta.url)`.
 * Turbopack tu cestu neumí vyhodnotit a **dynamický import nestačí**, protože
 * modul stejně zůstane v grafu a bundler ho resolvuje. Jakmile se
 * `backup-verify.ts` dostane do grafu aplikace, vrací 500 KAŽDÁ stránka,
 * ne jen zálohy. Ověřeno v prohlížeči na `/cs/w/.../campaigns`.
 *
 * Ověřování proto zůstává tam, kde stejně patří: `mlain backup verify`
 * a týdenní úloha `platform.backup_verify`, obojí mimo webový proces.
 */

const EntrySchema = z
  .object({
    name: z.string(),
    createdAt: z.string(),
    bytes: z.number().int().nonnegative(),
    contacts: z.number().int().nonnegative(),
    verifiedAt: z.string().nullable(),
    verifiedOk: z.boolean().nullable(),
  })
  .openapi('BackupEntry');

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/backups',
  tags: [TAG],
  summary: 'Seznam záloh instalace',
  security: [{ bearerAuth: ['backups:read'] }],
  responses: {
    200: {
      description: 'Zálohy od nejnovější',
      content: { 'application/json': { schema: z.object({ data: z.array(EntrySchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
  },
});

const runRoute = createRoute({
  method: 'post',
  path: '/api/v1/backups',
  tags: [TAG],
  summary: 'Spustí zálohu na vyžádání',
  security: [{ bearerAuth: ['backups:run'] }],
  request: {
    body: {
      required: false,
      content: {
        'application/json': { schema: z.object({}).strict().openapi('BackupRunInput') },
      },
    },
  },
  responses: {
    201: {
      description: 'Záloha hotová',
      content: {
        'application/json': {
          schema: z.object({
            data: z.object({ name: z.string(), contacts: z.number().int().nonnegative() }),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    415: problemResponse('unsupported_media_type'),
    503: problemResponse('service_unavailable'),
  },
});

export function registerBackupRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'backups:read');
    const config = loadConfig();
    const entries = await listBackups(config.BACKUP_DIR);
    const data = await Promise.all(
      entries.map(async (e) => {
        // Rozpracovaná záloha manifest ještě nemá. Seznam kvůli tomu nesmí
        // spadnout, jen o ní nemá co říct.
        const manifest = await readManifest(`${config.BACKUP_DIR}/${e.name}`).catch(() => null);
        return {
          name: e.name,
          createdAt: e.createdAt.toISOString(),
          bytes: manifest?.database.bytes ?? 0,
          contacts: manifest?.row_counts['contacts'] ?? 0,
          verifiedAt: null,
          verifiedOk: null,
        };
      }),
    );
    return c.json({ data }, 200);
  });

  app.openapi(runRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'backups:run');
    const config = loadConfig();
    if (!config.DATABASE_URL_MIGRATOR) {
      // Bez migrátora by pg_dump skončil chybou, nebo, kdyby to někdo
      // „opravil" přepínačem --enable-row-security, vyrobil by zálohu
      // s prázdnými chráněnými tabulkami. Proto odmítnutí, ne pokus.
      throw new ApiError('service_unavailable', { params: { reason: 'migrator_url_missing' } });
    }
    const keyring = loadOpsKeyring(keyringEnvFromConfig(config));
    const result = await runBackup({
      databaseUrl: config.DATABASE_URL_MIGRATOR,
      backupDir: config.BACKUP_DIR,
      uploadsDir: config.UPLOADS_DIR,
      appVersion: config.IMAGE_VERSION,
      secretKeyFingerprint: keyring.currentFingerprint,
      now: new Date(),
      postBackupHook: `${config.DATA_DIR}/hooks/post-backup.sh`,
    });
    return c.json(
      {
        data: {
          name: result.dir.split('/').pop() ?? '',
          contacts: result.manifest.row_counts['contacts'] ?? 0,
        },
      },
      201,
    );
  });
}
