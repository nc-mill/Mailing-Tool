import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { asMigrator, closeMigratorPool } from '../test-support/migrator';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, withoutContext } from '../tx';
import { loadConfig } from '../config';
import { runSetup, isSetupAvailable } from './setup';
import { verifyPassword } from './password';

let harness: PgHarness;

/**
 * Úklid MUSÍ běžet pod `mlain_migrator`, ne pod aplikační rolí.
 *
 * `memberships` i `workspaces` mají RLS a bez nastaveného kontextu je `USING`
 * nepravda, takže `DELETE` smaže **nula řádků a nehlásí chybu**. Prošel by jen
 * `DELETE FROM users`, protože ta tabulka RLS nemá. `beforeEach` by tedy
 * vypadal, že uklidil, a test „na prázdné instalaci vrací true" by padal nebo,
 * ještě hůř, procházel jednou z pěti.
 */
async function resetInstallation(): Promise<void> {
  await asMigrator(async (db) => {
    await db.query(`DELETE FROM audit_log`);
    await db.query(`DELETE FROM memberships`);
    // Výchozí seznam zakládá `runSetup` od 7. 8. 2026 a drží ho cizí klíč
    // na projekt, takže bez tohohle řádku by `DELETE FROM workspaces` skončil
    // na 23503 a úklid by tiše přestal fungovat.
    await db.query(`DELETE FROM lists`);
    await db.query(`DELETE FROM workspaces`);
    await db.query(`DELETE FROM users`);
    await db.query(`UPDATE system_settings SET setup_completed_at = NULL WHERE id = true`);
  });
}

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closeMigratorPool();
  await closePools();
  await harness?.stop();
}, 120_000);

const input = {
  email: 'owner@example.cz',
  password: 'dostatecne-dlouhe-heslo',
  name: 'Petr',
  workspace_name: 'Můj projekt',
  locale: 'cs',
  ip: '10.0.0.1',
  userAgent: 'vitest',
  requestId: 'r',
};

beforeEach(resetInstallation);

describe('isSetupAvailable', () => {
  it('na prázdné instalaci vrací true', async () => {
    expect(await isSetupAvailable()).toBe(true);
  });

  it('po dokončení vrací false', async () => {
    await runSetup(input);
    expect(await isSetupAvailable()).toBe(false);
  });
});

