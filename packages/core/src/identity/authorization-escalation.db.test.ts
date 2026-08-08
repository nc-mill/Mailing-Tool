/**
 * Povýšení sebe sama, tři cesty k roli a klíč se scopy nad rámec vydávajícího.
 *
 * Nálezy N2 (vysoký), N3 (vysoký) a N6 (střední) z revize 8. 8. 2026. Každý
 * případ je tu ZE DVOU STRAN: útok neprojde A legitimní práce projde dál.
 * Bez druhé strany by test dokazoval jen to, že se dá všechno zakázat.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '@mlain/db/schema';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, withWorkspace, withoutContext } from '../tx';
import { ApiError } from '../errors/api-error';
import { setSystemMailer } from '../platform/system-mail';
import { createWorkspaceContext } from './context';
import { hashPassword } from './password';
import { createWorkspace } from './workspace-service';
import { changeMemberRole, listMembers } from './membership-service';
import { createInvitation } from './invitation-service';
import { createMember } from './member-create';
import { createApiKey, rotateApiKey } from './api-key-service';
import { assertInstallationAdmin } from './user-delete';
import { registerMemberRoutes } from './api/members.routes';
import type { ApiEnv } from './api/schemas';
import type { Role, WorkspaceContext } from './types';

const PASSWORD = 'dostatecne-dlouhe-heslo';

let harness: PgHarness;
let ownerId = '';
let ownerEmail = '';
let ownerCtx: WorkspaceContext;
let adminId = '';
let adminEmail = '';
let adminCtx: WorkspaceContext;

async function makeUser(prefix: string): Promise<{ id: string; email: string }> {
  const id = uuidv7();
  const email = `${prefix}-${id}@example.cz`;
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      id,
      email,
      passwordHash: await hashPassword(PASSWORD),
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });
  return { id, email };
}

/** Člen s danou rolí a jeho SKUTEČNÝ kontext z továrny, ne podvržený. */
async function addMember(
  ctx: WorkspaceContext,
  prefix: string,
  role: Role,
): Promise<{ id: string; email: string; ctx: WorkspaceContext }> {
  const user = await makeUser(prefix);
  await withWorkspace(ctx, async (tx) => {
    await tx
      .insert(schema.memberships)
      .values({ workspaceId: ctx.workspaceId, userId: user.id, role });
  });
  const memberCtx = await createWorkspaceContext({
    kind: 'session',
    userId: user.id,
    workspaceRef: ctx.workspaceId,
  });
  return { ...user, ctx: memberCtx };
}

/** Bez odesílacího účtu skončí každá pozvánka na `system_mail_unavailable`. */
async function seedSystemMailAccount(ctx: WorkspaceContext): Promise<void> {
  await withWorkspace(ctx, (tx) =>
    tx.execute(sql`
      INSERT INTO sending_providers
        (workspace_id, name, type, config_encrypted, config_public, status, is_default)
      VALUES (${ctx.workspaceId}::uuid, 'SMTP pro testy', 'smtp', 'enc:test', '{}'::jsonb,
              'ready', true)
    `),
  );
}

beforeAll(async () => {
  harness = await startPgHarness();
  const owner = await makeUser('esk-owner');
  ownerId = owner.id;
  ownerEmail = owner.email;
  const created = await createWorkspace(ownerId, ownerEmail, { name: `Eskalace ${Date.now()}` });
  ownerCtx = await createWorkspaceContext({
    kind: 'session',
    userId: ownerId,
    workspaceRef: created.workspace.id,
  });
  await seedSystemMailAccount(ownerCtx);
  setSystemMailer({ async send() {} });

  const admin = await addMember(ownerCtx, 'esk-admin', 'admin');
  adminId = admin.id;
  adminEmail = admin.email;
  adminCtx = admin.ctx;
}, 180_000);

afterAll(async () => {
  setSystemMailer(null);
  await closePools();
  await harness?.stop();
}, 120_000);

