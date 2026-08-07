// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { closePools, withWorkspace } from '@mlain/core/tx';
import { createWorkspaceContext } from '@mlain/core/identity/context';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { registerMemberRoutes } from '@mlain/core/identity/api/members.routes';
import { registerInvitationRoutes } from '@mlain/core/identity/api/invitations.routes';
import { __lastInvitationTokenForTests } from '@mlain/core/identity/invitation-service';
import { setSystemMailer } from '@mlain/core/platform/system-mail';
import { registerSystemMailRoutes } from '@mlain/core/platform/api/system-mail.routes';
import { startPgHarness, type PgHarness } from './pg-harness';
import { createTestApp, type TestApp } from './helpers/app';
import { seedOwnerWithWorkspace, seedSmtpAccount, TEST_PASSWORD } from './helpers/seed';

let harness: PgHarness;
let app: TestApp;

let owner: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;
let guest: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;

const asOwner = (extra: Record<string, string> = {}) => ({
  Cookie: owner.cookie,
  'X-Workspace-Id': owner.workspaceId,
  'Content-Type': 'application/json',
  ...extra,
});

beforeAll(async () => {
  harness = await startPgHarness();
  process.env['TRUST_PROXY'] = '1';
  app = await createTestApp(
    registerAuthRoutes,
    registerMemberRoutes,
    registerInvitationRoutes,
    registerSystemMailRoutes,
  );

  owner = await seedOwnerWithWorkspace(app, 'owner');
  guest = await seedOwnerWithWorkspace(app, 'owner');

  /**
   * Projekt zvoucího dostane odesílací účet typu SMTP.
   *
   * `POST /api/v1/invitations` od opravy vady se systémovou poštou odmítne
   * založit pozvánku v projektu, který ji nemá jak odeslat, a vrátí 503
   * `system_mail_unavailable`. Bez tohohle účtu by na tom skončil každý test
   * pozvánek. Projekt `guest` účet ZÁMĚRNĚ nedostane, aby se dalo ověřit i to
   * odmítnutí. Skutečné odesílání nahrazuje `setSystemMailer`, aby test
   * nechodil na síť.
   */
  await seedSmtpAccount(owner.userId, owner.workspaceId);
  setSystemMailer({ async send() {} });
}, 180_000);

afterAll(async () => {
  setSystemMailer(null);
  await closePools();
  await harness?.stop();
}, 120_000);

