import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { v7 as uuidv7 } from 'uuid';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, withWorkspace, withoutContext } from '../tx';
import { setSystemMailer } from '../platform/system-mail';
import type { ApiError } from '../errors/api-error';
import { createWorkspaceContext } from './context';
import { hashPassword } from './password';
import { createWorkspace } from './workspace-service';
import { __lastInvitationTokenForTests, createInvitation } from './invitation-service';
import { resetSignupConfigCache, signupFromInvitation } from './signup';
import type { WorkspaceContext } from './types';

/**
 * Zakládání účtu z pozvánky. Testuje se proti SKUTEČNÉ databázi, protože celý
 * postup stojí na politikách RLS: pozvánka se dá přečíst jen bez nastaveného
 * `mlain.workspace_id`, členství se dá vložit jen s ním, a kdyby se pořadí
 * obrátilo, obojí by vrátilo nula řádků a NEVRÁTILO CHYBU.
 */
let harness: PgHarness;
let ownerCtx: WorkspaceContext;

const PASSWORD = 'dostatecne-dlouhe-heslo';

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

/** Založí pozvánku a vrátí token, který by jinak odešel jen e-mailem. */
async function invite(email: string, role: 'admin' | 'editor' = 'editor'): Promise<string> {
  await withWorkspace(ownerCtx, (tx) => createInvitation(tx, ownerCtx, { email, role }, 'test'));
  return __lastInvitationTokenForTests()!;
}

const input = (token: string) => ({
  token,
  password: PASSWORD,
  name: 'Jana Nováková',
  ip: '192.0.2.10',
  userAgent: 'vitest',
  requestId: uuidv7(),
});

beforeAll(async () => {
  harness = await startPgHarness();

  const ownerId = uuidv7();
  const ownerEmail = `signup-owner-${ownerId}@example.cz`;
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      id: ownerId,
      email: ownerEmail,
      passwordHash: await hashPassword(PASSWORD),
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });
  const created = await createWorkspace(ownerId, ownerEmail, { name: `Registrace ${Date.now()}` });
  ownerCtx = await createWorkspaceContext({
    kind: 'session',
    userId: ownerId,
    workspaceRef: created.workspace.id,
  });
  await seedSystemMailAccount(ownerCtx);
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

describe('založení účtu z pozvánky', () => {
  it('založí účet, členství i relaci a adresu vezme z pozvánky', async () => {
    const email = `pozvany-${uuidv7()}@example.cz`;
    const token = await invite(email, 'editor');

    const result = await signupFromInvitation(input(token));

    expect(result.user.email).toBe(email);
    expect(result.role).toBe('editor');
    expect(result.workspace.id).toBe(ownerCtx.workspaceId);
    // Relační token je to, co dělá rozdíl mezi „účet vznikl" a „uživatel je
    // uvnitř". Bez něj by ho odpověď poslala na přihlašovací formulář hned po
    // tom, co si zvolil heslo.
    expect(result.token.length).toBeGreaterThan(20);

    const members = await withWorkspace(ownerCtx, (tx) =>
      tx.execute<{ role: string }>(sql`
        SELECT m.role FROM memberships m
         WHERE m.workspace_id = ${ownerCtx.workspaceId}::uuid AND m.user_id = ${result.user.id}::uuid
      `),
    );
    expect(members.rows).toHaveLength(1);
    expect(members.rows[0]!.role).toBe('editor');

    // Adresa je ověřená tím, že se člověk dostal k tokenu z e-mailu na ni
    // poslanému. Bez toho by mu instalace bez systémové pošty zablokovala účet.
    const users = await withoutContext((tx) =>
      tx.execute<{ email_verified_at: Date | null; locale: string }>(sql`
        SELECT email_verified_at, locale FROM users WHERE id = ${result.user.id}::uuid
      `),
    );
    expect(users.rows[0]!.email_verified_at).not.toBeNull();

    // Pozvánka je spotřebovaná, druhý pokus s týmž tokenem musí selhat.
    await expect(signupFromInvitation(input(token))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('neplatný token nerozliší od prošlého ani od odvolaného', async () => {
    await expect(
      signupFromInvitation(input('token-ktery-nikdy-neexistoval')),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('na adresu s existujícím účtem účet NEZALOŽÍ a heslo nepřepíše', async () => {
    const existingId = uuidv7();
    const email = `uz-existuje-${existingId}@example.cz`;
    const originalHash = await hashPassword('puvodni-heslo-uzivatele');
    await withoutContext(async (tx) => {
      await tx.insert(schema.users).values({
        id: existingId,
        email,
        passwordHash: originalHash,
        locale: 'cs',
        timezone: 'Europe/Prague',
      });
    });

    const token = await invite(email);
    await expect(signupFromInvitation(input(token))).rejects.toMatchObject({ code: 'conflict' });

    // Tohle je jádro věci: kdyby se heslo přepsalo, převzal by správce jednoho
    // projektu účet člověka z projektu cizího pouhým pozváním jeho adresy.
    const after = await withoutContext((tx) =>
      tx.execute<{ password_hash: string }>(sql`
        SELECT password_hash FROM users WHERE id = ${existingId}::uuid
      `),
    );
    expect(after.rows[0]!.password_hash).toBe(originalHash);
  });

  it('krátké heslo odmítne a účet po něm nezůstane', async () => {
    const email = `kratke-heslo-${uuidv7()}@example.cz`;
    const token = await invite(email);

    await expect(signupFromInvitation({ ...input(token), password: 'krátké' })).rejects.toThrow();

    const users = await withoutContext((tx) =>
      tx.execute(sql`SELECT 1 FROM users WHERE email = ${email}`),
    );
    expect(users.rows).toHaveLength(0);

    // A pozvánka se přitom nespotřebovala, takže druhý pokus s pořádným heslem
    // projde. Transakce se musí vrátit celá, ne z poloviny.
    const ok = await signupFromInvitation(input(token));
    expect(ok.user.email).toBe(email);
  });

  it('při SIGNUP_MODE=closed odmítne dřív, než sáhne na databázi', async () => {
    const email = `zavreno-${uuidv7()}@example.cz`;
    const token = await invite(email);

    process.env['SIGNUP_MODE'] = 'closed';
    resetSignupConfigCache();

    await expect(signupFromInvitation(input(token))).rejects.toMatchObject({
      code: 'signup_closed',
    });
    // 403, ne 404: pozvánka je v pořádku, jen tahle instalace tuhle cestu
    // nemá zapnutou, a pozvaný to musí poznat z odpovědi.
    await signupFromInvitation(input(token)).catch((error: unknown) => {
      expect((error as ApiError).status).toBe(403);
    });

    const users = await withoutContext((tx) =>
      tx.execute(sql`SELECT 1 FROM users WHERE email = ${email}`),
    );
    expect(users.rows).toHaveLength(0);
  });
});