describe('N2: admin se nepovýší na vlastníka', () => {
  it('změnou vlastní role neprojde a role zůstane admin', async () => {
    await expect(
      withWorkspace(adminCtx, (tx) =>
        changeMemberRole(tx, adminCtx, { userId: adminId, role: 'owner' }, adminEmail),
      ),
    ).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
      params: { reason: 'owner_role_only_via_transfer' },
    });

    const members = await withWorkspace(ownerCtx, (tx) => listMembers(tx, ownerCtx));
    expect(members.find((m) => m.user_id === adminId)?.role).toBe('admin');
    expect(members.filter((m) => m.role === 'owner')).toHaveLength(1);
  });

  it('změnou role kolegy neprojde', async () => {
    const editor = await addMember(ownerCtx, 'esk-editor-cizi', 'editor');
    await expect(
      withWorkspace(adminCtx, (tx) =>
        changeMemberRole(tx, adminCtx, { userId: editor.id, role: 'owner' }, adminEmail),
      ),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });

    const members = await withWorkspace(ownerCtx, (tx) => listMembers(tx, ownerCtx));
    expect(members.find((m) => m.user_id === editor.id)?.role).toBe('editor');
  });

  it('pozvánkou na roli vlastníka neprojde a žádná pozvánka nevznikne', async () => {
    const target = `esk-pozvany-${Date.now()}@example.cz`;
    await expect(
      withWorkspace(adminCtx, (tx) =>
        createInvitation(tx, adminCtx, { email: target, role: 'owner' }, adminEmail),
      ),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });

    const { rows } = await withWorkspace(ownerCtx, (tx) =>
      tx.execute(sql`SELECT 1 FROM invitations WHERE email = ${target}`),
    );
    expect(rows).toHaveLength(0);
  });

  it('založením člena s heslem neprojde a účet ani nevznikne', async () => {
    const target = `esk-zalozeny-${Date.now()}@example.cz`;
    await expect(
      withWorkspace(adminCtx, (tx) =>
        createMember(tx, adminCtx, { email: target, role: 'owner', password: null }, adminEmail),
      ),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });

    const { rows } = await withoutContext((tx) =>
      tx.execute(sql`SELECT 1 FROM users WHERE email = ${target}`),
    );
    expect(rows).toHaveLength(0);
  });
});

describe('N2: běžná práce admina zůstává', () => {
  it('admin pozve editora', async () => {
    const target = `esk-legit-pozvanka-${Date.now()}@example.cz`;
    const invitation = await withWorkspace(adminCtx, (tx) =>
      createInvitation(tx, adminCtx, { email: target, role: 'editor' }, adminEmail),
    );
    expect(invitation.role).toBe('editor');
  });

  it('admin přepne editora na prohlížejícího', async () => {
    const editor = await addMember(ownerCtx, 'esk-legit-role', 'editor');
    const changed = await withWorkspace(adminCtx, (tx) =>
      changeMemberRole(tx, adminCtx, { userId: editor.id, role: 'viewer' }, adminEmail),
    );
    expect(changed.role).toBe('viewer');
  });

  it('admin založí člena s heslem, a to i v roli admin', async () => {
    const target = `esk-legit-clen-${Date.now()}@example.cz`;
    const created = await withWorkspace(adminCtx, (tx) =>
      createMember(tx, adminCtx, { email: target, role: 'admin', password: null }, adminEmail),
    );
    expect(created.member.role).toBe('admin');
    expect(created.generated_password).toBeTruthy();
  });
});

describe('N2: vlastník a ochrana posledního vlastníka', () => {
  it('vlastník dál mění role až po admina', async () => {
    const member = await addMember(ownerCtx, 'esk-owner-meni', 'viewer');
    const changed = await withWorkspace(ownerCtx, (tx) =>
      changeMemberRole(tx, ownerCtx, { userId: member.id, role: 'admin' }, ownerEmail),
    );
    expect(changed.role).toBe('admin');
  });

  it('ani vlastník nedělá druhého vlastníka mimo převod vlastnictví', async () => {
    const member = await addMember(ownerCtx, 'esk-owner-druhy', 'editor');
    await expect(
      withWorkspace(ownerCtx, (tx) =>
        changeMemberRole(tx, ownerCtx, { userId: member.id, role: 'owner' }, ownerEmail),
      ),
    ).rejects.toMatchObject({
      code: 'forbidden',
      params: { reason: 'owner_role_only_via_transfer' },
    });

    const members = await withWorkspace(ownerCtx, (tx) => listMembers(tx, ownerCtx));
    expect(members.filter((m) => m.role === 'owner')).toHaveLength(1);
  });

  it('ochrana posledního vlastníka platí i pro cílovou roli vlastník', async () => {
    // Dřív se u cílové role `owner` kontrola PŘESKOČILA celá. Test drží tu
    // podmínku pryč: i tahle změna prochází ochranou, ne kolem ní.
    await expect(
      withWorkspace(ownerCtx, (tx) =>
        changeMemberRole(tx, ownerCtx, { userId: ownerId, role: 'owner' }, ownerEmail),
      ),
    ).rejects.toMatchObject({ code: 'last_owner_cannot_be_removed', status: 409 });
  });
});