describe('kritérium 22: poslední owner', () => {
  it('odebrání posledního ownera vrací 409 a členství zůstane beze změny', async () => {
    const res = await app.request(`/api/v1/members/${owner.userId}`, {
      method: 'DELETE',
      headers: asOwner(),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('last_owner_cannot_be_removed');

    const list = await (await app.request('/api/v1/members', { headers: asOwner() })).json();
    expect(list.data.find((m: { user_id: string }) => m.user_id === owner.userId).role).toBe(
      'owner',
    );
  });

  it('změna role posledního ownera vrací 409', async () => {
    const res = await app.request(`/api/v1/members/${owner.userId}`, {
      method: 'PATCH',
      headers: asOwner(),
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('last_owner_cannot_be_removed');
  });
});

describe('pozvánky', () => {
  it('vytvoření pozvánky vrací 201 a token nikdy není v odpovědi', async () => {
    const res = await app.request('/api/v1/invitations', {
      method: 'POST',
      headers: asOwner({ 'Idempotency-Key': 'inv-key-001' }),
      body: JSON.stringify({ email: guest.email, role: 'editor' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.invitation.email).toBe(guest.email);
    expect(JSON.stringify(body)).not.toContain(__lastInvitationTokenForTests() ?? 'nic');
  });

  it('pozvání existujícího člena vrací 409 already_member', async () => {
    const res = await app.request('/api/v1/invitations', {
      method: 'POST',
      headers: asOwner({ 'Idempotency-Key': 'inv-key-002' }),
      body: JSON.stringify({ email: owner.email, role: 'editor' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).params.reason).toBe('already_member');
  });

  it('opakované pozvání téhož e-mailu revokuje předchozí a vytvoří novou', async () => {
    const target = `dvakrat-${Date.now()}@example.cz`;
    await app.request('/api/v1/invitations', {
      method: 'POST',
      headers: asOwner({ 'Idempotency-Key': 'inv-key-003' }),
      body: JSON.stringify({ email: target, role: 'viewer' }),
    });
    const first = __lastInvitationTokenForTests();

    const second = await app.request('/api/v1/invitations', {
      method: 'POST',
      headers: asOwner({ 'Idempotency-Key': 'inv-key-004' }),
      body: JSON.stringify({ email: target, role: 'editor' }),
    });
    expect(second.status).toBe(201);
    expect(__lastInvitationTokenForTests()).not.toBe(first);

    const accepted = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { Cookie: guest.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: first }),
    });
    expect(accepted.status).toBe(404);
  });

  it('přijetí pozvánky založí členství v deklarované roli', async () => {
    const target = `prijmu-${Date.now()}@example.cz`;
    await app.request('/api/v1/invitations', {
      method: 'POST',
      headers: asOwner({ 'Idempotency-Key': 'inv-key-005' }),
      body: JSON.stringify({ email: target, role: 'editor' }),
    });

    const res = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { Cookie: guest.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: __lastInvitationTokenForTests() }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('editor');
    expect(body.workspace.id).toBe(owner.workspaceId);
  });

  it('pozvánka je jednorázová, druhé přijetí vrací 404', async () => {
    const target = `jednorazova-${Date.now()}@example.cz`;
    await app.request('/api/v1/invitations', {
      method: 'POST',
      headers: asOwner({ 'Idempotency-Key': 'inv-key-006' }),
      body: JSON.stringify({ email: target, role: 'viewer' }),
    });
    const token = __lastInvitationTokenForTests();
    const other = await seedOwnerWithWorkspace(app, 'owner');

    await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { Cookie: other.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const second = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { Cookie: other.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(second.status).toBe(404);
  });

  it('neplatný token vrací 404, ne 401, aby nešlo poznat existenci pozvánky', async () => {
    const res = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { Cookie: guest.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'AQQHCg0QExYZHB8iJSgrLjE0Nzo9QENGSUxPUlVYW14' }),
    });
    expect(res.status).toBe(404);
  });

  it('revokace pozvánky vrací 204', async () => {
    const target = `revokace-${Date.now()}@example.cz`;
    const created = await (
      await app.request('/api/v1/invitations', {
        method: 'POST',
        headers: asOwner({ 'Idempotency-Key': 'inv-key-007' }),
        body: JSON.stringify({ email: target, role: 'viewer' }),
      })
    ).json();

    const res = await app.request(`/api/v1/invitations/${created.invitation.id}`, {
      method: 'DELETE',
      headers: asOwner(),
    });
    expect(res.status).toBe(204);
  });
});

/**
 * Založení člena rovnou, bez pozvánky e-mailem.
 *
 * Je to náhradní cesta pro instalace, které systémovou poštu odeslat neumí.
 * Test proto jde až na konec: účet musí opravdu vzniknout, mít deklarovanou
 * roli a MUSÍ SE S NÍM DÁT PŘIHLÁSIT. Bez posledního kroku by prošel i účet
 * s heslem, které nikdo nezná.
 */
describe('člen založený rovnou, s heslem', () => {
  it('vygenerované heslo se vrátí jednou a účet se s ním přihlásí', async () => {
    const email = `primy-${Date.now()}@example.cz`;
    const res = await app.request('/api/v1/members', {
      method: 'POST',
      headers: asOwner(),
      body: JSON.stringify({ email, role: 'editor' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.member.email).toBe(email);
    expect(body.member.role).toBe('editor');
    expect(body.password_set).toBe(true);
    expect(typeof body.generated_password).toBe('string');
    expect(body.generated_password.length).toBeGreaterThanOrEqual(12);

    const list = await (await app.request('/api/v1/members', { headers: asOwner() })).json();
    expect(list.data.find((m: { email: string }) => m.email === email).role).toBe('editor');

    const login = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.41.0.11' },
      body: JSON.stringify({ email, password: body.generated_password }),
    });
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('ml_session=');

    // Do auditu jde, kdo účet založil a s jakou rolí. Heslo samo tam není.
    // `audit_log` má politiku `ws_isolation_audit`, takže se čte jen s kontextem
    // projektu. Bez něj by dotaz vrátil nula řádků a test by tvrdil, že záznam
    // není, ačkoli je.
    const auditCtx = await createWorkspaceContext({
      kind: 'session',
      userId: owner.userId,
      workspaceRef: owner.workspaceId,
    });
    const audit = await withWorkspace(auditCtx, async (tx) => {
      const { rows } = await tx.execute<{ metadata: Record<string, unknown> }>(sql`
        SELECT metadata FROM audit_log
         WHERE workspace_id = ${owner.workspaceId}::uuid AND action = 'member.created'
         ORDER BY created_at DESC LIMIT 1
      `);
      return rows[0]!;
    });
    expect(audit.metadata['email']).toBe(email);
    expect(audit.metadata['role']).toBe('editor');
    expect(audit.metadata['credential_origin']).toBe('generated');
    expect(JSON.stringify(audit.metadata)).not.toContain(body.generated_password);
  });

  it('vlastní heslo projde toutéž politikou jako při instalaci', async () => {
    const local = `slabe-${Date.now()}`;
    const res = await app.request('/api/v1/members', {
      method: 'POST',
      headers: asOwner(),
      // Heslo nese část adresy před zavináčem, což `assertPasswordPolicy`
      // odmítá stejně při instalaci jako tady. Žádná měkčí pravidla pro účty
      // zakládané správcem neexistují.
      body: JSON.stringify({
        email: `${local}@example.cz`,
        role: 'viewer',
        password: `${local}-heslo`,
      }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('validation_failed');
    expect(body.errors[0].code).toBe('password_contains_email');
  });

  it('druhé založení téhož člena vrací 409 already_member, ne druhý účet', async () => {
    const email = `dvakrat-primy-${Date.now()}@example.cz`;
    const first = await app.request('/api/v1/members', {
      method: 'POST',
      headers: asOwner(),
      body: JSON.stringify({ email, role: 'viewer' }),
    });
    expect(first.status).toBe(201);

    const second = await app.request('/api/v1/members', {
      method: 'POST',
      headers: asOwner(),
      body: JSON.stringify({ email, role: 'viewer' }),
    });
    expect(second.status).toBe(409);
    expect((await second.json()).params.reason).toBe('already_member');
  });

  it('existujícímu účtu se heslo nemění, jen přibude členství', async () => {
    const other = await seedOwnerWithWorkspace(app, 'owner');
    const res = await app.request('/api/v1/members', {
      method: 'POST',
      headers: asOwner(),
      body: JSON.stringify({ email: other.email, role: 'viewer' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.password_set).toBe(false);
    expect(body.generated_password).toBeNull();

    // Původní heslo pořád platí. Kdyby ho správce cizího projektu přepsal,
    // převzal by tím účet člověka odjinud.
    const login = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.41.0.12' },
      body: JSON.stringify({ email: other.email, password: TEST_PASSWORD }),
    });
    expect(login.status).toBe(200);
  });
});

/**
 * Systémová pošta. Projekt `guest` odesílací účet nemá, takže z něj pozvánka
 * odejít nemůže a API to musí říct DŘÍV, než pozvánka vznikne.
 */
describe('systémová pošta blokuje pozvánku, ne založení člena', () => {
  const asGuest = () => ({
    Cookie: guest.cookie,
    'X-Workspace-Id': guest.workspaceId,
    'Content-Type': 'application/json',
  });

  it('stav systémové pošty hlásí chybějící účet a adresu odesílatele', async () => {
    const res = await app.request('/api/v1/system-mail/status', { headers: asGuest() });
    expect(res.status).toBe(200);
    const { system_mail } = await res.json();
    expect(system_mail.available).toBe(false);
    expect(system_mail.reason).toBe('no_account');
    expect(system_mail.from_source).toBe('app_url');
    expect(system_mail.from_address).toMatch(/^mlain@/);
    expect(system_mail.capable_types).toEqual(['smtp', 'ses']);
  });

  it('pozvánka v projektu bez pošty vrací 503 a nezaloží se', async () => {
    const target = `bez-posty-${Date.now()}@example.cz`;
    const res = await app.request('/api/v1/invitations', {
      method: 'POST',
      headers: { ...asGuest(), 'Idempotency-Key': `inv-key-nomail-${Date.now()}` },
      body: JSON.stringify({ email: target, role: 'viewer' }),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('system_mail_unavailable');

    const pending = await (await app.request('/api/v1/invitations', { headers: asGuest() })).json();
    expect(pending.data.map((i: { email: string }) => i.email)).not.toContain(target);
  });

  it('založení člena rovnou funguje i tam, kde pošta nejede', async () => {
    const email = `bez-posty-clen-${Date.now()}@example.cz`;
    const res = await app.request('/api/v1/members', {
      method: 'POST',
      headers: asGuest(),
      body: JSON.stringify({ email, role: 'editor' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const login = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.41.0.13' },
      body: JSON.stringify({ email, password: body.generated_password }),
    });
    expect(login.status).toBe(200);
  });
});

/**
 * Smazání uživatelského účtu.
 *
 * Rozhraní ho dosud neumělo vůbec: „Odebrat z projektu" ruší členství, ne účet,
 * takže po něm zbyl uživatel, který se pořád přihlásí a v žádném výpisu není.
 * Test proto jde celou cestou: odebrat, najít mezi osiřelými, smazat, a pak
 * ověřit, že se účet NEPŘIHLÁSÍ, jeho relace neplatí a audit zůstal.
 */
describe('smazání uživatelského účtu', () => {
  it('odebraný člen se objeví mezi účty bez projektu, smaže se a už se nepřihlásí', async () => {
    const email = `ke-smazani-${Date.now()}@example.cz`;
    const created = await (
      await app.request('/api/v1/members', {
        method: 'POST',
        headers: asOwner(),
        body: JSON.stringify({ email, role: 'viewer' }),
      })
    ).json();
    const userId = created.member.user_id;

    // Účet si otevře relaci. Po smazání nesmí platit, jinak se s otevřenou
    // kartou pohybuje po aplikaci dál.
    const login = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.42.0.11' },
      body: JSON.stringify({ email, password: created.generated_password }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
    expect((await app.request('/api/v1/auth/me', { headers: { Cookie: cookie } })).status).toBe(
      200,
    );

    // Dokud je členem, mezi osiřelými není a smazat ho nejde.
    const beforeRemoval = await (
      await app.request('/api/v1/users/orphaned', { headers: asOwner() })
    ).json();
    expect(beforeRemoval.data.map((a: { email: string }) => a.email)).not.toContain(email);

    const refused = await app.request(`/api/v1/users/${userId}`, {
      method: 'DELETE',
      headers: asOwner(),
    });
    expect(refused.status).toBe(409);
    expect((await refused.json()).params.reason).toBe('still_member');

    expect(
      (await app.request(`/api/v1/members/${userId}`, { method: 'DELETE', headers: asOwner() }))
        .status,
    ).toBe(204);

    const orphaned = await (
      await app.request('/api/v1/users/orphaned', { headers: asOwner() })
    ).json();
    expect(orphaned.data.map((a: { email: string }) => a.email)).toContain(email);

    const deleted = await app.request(`/api/v1/users/${userId}`, {
      method: 'DELETE',
      headers: asOwner(),
    });
    expect(deleted.status).toBe(204);

    // Relace neplatí okamžitě.
    expect(
      (await app.request('/api/v1/auth/me', { headers: { Cookie: cookie } })).status,
    ).toBeGreaterThanOrEqual(401);

    // Přihlásit se už nedokáže ani se správným heslem.
    const again = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.42.0.12' },
      body: JSON.stringify({ email, password: created.generated_password }),
    });
    expect(again.status).toBe(401);

    // Ze seznamu osiřelých zmizel.
    const after = await (
      await app.request('/api/v1/users/orphaned', { headers: asOwner() })
    ).json();
    expect(after.data.map((a: { email: string }) => a.email)).not.toContain(email);

    // Adresa je hned volná, takže účet jde založit znovu.
    expect(
      (
        await app.request('/api/v1/members', {
          method: 'POST',
          headers: asOwner(),
          body: JSON.stringify({ email, role: 'viewer' }),
        })
      ).status,
    ).toBe(201);

    // Audit zůstal: `member.created` o založení i `user.deleted` o smazání.
    const auditCtx = await createWorkspaceContext({
      kind: 'session',
      userId: owner.userId,
      workspaceRef: owner.workspaceId,
    });
    const actions = await withWorkspace(auditCtx, async (tx) => {
      const { rows } = await tx.execute<{ action: string; metadata: Record<string, unknown> }>(sql`
        SELECT action, metadata FROM audit_log
         WHERE workspace_id = ${owner.workspaceId}::uuid
           AND metadata->>'email' = ${email}
         ORDER BY created_at
      `);
      return rows;
    });
    expect(actions.map((a) => a.action)).toContain('member.created');
    const deletedEntry = actions.find((a) => a.action === 'user.deleted');
    expect(deletedEntry?.metadata['mode']).toBe('soft');
    expect(deletedEntry?.metadata['email']).toBe(email);
  });

  it('vlastní účet smazat nejde', async () => {
    const res = await app.request(`/api/v1/users/${owner.userId}`, {
      method: 'DELETE',
      headers: asOwner(),
    });
    // Vlastník je členem projektu, takže operace padne už na tom. Kontrola
    // „sám sebe ne" je za tím a hlídá i případ, kdy by aktér projekt neměl.
    expect(res.status).toBe(409);
  });

  it('členství ve smazaném projektu se nepočítá jako projekt', async () => {
    /**
     * Projekt se maže MĚKCE, takže po jeho smazání zůstane řádek v `memberships`,
     * který ukazuje na projekt, jenž se nikde nezobrazuje. Účet, kterému zbyla
     * jen taková členství, je z pohledu uživatele bez projektu a musí být mezi
     * osiřelými vidět. Kdyby se počítala všechna členství, zůstal by neviditelný
     * napořád: v týmu není, protože projekt neexistuje, a mezi osiřelými taky ne.
     */
    const ghost = await seedOwnerWithWorkspace(app, 'owner');

    // Kontext projektu je povinný i pro měkké smazání: `workspaces` má politiku
    // `ws_isolation_self`, takže UPDATE bez kontextu ovlivní nula řádků a test
    // by tiše měřil něco jiného. Naměřeno spuštěním.
    const ghostCtx = await createWorkspaceContext({
      kind: 'session',
      userId: ghost.userId,
      workspaceRef: ghost.workspaceId,
    });
    const smazano = await withWorkspace(ghostCtx, (tx) =>
      tx.execute(sql`
        UPDATE workspaces SET deleted_at = now(), updated_at = now()
         WHERE id = ${ghost.workspaceId}::uuid AND deleted_at IS NULL
      `),
    );
    expect(smazano.rowCount).toBe(1);

    const orphaned = await (
      await app.request('/api/v1/users/orphaned', { headers: asOwner() })
    ).json();
    expect(orphaned.data.map((a: { email: string }) => a.email)).toContain(ghost.email);
  });
});
