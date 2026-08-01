// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closePools } from '@mlain/core/tx';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { registerMemberRoutes } from '@mlain/core/identity/api/members.routes';
import { registerInvitationRoutes } from '@mlain/core/identity/api/invitations.routes';
import { __lastInvitationTokenForTests } from '@mlain/core/identity/invitation-service';
import { startPgHarness, type PgHarness } from './pg-harness';
import { createTestApp, type TestApp } from './helpers/app';
import { seedOwnerWithWorkspace } from './helpers/seed';

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
  app = await createTestApp(registerAuthRoutes, registerMemberRoutes, registerInvitationRoutes);

  owner = await seedOwnerWithWorkspace(app, 'owner');
  guest = await seedOwnerWithWorkspace(app, 'owner');
}, 180_000);

afterAll(async () => {
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
