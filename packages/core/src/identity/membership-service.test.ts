import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '@mlain/db/schema';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, withWorkspace, withoutContext } from '../tx';
import { createWorkspaceContext } from './context';
import { hashPassword } from './password';
import { createWorkspace } from './workspace-service';
import { changeMemberRole, listMembers, removeMember } from './membership-service';
import {
  __lastInvitationTokenForTests,
  acceptInvitation,
  createInvitation,
  listInvitations,
  revokeInvitation,
} from './invitation-service';
import type { WorkspaceContext } from './types';

const PASSWORD = 'dostatecne-dlouhe-heslo';

let harness: PgHarness;
let ownerId = '';
let ownerEmail = '';
let ownerCtx: WorkspaceContext;

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

beforeAll(async () => {
  harness = await startPgHarness();
  const owner = await makeUser('clen-owner');
  ownerId = owner.id;
  ownerEmail = owner.email;
  const created = await createWorkspace(ownerId, ownerEmail, { name: `Členové ${Date.now()}` });
  ownerCtx = await createWorkspaceContext({
    kind: 'session',
    userId: ownerId,
    workspaceRef: created.workspace.id,
  });
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

describe('kritérium 22: poslední owner', () => {
  it('odebrání posledního ownera selže a členství zůstane beze změny', async () => {
    await expect(
      withWorkspace(ownerCtx, (tx) => removeMember(tx, ownerCtx, ownerId, ownerEmail)),
    ).rejects.toMatchObject({ code: 'last_owner_cannot_be_removed', status: 409 });

    const members = await withWorkspace(ownerCtx, (tx) => listMembers(tx, ownerCtx));
    expect(members.find((m) => m.user_id === ownerId)?.role).toBe('owner');
  });

  it('změna role posledního ownera selže', async () => {
    await expect(
      withWorkspace(ownerCtx, (tx) =>
        changeMemberRole(tx, ownerCtx, { userId: ownerId, role: 'admin' }, ownerEmail),
      ),
    ).rejects.toMatchObject({ code: 'last_owner_cannot_be_removed', status: 409 });
  });

  it('odebrání jiného člena projde', async () => {
    const other = await makeUser('clen-jiny');
    await withWorkspace(ownerCtx, async (tx) => {
      await tx
        .insert(schema.memberships)
        .values({ workspaceId: ownerCtx.workspaceId, userId: other.id, role: 'editor' });
    });

    await withWorkspace(ownerCtx, (tx) => removeMember(tx, ownerCtx, other.id, ownerEmail));
    const members = await withWorkspace(ownerCtx, (tx) => listMembers(tx, ownerCtx));
    expect(members.map((m) => m.user_id)).not.toContain(other.id);
  });

  it('změna role jiného člena projde a vrátí aktuální řádek', async () => {
    const other = await makeUser('clen-role');
    await withWorkspace(ownerCtx, async (tx) => {
      await tx
        .insert(schema.memberships)
        .values({ workspaceId: ownerCtx.workspaceId, userId: other.id, role: 'viewer' });
    });

    const changed = await withWorkspace(ownerCtx, (tx) =>
      changeMemberRole(tx, ownerCtx, { userId: other.id, role: 'admin' }, ownerEmail),
    );
    expect(changed.role).toBe('admin');
    expect(changed.email).toBe(other.email);
  });

  it('neexistující člen vrací not_found', async () => {
    await expect(
      withWorkspace(ownerCtx, (tx) => removeMember(tx, ownerCtx, uuidv7(), ownerEmail)),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('pozvánky', () => {
  it('vytvoření pozvánky nevrací token', async () => {
    const target = `pozvany-${Date.now()}@example.cz`;
    const invitation = await withWorkspace(ownerCtx, (tx) =>
      createInvitation(tx, ownerCtx, { email: target, role: 'editor' }, ownerEmail),
    );

    expect(invitation.email).toBe(target);
    expect(invitation.role).toBe('editor');
    const token = __lastInvitationTokenForTests();
    expect(token).toBeTruthy();
    expect(JSON.stringify(invitation)).not.toContain(token!);
  });

  it('pozvání existujícího člena vrací conflict already_member', async () => {
    await expect(
      withWorkspace(ownerCtx, (tx) =>
        createInvitation(tx, ownerCtx, { email: ownerEmail, role: 'editor' }, ownerEmail),
      ),
    ).rejects.toMatchObject({ code: 'conflict', params: { reason: 'already_member' } });
  });

  it('opakované pozvání téhož e-mailu revokuje předchozí a vytvoří novou', async () => {
    const target = `dvakrat-${Date.now()}@example.cz`;
    await withWorkspace(ownerCtx, (tx) =>
      createInvitation(tx, ownerCtx, { email: target, role: 'viewer' }, ownerEmail),
    );
    const first = __lastInvitationTokenForTests()!;

    await withWorkspace(ownerCtx, (tx) =>
      createInvitation(tx, ownerCtx, { email: target, role: 'editor' }, ownerEmail),
    );
    const second = __lastInvitationTokenForTests()!;
    expect(second).not.toBe(first);

    const guest = await makeUser('host-dvakrat');
    await expect(
      acceptInvitation({ userId: guest.id, userEmail: guest.email, token: first }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('přijetí pozvánky založí členství v deklarované roli', async () => {
    const target = `prijmu-${Date.now()}@example.cz`;
    await withWorkspace(ownerCtx, (tx) =>
      createInvitation(tx, ownerCtx, { email: target, role: 'editor' }, ownerEmail),
    );
    const token = __lastInvitationTokenForTests()!;

    // Pozvánku přijímá přihlášený uživatel s JINÝM e-mailem: pozvánka váže
    // roli, ne identitu (3.3), a do auditu se zapíše obojí.
    const guest = await makeUser('host-prijmu');
    const result = await acceptInvitation({ userId: guest.id, userEmail: guest.email, token });

    expect(result.role).toBe('editor');
    expect(result.workspace.id).toBe(ownerCtx.workspaceId);

    const members = await withWorkspace(ownerCtx, (tx) => listMembers(tx, ownerCtx));
    expect(members.find((m) => m.user_id === guest.id)?.role).toBe('editor');

    const audit = await withWorkspace(ownerCtx, async (tx) => {
      const { rows } = await tx.execute<{ metadata: Record<string, unknown> }>(sql`
        SELECT metadata FROM audit_log
         WHERE workspace_id = ${ownerCtx.workspaceId}::uuid AND action = 'member.joined'
         ORDER BY created_at DESC LIMIT 1
      `);
      return rows[0]!;
    });
    expect(audit.metadata.invited_email).toBe(target);
    expect(audit.metadata.accepted_email).toBe(guest.email);
  });

  it('pozvánka je jednorázová, druhé přijetí vrací 404', async () => {
    const target = `jednorazova-${Date.now()}@example.cz`;
    await withWorkspace(ownerCtx, (tx) =>
      createInvitation(tx, ownerCtx, { email: target, role: 'viewer' }, ownerEmail),
    );
    const token = __lastInvitationTokenForTests()!;
    const guest = await makeUser('host-jednorazova');

    await acceptInvitation({ userId: guest.id, userEmail: guest.email, token });
    await expect(
      acceptInvitation({ userId: guest.id, userEmail: guest.email, token }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('neplatný token vrací not_found, ne unauthenticated', async () => {
    const guest = await makeUser('host-neplatny');
    await expect(
      acceptInvitation({
        userId: guest.id,
        userEmail: guest.email,
        token: 'AQQHCg0QExYZHB8iJSgrLjE0Nzo9QENGSUxPUlVYW14',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('revokovanou pozvánku už nejde přijmout a zmizí z výpisu', async () => {
    const target = `revokace-${Date.now()}@example.cz`;
    const invitation = await withWorkspace(ownerCtx, (tx) =>
      createInvitation(tx, ownerCtx, { email: target, role: 'viewer' }, ownerEmail),
    );
    const token = __lastInvitationTokenForTests()!;

    await withWorkspace(ownerCtx, (tx) =>
      revokeInvitation(tx, ownerCtx, invitation.id, ownerEmail),
    );

    const pending = await withWorkspace(ownerCtx, (tx) => listInvitations(tx, ownerCtx));
    expect(pending.map((i) => i.id)).not.toContain(invitation.id);

    const guest = await makeUser('host-revokace');
    await expect(
      acceptInvitation({ userId: guest.id, userEmail: guest.email, token }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('revokace neexistující pozvánky vrací not_found', async () => {
    await expect(
      withWorkspace(ownerCtx, (tx) => revokeInvitation(tx, ownerCtx, uuidv7(), ownerEmail)),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