describe('N3: klíč se scopy, které vydávající nemá', () => {
  it('admin nevydá klíč se scope backups:run', async () => {
    await expect(
      withWorkspace(adminCtx, (tx) =>
        createApiKey(
          tx,
          adminCtx,
          { name: 'Záloha', kind: 'secret', scopes: ['backups:run'], expires_at: null },
          adminEmail,
        ),
      ),
    ).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
      params: { reason: 'scopes_above_actor', missingScopes: ['backups:run'] },
    });
  });

  it('admin vydá klíč se scope contacts:read', async () => {
    const created = await withWorkspace(adminCtx, (tx) =>
      createApiKey(
        tx,
        adminCtx,
        { name: 'Kontakty', kind: 'secret', scopes: ['contacts:read'], expires_at: null },
        adminEmail,
      ),
    );
    expect(created.key.scopes).toEqual(['contacts:read']);
    expect(created.secret.startsWith('ml_live_')).toBe(true);
  });

  it('vlastník klíč se scope backups:run vydá dál', async () => {
    const created = await withWorkspace(ownerCtx, (tx) =>
      createApiKey(
        tx,
        ownerCtx,
        { name: 'Zálohy vlastníka', kind: 'secret', scopes: ['backups:run'], expires_at: null },
        ownerEmail,
      ),
    );
    expect(created.key.scopes).toEqual(['backups:run']);
  });

  it('klíč nevyrobí klíč se scopem, který sám nemá', async () => {
    const issuer = await withWorkspace(ownerCtx, (tx) =>
      createApiKey(
        tx,
        ownerCtx,
        { name: 'Vydávající', kind: 'secret', scopes: ['api_keys:write'], expires_at: null },
        ownerEmail,
      ),
    );
    const keyCtx = await createWorkspaceContext({
      kind: 'api_key',
      apiKeyId: issuer.key.id,
      workspaceId: ownerCtx.workspaceId,
      scopes: ['api_keys:write'],
    });

    await expect(
      withWorkspace(keyCtx, (tx) =>
        createApiKey(
          tx,
          keyCtx,
          { name: 'Vše', kind: 'secret', scopes: ['contacts:read'], expires_at: null },
          'klíč',
        ),
      ),
    ).rejects.toMatchObject({ code: 'forbidden', params: { reason: 'scopes_above_actor' } });

    // Co sám drží, to vydat smí: jinak by se omezením zablokovala i legitimní
    // obnova klíče vlastní automatizací.
    const same = await withWorkspace(keyCtx, (tx) =>
      createApiKey(
        tx,
        keyCtx,
        { name: 'Kopie', kind: 'secret', scopes: ['api_keys:write'], expires_at: null },
        'klíč',
      ),
    );
    expect(same.key.scopes).toEqual(['api_keys:write']);
  });

  it('rotace klíče se scope backups:run adminovi neprojde, vlastníkovi ano', async () => {
    const created = await withWorkspace(ownerCtx, (tx) =>
      createApiKey(
        tx,
        ownerCtx,
        { name: 'K rotaci', kind: 'secret', scopes: ['backups:run'], expires_at: null },
        ownerEmail,
      ),
    );

    await expect(
      withWorkspace(adminCtx, (tx) =>
        rotateApiKey(tx, adminCtx, { id: created.key.id, graceSeconds: 0 }, adminEmail),
      ),
    ).rejects.toMatchObject({ code: 'forbidden', params: { reason: 'scopes_above_actor' } });

    const rotated = await withWorkspace(ownerCtx, (tx) =>
      rotateApiKey(tx, ownerCtx, { id: created.key.id, graceSeconds: 0 }, ownerEmail),
    );
    expect(rotated.secret).not.toBe(created.secret);

    // Klíč, na který admin dosáhne, rotuje dál. Bez tohohle případu by opravou
    // přestala fungovat správa klíčů úplně.
    const ordinary = await withWorkspace(adminCtx, (tx) =>
      createApiKey(
        tx,
        adminCtx,
        { name: 'Běžný', kind: 'secret', scopes: ['contacts:read'], expires_at: null },
        adminEmail,
      ),
    );
    const ordinaryRotated = await withWorkspace(adminCtx, (tx) =>
      rotateApiKey(tx, adminCtx, { id: ordinary.key.id, graceSeconds: 0 }, adminEmail),
    );
    expect(ordinaryRotated.secret).not.toBe(ordinary.secret);
  });
});

