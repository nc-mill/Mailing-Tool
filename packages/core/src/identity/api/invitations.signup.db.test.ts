import { OpenAPIHono } from '@hono/zod-openapi';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { v7 as uuidv7 } from 'uuid';
import { ApiError } from '../../errors/api-error';
import { setSystemMailer } from '../../platform/system-mail';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import { closePools, withWorkspace, withoutContext } from '../../tx';
import { createWorkspaceContext } from '../context';
import { hashPassword } from '../password';
import { createWorkspace } from '../workspace-service';
import { __lastInvitationTokenForTests, createInvitation } from '../invitation-service';
import { resetSignupConfigCache } from '../signup';
import type { WorkspaceContext } from '../types';
import { registerInvitationRoutes } from './invitations.routes';
import type { ApiEnv } from './schemas';

/**
 * Trasa `POST /api/v1/invitations/signup` přes HTTP, ne přes službu.
 *
 * Služba má vlastní test v `identity/signup.test.ts`. Tady jde o to, co je
 * vidět jen na trase: že je zaregistrovaná, že projde BEZ RELACE (pozvaný
 * žádnou mít nemůže) a že odpověď nese relační cookie. Bez ní by se člověk
 * hned po zvolení hesla ocitl na přihlašovacím formuláři.
 *
 * Testovací obal dělá v malém totéž, co v provozu kostra z P04
 * (`apps/web/src/lib/api/app.ts`), kterou `packages/core` importovat nesmí:
 * doplní `clientIp` a `requestId` a přeloží `ApiError` na stavový kód.
 */
function app(): OpenAPIHono<ApiEnv> {
  const instance = new OpenAPIHono<ApiEnv>();
  instance.use('*', async (c, next) => {
    c.set('clientIp', '192.0.2.10');
    c.set('requestId', uuidv7());
    await next();
  });
  instance.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ code: error.code, request_id: 'test' }, error.status as 400);
    }
    throw error;
  });
  registerInvitationRoutes(instance);
  return instance;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

let harness: PgHarness;
let ownerCtx: WorkspaceContext;

beforeAll(async () => {
  harness = await startPgHarness();

  const ownerId = uuidv7();
  const ownerEmail = `route-owner-${ownerId}@example.cz`;
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      id: ownerId,
      email: ownerEmail,
      passwordHash: await hashPassword('dostatecne-dlouhe-heslo'),
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });
  const created = await createWorkspace(ownerId, ownerEmail, { name: `Trasa ${Date.now()}` });
  ownerCtx = await createWorkspaceContext({
    kind: 'session',
    userId: ownerId,
    workspaceRef: created.workspace.id,
  });
  await withWorkspace(ownerCtx, (tx) =>
    tx.execute(sql`
      INSERT INTO sending_providers
        (workspace_id, name, type, config_encrypted, config_public, status, is_default)
      VALUES (${ownerCtx.workspaceId}::uuid, 'SMTP pro testy', 'smtp', 'enc:test', '{}'::jsonb,
              'ready', true)
    `),
  );
  setSystemMailer({ async send() {} });
}, 180_000);

afterEach(() => {
  delete process.env['SIGNUP_MODE'];
  resetSignupConfigCache();
});

afterAll(async () => {
  setSystemMailer(null);
  await closePools();
  await harness?.stop();
}, 120_000);

describe('POST /api/v1/invitations/signup', () => {
  it('bez relace založí účet a vrátí relační cookie', async () => {
    const email = `trasa-${uuidv7()}@example.cz`;
    await withWorkspace(ownerCtx, (tx) =>
      createInvitation(tx, ownerCtx, { email, role: 'editor' }, 'test'),
    );
    const token = __lastInvitationTokenForTests()!;

    const response = await app().request('/api/v1/invitations/signup', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token, password: 'dostatecne-dlouhe-heslo', name: 'Jan Novák' }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      user: { email: string };
      workspace: { slug: string };
      role: string;
    };
    expect(body.user.email).toBe(email);
    expect(body.role).toBe('editor');

    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('ml_session=');
    expect(cookie).toContain('HttpOnly');
    // Relační token v těle NESMÍ být, patří výhradně do cookie.
    expect(JSON.stringify(body)).not.toContain('ml_session');
  });

  it('e-mail v těle požadavku odmítne, adresu určuje pozvánka', async () => {
    const email = `striktni-${uuidv7()}@example.cz`;
    await withWorkspace(ownerCtx, (tx) =>
      createInvitation(tx, ownerCtx, { email, role: 'editor' }, 'test'),
    );
    const token = __lastInvitationTokenForTests()!;

    const response = await app().request('/api/v1/invitations/signup', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        token,
        password: 'dostatecne-dlouhe-heslo',
        email: 'utocnik@example.cz',
      }),
    });

    // Schéma je `strict()`, takže neznámé pole požadavek shodí. Kdyby prošlo
    // a někdo ho později zapojil, založil by si držitel cizího odkazu účet
    // na svou adresu.
    expect(response.status).toBe(400);
  });

  it('neplatný token vrací 404, ne 401', async () => {
    const response = await app().request('/api/v1/invitations/signup', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: 'nikdy-neexistoval', password: 'dostatecne-dlouhe-heslo' }),
    });
    // 401 by znamenalo, že trasa chce relaci, tedy že se na ni pozvaný člověk
    // bez účtu nikdy nedostane. Přesně to byla ta slepá ulička.
    expect(response.status).toBe(404);
  });
});
