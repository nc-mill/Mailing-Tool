import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '../tx';
import { loadConfig, type MlainConfig } from '../config';
import { ApiError } from '../errors/api-error';
import { writeAuditLog } from '../audit/write';
import { assertPasswordPolicy, hashPassword } from './password';
import { IdentityAuditActions } from './audit';
import { toPublicUser, type PublicUser } from './login';
import { createSession } from './session';

/**
 * ODCHYLKA OD PLÁNU: plán psal `import { config } from '@mlain/core/config'`.
 * P01 vydává jen `loadConfig()`. Čte se proto líně a memoizovaně, stejně jako
 * v `session.ts`, `tx/index.ts` a `net/ssrf.ts`.
 */
let cachedConfig: MlainConfig | null = null;
function cfg(): MlainConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

export type SetupInput = {
  email: string;
  password: string;
  name?: string | undefined;
  workspace_name: string;
  locale?: string | undefined;
  ip: string | null;
  userAgent: string;
  requestId: string;
};

export type SetupResult = {
  user: PublicUser;
  workspace: { id: string; name: string; slug: string };
  /**
   * Relační token pro nově založeného správce.
   *
   * Průvodce prvním spuštěním uživatele zakládá, takže ho musí i přihlásit.
   * Dřív tu token nebyl a `setup.routes.ts` proto neposílal `Set-Cookie`,
   * na rozdíl od přihlášení. Následek: instalace proběhla, správce i projekt
   * vznikly, přesměrování na `/w/{slug}` proběhlo, a **uživatel zůstal
   * nepřihlášený**. Prohlížeč neměl jedinou cookie a proxy ho poslala na
   * přihlašovací formulář, hned po tom, co si nastavil heslo.
   *
   * Relace se zakládá uvnitř TÉŽE transakce jako uživatel a projekt, takže
   * nemůže vzniknout stav, kdy je založený správce bez relace nebo naopak.
   */
  token: string;
};

/** Slug se generuje z názvu; diakritika se odstraní, aby zůstala URL bezpečná. */
export function slugify(input: string): string {
  const base = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  return base.length > 0 ? base : `projekt-${Date.now()}`;
}

export async function isSetupAvailable(): Promise<boolean> {
  return withoutContext(async (tx) => {
    const { rows: settings } = await tx.execute<{ setup_completed_at: Date | null }>(
      sql`SELECT setup_completed_at FROM system_settings WHERE id = true`,
    );
    if (!settings[0] || settings[0].setup_completed_at) return false;
    const { rows: users } = await tx.execute(sql`SELECT 1 FROM users LIMIT 1`);
    return users.length === 0;
  });
}

/**
 * 3.1: endpoint je dostupný, jen dokud system_settings.setup_completed_at IS NULL
 * a users je prázdná. Vytvoří prvního uživatele, první workspace, členství owner
 * a nastaví setup_completed_at. Celé v jedné transakci.
 */
export async function runSetup(input: SetupInput): Promise<SetupResult> {
  if (!(await isSetupAvailable())) throw new ApiError('setup_already_completed');

  const email = input.email.trim().toLowerCase();
  assertPasswordPolicy(input.password, email);
  const passwordHash = await hashPassword(input.password);

  // 2.3: locale a timezone vyplňuje aplikace VŽDY explicitně, DEFAULT v DDL je
  // jen pojistka. Bez toho by instalace s DEFAULT_LOCALE=de dostávala české hodnoty.
  const locale = input.locale ?? cfg().DEFAULT_LOCALE;
  const timezone = cfg().DEFAULT_TIMEZONE;

  // ID se generuje v aplikaci, protože ho potřebujeme znát PŘED INSERTem:
  // politika ws_insert_bootstrap vyžaduje nastavené mlain.user_id.
  const userId = uuidv7();
  const slug = slugify(input.workspace_name);

  return withoutContext(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({
        id: userId,
        email,
        passwordHash,
        name: input.name ?? '',
        locale,
        timezone,
        emailVerifiedAt: new Date(),
      })
      .returning();

    // Teprve teď smí vzniknout projekt: politika ws_insert_bootstrap čte mlain.user_id.
    await tx.execute(sql`SELECT set_config('mlain.user_id', ${userId}, true)`);

    // ID projektu se generuje DOPŘEDU a kontext se nastaví JEŠTĚ PŘED vložením.
    // Bez toho selže `INSERT ... RETURNING` na workspaces (RETURNING potřebuje
    // politiku pro čtení, kterou ws_insert_bootstrap jako FOR INSERT není)
    // i vložení členství (ws_isolation má WITH CHECK proti workspace kontextu).
    // Ověřeno spuštěním v P03, viz tamtéž createWorkspaceAsUser.
    const workspaceId = uuidv7();
    await tx.execute(sql`SELECT set_config('mlain.workspace_id', ${workspaceId}, true)`);

    const [workspace] = await tx
      .insert(schema.workspaces)
      .values({
        id: workspaceId,
        name: input.workspace_name,
        slug,
        locale,
        timezone,
        createdBy: userId,
      })
      .returning({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        slug: schema.workspaces.slug,
      });

    await tx.insert(schema.memberships).values({ workspaceId, userId, role: 'owner' });

    await writeAuditLog(tx, {
      action: IdentityAuditActions['workspace.created'],
      workspaceId: workspace!.id,
      actor: { actorType: 'user', actorId: userId, actorLabel: email },
      targetType: 'workspace',
      targetId: workspace!.id,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
      metadata: { source: 'setup' },
    });

    const { rows: updated } = await tx.execute(sql`
      UPDATE system_settings SET setup_completed_at = now(), updated_at = now()
       WHERE id = true AND setup_completed_at IS NULL
       RETURNING installation_id
    `);
    // Souběžný druhý setup by tady skončil na nule ovlivněných řádků a celá
    // transakce se rollbackne, takže nevznikne druhý owner ani druhý projekt.
    if (updated.length !== 1) throw new ApiError('setup_already_completed');

    // Relace pro nově založeného správce, ve stejné transakci jako on sám.
    const session = await createSession(tx, {
      userId: user!.id,
      userAgent: input.userAgent,
      ip: input.ip,
    });

    return { user: toPublicUser(user!), workspace: workspace!, token: session.token };
  });
}
