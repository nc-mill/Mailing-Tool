import { eq, sql } from 'drizzle-orm';
import { createWorkspaceAsUser } from '@mlain/db';
import * as schema from '@mlain/db/schema';
import { appPool, withoutContext, withWorkspace } from '@mlain/core/tx';
import { hashPassword } from '@mlain/core/identity/password';
import { createWorkspaceContext } from '@mlain/core/identity/context';
import type { TestApp } from './app';

export const TEST_PASSWORD = 'dostatecne-dlouhe-heslo';

let loginIpCounter = 0;

/**
 * Založí uživatele, projekt a členství v dané roli a přihlásí ho přes API,
 * takže test dostane skutečnou cookie, ne podvrženou.
 *
 * Přihlášení jde z vlastní adresy (`TRUST_PROXY=1` nastavuje volající),
 * aby pravidlo `login_ip` nespotřebovalo limit při víc seedech v jednom souboru.
 */
export async function seedOwnerWithWorkspace(
  app: TestApp,
  role: 'owner' | 'admin' | 'editor' | 'viewer' = 'owner',
): Promise<{ cookie: string; userId: string; workspaceId: string; email: string; slug: string }> {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `seed-${unique}@example.cz`;
  const slug = `seed-${unique}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

  const userId = await withoutContext(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({
        email,
        passwordHash: await hashPassword(TEST_PASSWORD),
        name: 'Seed',
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return u!.id;
  });

  /**
   * ODCHYLKA OD PLÁNU, vynucená RLS. Plán zakládal projekt holým
   * `tx.insert(workspaces).returning()` uvnitř `withUser`. To NEPROJDE:
   * `INSERT ... RETURNING` uplatní na nový řádek i politiky pro čtení,
   * `ws_insert_bootstrap` je jen `FOR INSERT`, a `ws_isolation_self` porovnává
   * s workspace kontextem, který v té chvíli neexistuje. Naměřeno spuštěním:
   * SQLSTATE 42501, "new row violates row-level security policy". Vložení
   * členství by neprošlo ani tak.
   *
   * P03 na to má hotovou funkci `createWorkspaceAsUser`, která si ID vygeneruje
   * dopředu a nastaví ho jako kontext ještě před INSERT. Seed ji používá,
   * místo aby si tenhle postup opisoval; roli členství pak jen upraví,
   * protože funkce zakládá vždy ownera.
   */
  const created = await createWorkspaceAsUser(appPool(), userId, {
    name: 'Seed',
    slug,
    locale: 'cs',
    timezone: 'Europe/Prague',
  });
  const workspaceId = created.id;

  if (role !== 'owner') {
    const ctx = await createWorkspaceContext({
      kind: 'session',
      userId,
      workspaceRef: workspaceId,
    });
    await withWorkspace(ctx, (tx) =>
      tx
        .update(schema.memberships)
        .set({ role, updatedAt: new Date() })
        .where(eq(schema.memberships.userId, userId)),
    );
  }

  loginIpCounter += 1;
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.40.0.${loginIpCounter}` },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;

  return { cookie, userId, workspaceId, email, slug };
}

/**
 * Přidá projektu odesílací účet typu SMTP.
 *
 * Existuje kvůli systémové poště: `POST /api/v1/invitations` odmítne založit
 * pozvánku v projektu, který ji nemá jak odeslat, a vrátí 503
 * `system_mail_unavailable`. Typ účtu je tu SMTP jen proto, že testy pozvánek
 * nepotřebují víc; systémovou poštu odešle i účet typu SES. Šifrovaná konfigurace
 * je zástupná, protože samotné odesílání si testy nahrazují přes `setSystemMailer`;
 * výběr účtu se do ní nedívá.
 */
export async function seedSmtpAccount(userId: string, workspaceId: string): Promise<void> {
  // Kontext projektu je povinný: `sending_providers` má politiku `ws_isolation`
  // s WITH CHECK, takže vložení bez kontextu skončí na SQLSTATE 42501.
  const ctx = await createWorkspaceContext({ kind: 'session', userId, workspaceRef: workspaceId });
  await withWorkspace(ctx, (tx) =>
    tx.execute(sql`
      INSERT INTO sending_providers
        (workspace_id, name, type, config_encrypted, config_public, status, is_default)
      VALUES (${workspaceId}::uuid, 'SMTP pro testy', 'smtp', 'enc:test', '{}'::jsonb,
              'ready', true)
    `),
  );
}
