// packages/db/test/audit-log.test.ts
//
// Kritéria 21b a 21c. Tohle je přesně ten případ, který dřív shodil změnu
// hesla i s transakcí: auditní záznam s workspace_id NULL selhal na WITH CHECK
// a vzal s sebou celý commit, takže se heslo neuložilo.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container';
import { seedTwoWorkspaces } from './helpers/fixtures';
import { unsafeWorkspaceContext } from '../src/unsafe-context';
import { withWorkspace } from '../src/repo/tx';
import { ensureUpcomingPartitions } from '../src/partitions';
import { expectPermissionDenied, expectRlsViolation } from './helpers/errors';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  // Šablona se migruje s ensurePartitions: false. Bez oddílu by zápis
  // do audit_log skončil chybou "no partition of relation found", tedy
  // úplně jinou příčinou, než jakou tenhle soubor zkoumá.
  await ensureUpcomingPartitions(h.as('mlain_migrator'), new Date(), 1);
}, 180_000);
afterAll(async () => {
  await h.stop();
});

describe('audit_log a globální akce', () => {
  it('INSERT s workspace_id = NULL projde i BEZ nastaveného workspace kontextu', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await expect(
      h.as('mlain_app').query(
        `INSERT INTO audit_log (workspace_id, actor_type, actor_id, action)
       VALUES (NULL, 'user', $1, 'user.login')`,
        [ws.userId],
      ),
    ).resolves.toBeDefined();
  });

  it('INSERT s workspace_id = NULL projde i pod nastaveným kontextem', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxA = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    await expect(
      withWorkspace(h.as('mlain_app'), ctxA, async (tx) => {
        await tx.execute(sql`INSERT INTO audit_log (workspace_id, actor_type, actor_id, action)
         VALUES (NULL, 'user', ${ws.userId}, 'user.password_changed')`);
      }),
    ).resolves.toBeUndefined();
  });

  it('INSERT s cizím workspace_id pod kontextem B selže na WITH CHECK', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    const failure = await expectRlsViolation(
      () =>
        withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
          await tx.execute(sql`INSERT INTO audit_log (workspace_id, actor_type, action)
         VALUES (${ws.workspaceA}, 'system', 'settings.updated')`);
        }),
      'auditní zápis do cizího projektu prošel:',
    );
    expect(failure.message).toMatch(/audit_log/);
  });

  it('změna hesla se commitne i s auditním záznamem, transakce se nerollbackne (kritérium 21b)', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    // Přihlašovací flow ŽÁDNÝ workspace kontext nenastavuje. Přesně tohle
    // dřív padalo: audit s workspace_id NULL selhal na WITH CHECK a vzal
    // s sebou celou transakci, takže se heslo neuložilo.
    const client = await h.as('mlain_app').connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE users SET password_hash = 'argon2id$novy', password_changed_at = now()
            WHERE id = $1`,
        [ws.userId],
      );
      await client.query(
        `INSERT INTO audit_log (workspace_id, actor_type, actor_id, action)
           VALUES (NULL, 'user', $1, 'user.password_changed')`,
        [ws.userId],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const { rows } = await h
      .as('mlain_app')
      .query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [
        ws.userId,
      ]);
    expect(rows[0]!.password_hash).toBe('argon2id$novy');

    const { rows: audit } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
          WHERE actor_id = $1 AND action = 'user.password_changed'
            AND workspace_id IS NULL`,
      [ws.userId],
    );
    expect(audit[0]!.n).toBe(1);
  });

  it('pod kontextem B nevrátí čtení ani řádek A, ani globální řádek (kritérium 21c)', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await h.as('mlain_migrator').query(
      `INSERT INTO audit_log (workspace_id, actor_type, actor_id, action)
       VALUES ($1, 'system', NULL, 'settings.updated'),
              (NULL, 'user', $2, 'user.login')`,
      [ws.workspaceA, ws.userId],
    );

    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    const rows = await withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
      const r = await tx.execute(sql`SELECT * FROM audit_log`);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('aplikační role nesmí audit_log měnit ani mazat', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await h.as('mlain_migrator').query(
      `INSERT INTO audit_log (workspace_id, actor_type, action)
       VALUES ($1, 'system', 'settings.updated')`,
      [ws.workspaceA],
    );
    const ctxA = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    await expectPermissionDenied(
      () =>
        withWorkspace(h.as('mlain_app'), ctxA, async (tx) => {
          await tx.execute(sql`UPDATE audit_log SET action = 'podvrzeno'`);
        }),
      'aplikace přepsala auditní záznam:',
    );
    await expectPermissionDenied(
      () =>
        withWorkspace(h.as('mlain_app'), ctxA, async (tx) => {
          await tx.execute(sql`DELETE FROM audit_log`);
        }),
      'aplikace smazala auditní záznam:',
    );
  });

  it('consents jsou append only a mazat je smí jen mlain_gdpr', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await h.as('mlain_migrator').query(
      `INSERT INTO consents (workspace_id, contact_id, purpose, status, legal_basis,
                             source, occurred_at)
       VALUES ($1, $2, 'email_marketing', 'granted', 'consent', 'form', now())`,
      [ws.workspaceA, ws.contactInA],
    );

    const ctxA = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    await expectPermissionDenied(
      () =>
        withWorkspace(h.as('mlain_app'), ctxA, async (tx) => {
          await tx.execute(sql`UPDATE consents SET status = 'withdrawn'`);
        }),
      'aplikace přepsala souhlas:',
    );
    await expectPermissionDenied(
      () =>
        withWorkspace(h.as('mlain_app'), ctxA, async (tx) => {
          await tx.execute(sql`DELETE FROM consents`);
        }),
      'aplikace smazala souhlas:',
    );

    // mlain_gdpr DELETE má. Výmaz podle čl. 17 musí souhlasy smazat.
    const gdprCtx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'gdpr.erase' });
    const deleted = await withWorkspace(h.as('mlain_gdpr'), gdprCtx, async (tx) => {
      const r = await tx.execute(sql`DELETE FROM consents`);
      return r.rowCount;
    });
    expect(deleted).toBe(1);
  });

  it('ON DELETE CASCADE z contacts souhlasy odstraní, přestože aplikace DELETE nemá', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await h.as('mlain_migrator').query(
      `INSERT INTO consents (workspace_id, contact_id, purpose, status, legal_basis,
                             source, occurred_at)
       VALUES ($1, $2, 'analytics', 'granted', 'consent', 'form', now())`,
      [ws.workspaceA, ws.contactInA],
    );
    await h.as('mlain_migrator').query('DELETE FROM contacts WHERE id = $1', [ws.contactInA]);
    const { rows } = await h
      .as('mlain_migrator')
      .query<{ n: number }>('SELECT count(*)::int AS n FROM consents WHERE contact_id = $1', [
        ws.contactInA,
      ]);
    expect(rows[0]!.n).toBe(0);
  });
});