describe('runSetup', () => {
  it('vytvoří uživatele, projekt a členství owner v jedné transakci', async () => {
    const result = await runSetup(input);
    expect(result.user.email).toBe('owner@example.cz');
    expect(result.workspace.name).toBe('Můj projekt');

    // Čte se pod migrátorem: `memberships` i `workspaces` mají RLS a bez
    // kontextu by aplikační role viděla nula řádků, takže by test tvrdil
    // "nic nevzniklo" i tehdy, kdyby všechno proběhlo správně.
    const rows = await asMigrator(async (db) => {
      const r = await db.query<{ email: string; slug: string; role: string }>(`
        SELECT u.email, w.slug, m.role
          FROM memberships m
          JOIN users u ON u.id = m.user_id
          JOIN workspaces w ON w.id = m.workspace_id
      `);
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe('owner');
  });

  /**
   * První projekt instalace se musí chovat jako každý další.
   *
   * Do 7. 8. 2026 zakládal výchozí seznam jen `createWorkspace`, kdežto
   * průvodce prvním spuštěním ne. Naměřeno na čisté instalaci: `lists` mělo
   * nula řádků. Import cílový seznam VYŽADUJE, takže úplně první věc, kterou
   * nový uživatel dělá, narazila na prázdnou nabídku.
   */
  it('založí výchozí seznam „Odběratelé", stejně jako každý další projekt', async () => {
    await runSetup(input);
    const rows = await asMigrator(async (db) => {
      const r = await db.query<{
        name: string;
        opt_in: string;
        confirmation_mode: string;
        is_default: boolean;
      }>(`SELECT name, opt_in, confirmation_mode, is_default FROM lists`);
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Odběratelé',
      opt_in: 'double',
      confirmation_mode: 'one_step',
      is_default: true,
    });
  });

  it('název výchozího seznamu se řídí jazykem projektu', async () => {
    await runSetup({ ...input, locale: 'en' });
    const rows = await asMigrator(async (db) => {
      const r = await db.query<{ name: string }>(`SELECT name FROM lists`);
      return r.rows;
    });
    expect(rows[0]!.name).toBe('Subscribers');
  });

  it('slug se odvodí z názvu a je URL bezpečný', async () => {
    const result = await runSetup({ ...input, workspace_name: 'Můj Skvělý Projekt 2026' });
    expect(result.workspace.slug).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
    expect(result.workspace.slug).toBe('muj-skvely-projekt-2026');
  });

  it('heslo se uloží jako Argon2id, nikdy v otevřené podobě', async () => {
    await runSetup(input);
    const rows = await withoutContext(async (tx) => {
      const r = await tx.execute<{ password_hash: string }>(sql`SELECT password_hash FROM users`);
      return r.rows;
    });
    expect(rows[0]!.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(rows[0]!.password_hash, input.password)).toBe(true);
  });

  it('locale a timezone se vyplní explicitně z konfigurace, ne z DEFAULT v DDL', async () => {
    const config = loadConfig();
    await runSetup({ ...input, locale: undefined });
    const rows = await asMigrator(async (db) => {
      const r = await db.query<{ locale: string; timezone: string }>(
        `SELECT locale, timezone FROM workspaces`,
      );
      return r.rows;
    });
    expect(rows[0]!.locale).toBe(config.DEFAULT_LOCALE);
    expect(rows[0]!.timezone).toBe(config.DEFAULT_TIMEZONE);
  });

  it('druhé volání vrací setup_already_completed 409', async () => {
    await runSetup(input);
    await expect(runSetup({ ...input, email: 'druhy@example.cz' })).rejects.toMatchObject({
      code: 'setup_already_completed',
      status: 409,
    });
  });

  it('slabé heslo vrací validation_failed a nic nevytvoří', async () => {
    await expect(runSetup({ ...input, password: 'kratke' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    const rows = await withoutContext(async (tx) => {
      const r = await tx.execute(sql`SELECT 1 FROM users`);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('zapíše workspace.created do audit logu', async () => {
    const result = await runSetup(input);
    const rows = await asMigrator(async (db) => {
      const r = await db.query<{ workspace_id: string }>(
        `SELECT workspace_id::text AS workspace_id FROM audit_log WHERE action = 'workspace.created'`,
      );
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.workspace_id).toBe(result.workspace.id);
  });

  /**
   * Průvodce uživatele zakládá, takže ho musí i přihlásit.
   *
   * Bez relace proběhla instalace celá, správce i projekt vznikly a přesměrování
   * na `/w/{slug}` taky, jenže prohlížeč neměl jedinou cookie a proxy poslala
   * uživatele na přihlašovací formulář. Hned po tom, co si nastavil heslo.
   * Naměřeno v produkční image při průchodu zlatou cestou.
   */
  it('založí relaci pro nového správce a vrátí její token', async () => {
    const result = await runSetup(input);

    expect(result.token).toBeTypeOf('string');
    expect(result.token.length).toBeGreaterThan(20);
  });

  it('relace v databázi patří právě založenému uživateli', async () => {
    const result = await runSetup(input);

    const rows = await asMigrator(async (db) => {
      const r = await db.query<{ user_id: string }>(
        `SELECT user_id::text AS user_id FROM sessions WHERE revoked_at IS NULL`,
      );
      return r.rows;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe(result.user.id);
  });

  // Relace vzniká v TÉŽE transakci jako uživatel, takže neúspěšný setup po sobě
  // nesmí nechat osiřelou relaci. Bez toho by v databázi zůstal záznam ukazující
  // na uživatele, který nikdy nevznikl.
  it('neúspěšný setup nenechá po sobě relaci', async () => {
    await expect(runSetup({ ...input, password: 'kratke' })).rejects.toMatchObject({
      code: 'validation_failed',
    });

    const rows = await asMigrator(async (db) => {
      const r = await db.query(`SELECT 1 FROM sessions`);
      return r.rows;
    });

    expect(rows).toHaveLength(0);
  });
});