describe('N6: účty celé instalace patří správci instalace', () => {
  it('admin projektu, který nikde nevlastní projekt, neprojde', async () => {
    await expect(assertInstallationAdmin(adminCtx)).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
      params: { reason: 'installation_admin_only' },
    });
  });

  it('vlastník projektu projde', async () => {
    await expect(assertInstallationAdmin(ownerCtx)).resolves.toBeUndefined();
  });

  it('klíč neprojde, ani kdyby měl members:remove', async () => {
    const keyCtx = await createWorkspaceContext({
      kind: 'api_key',
      apiKeyId: uuidv7(),
      workspaceId: ownerCtx.workspaceId,
      scopes: ['members:remove'],
    });
    await expect(assertInstallationAdmin(keyCtx)).rejects.toMatchObject({
      code: 'forbidden',
      params: { reason: 'installation_admin_only' },
    });
  });

  /**
   * Trasa, ne jen pomocná funkce. Exportovaná závora, kterou nikdo nezavolá,
   * je závora jen na papíře, a přesně tak N6 vznikl: trasa se spokojila
   * s `members:remove`. Obal dělá v malém totéž, co kostra z P04, kterou
   * `packages/core` importovat nesmí: naplní `auth` a přeloží `ApiError`.
   */
  function membersApp(auth: { ctx: WorkspaceContext; label: string }): OpenAPIHono<ApiEnv> {
    const instance = new OpenAPIHono<ApiEnv>();
    instance.use('*', async (c, next) => {
      c.set('requestId', uuidv7());
      c.set('clientIp', '192.0.2.10');
      c.set('auth', auth);
      await next();
    });
    instance.onError((error, c) => {
      if (error instanceof ApiError) {
        return c.json(
          { code: error.code, params: error.params ?? {}, request_id: 'test' },
          error.status as 400,
        );
      }
      throw error;
    });
    registerMemberRoutes(instance);
    return instance;
  }

  it('trasa GET /api/v1/users/orphaned vrací adminovi projektu 403, vlastníkovi 200', async () => {
    const forAdmin = await membersApp({ ctx: adminCtx, label: adminEmail }).request(
      '/api/v1/users/orphaned',
    );
    expect(forAdmin.status).toBe(403);
    expect(await forAdmin.json()).toMatchObject({
      code: 'forbidden',
      params: { reason: 'installation_admin_only' },
    });

    const forOwner = await membersApp({ ctx: ownerCtx, label: ownerEmail }).request(
      '/api/v1/users/orphaned',
    );
    expect(forOwner.status).toBe(200);
    expect(Array.isArray((await forOwner.json()).data)).toBe(true);
  });

  it('trasa DELETE /api/v1/users/{id} vrací adminovi projektu 403', async () => {
    const ghost = await makeUser('esk-duch');
    const res = await membersApp({ ctx: adminCtx, label: adminEmail }).request(
      `/api/v1/users/${ghost.id}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ params: { reason: 'installation_admin_only' } });

    // Účet zůstal, tedy se závora zastavila PŘED mazáním, ne až po něm.
    const { rows } = await withoutContext((tx) =>
      tx.execute(sql`SELECT deleted_at FROM users WHERE id = ${ghost.id}::uuid`),
    );
    expect(rows[0]).toMatchObject({ deleted_at: null });
  });

  it('admin, který je jinde vlastníkem, projde: je to táž závora jako u zakládání projektů', async () => {
    const elsewhere = await createWorkspace(adminId, adminEmail, {
      name: `Vlastní projekt admina ${Date.now()}`,
    });
    expect(elsewhere.role).toBe('owner');
    await expect(assertInstallationAdmin(adminCtx)).resolves.toBeUndefined();
  });
});
