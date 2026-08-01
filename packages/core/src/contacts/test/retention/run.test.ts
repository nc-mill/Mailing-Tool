import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceContext } from '../../../identity/types';
import {
  registerRevokePendingMessages,
  resetRevokePendingMessages,
  type RevokePendingMessagesInput,
} from '../../campaigns-port';
import { runRetention } from '../../jobs/retention-run';
import { registerHandler, unregisterHandler } from '../../retention/registry';
import { asMigrator, createActiveContact, createList, testContext } from '../support/db';
import { all, one } from '../support/phase-c';

const revoke = vi.fn(async (_input: RevokePendingMessagesInput) => ({ revoked: 0 }));

beforeEach(() => {
  revoke.mockClear();
  registerRevokePendingMessages(revoke);
});

afterEach(() => {
  resetRevokePendingMessages();
});

async function setPolicy(
  ctx: WorkspaceContext,
  target: string,
  input: { days: number; action: 'delete' | 'anonymize'; enabled: boolean },
): Promise<void> {
  await asMigrator().query(
    `INSERT INTO retention_policies (workspace_id, target, retain_days, action, enabled)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, target) DO UPDATE SET
       retain_days = excluded.retain_days, action = excluded.action, enabled = excluded.enabled`,
    [ctx.workspaceId, target, input.days, input.action, input.enabled],
  );
}

/** Vypne všechny cíle kromě jednoho, aby test měřil právě ten jeden. */
async function onlyTarget(
  ctx: WorkspaceContext,
  target: string,
  days: number,
  action: 'delete' | 'anonymize' = 'delete',
): Promise<void> {
  for (const other of [
    'import_files',
    'import_errors',
    'form_submissions',
    'inbound_deliveries',
    'unconfirmed_subscriptions',
    'inactive_contacts',
    'exports',
  ]) {
    await setPolicy(ctx, other, { days: 30, action: 'delete', enabled: other === target });
  }
  await setPolicy(ctx, target, { days, action, enabled: true });
}

describe('retenční běh', () => {
  it('SMAŽE nepotvrzená přihlášení starší lhůty, tedy ovlivní víc než nula řádků', async () => {
    const ctx = await testContext();
    const contact = await createActiveContact(ctx, 'j@x.cz');
    const list = await createList(ctx, { name: 'Newsletter' });
    await asMigrator().query(
      `INSERT INTO list_subscriptions (contact_id, list_id, workspace_id, status, source,
                                       subscribed_at)
       VALUES ($1, $2, $3, 'pending', 'form', now() - interval '90 days')`,
      [contact.id, list.id, ctx.workspaceId],
    );

    await onlyTarget(ctx, 'unconfirmed_subscriptions', 30);
    const result = await runRetention({ workspaceId: ctx.workspaceId });

    expect(result.status).toBe('completed');
    // Kdyby job běžel bez kontextu projektu, politika ws_isolation by DELETE odřízla,
    // ovlivnil by nula řádků a NEVRÁTIL BY CHYBU. Tenhle test je jediné, co ten tichý
    // režim selhání odhalí.
    const rows = await all(`SELECT contact_id FROM list_subscriptions WHERE workspace_id = $1`, [
      ctx.workspaceId,
    ]);
    expect(rows).toHaveLength(0);

    const run = await one<{ affected: string; status: string }>(
      `SELECT affected, status FROM retention_runs
        WHERE workspace_id = $1 AND target = 'unconfirmed_subscriptions'`,
      [ctx.workspaceId],
    );
    expect(Number(run.affected)).toBe(1);
    expect(run.status).toBe('completed');
  });

  it('mladší řádky nechává být', async () => {
    const ctx = await testContext();
    const contact = await createActiveContact(ctx, 'j@x.cz');
    const list = await createList(ctx, { name: 'Newsletter' });
    await asMigrator().query(
      `INSERT INTO list_subscriptions (contact_id, list_id, workspace_id, status, source,
                                       subscribed_at)
       VALUES ($1, $2, $3, 'pending', 'form', now() - interval '5 days')`,
      [contact.id, list.id, ctx.workspaceId],
    );

    await onlyTarget(ctx, 'unconfirmed_subscriptions', 30);
    await runRetention({ workspaceId: ctx.workspaceId });

    const rows = await all(`SELECT contact_id FROM list_subscriptions WHERE workspace_id = $1`, [
      ctx.workspaceId,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('anonymizuje staré odeslané formuláře místo mazání', async () => {
    const ctx = await testContext();
    const form = await one<{ id: string }>(
      `INSERT INTO forms (workspace_id, name, slug, fields)
       VALUES ($1, 'Formulář', $2, '[]'::jsonb) RETURNING id`,
      [ctx.workspaceId, `f${Date.now()}${Math.random().toString(36).slice(2)}`.slice(0, 24)],
    );
    await asMigrator().query(
      `INSERT INTO form_submissions (workspace_id, form_id, status, payload, ip, created_at)
       VALUES ($1, $2, 'accepted', '{"email":"j@x.cz"}'::jsonb, '1.2.3.4',
               now() - interval '400 days')`,
      [ctx.workspaceId, form.id],
    );

    await onlyTarget(ctx, 'form_submissions', 180, 'anonymize');
    await runRetention({ workspaceId: ctx.workspaceId });

    const row = await one<{ payload: unknown; ip: string | null }>(
      `SELECT payload, ip FROM form_submissions WHERE workspace_id = $1`,
      [ctx.workspaceId],
    );
    // Řádek zůstává kvůli statistice formuláře, osobní údaje z něj mizí.
    expect(row.payload).toEqual({});
    expect(row.ip).toBeNull();
  });

  it('chybějící handler cíl přeskočí a běh doběhne se stavem partial', async () => {
    const ctx = await testContext();
    await onlyTarget(ctx, 'exports', 7);

    const result = await runRetention({ workspaceId: ctx.workspaceId });
    expect(result.status).toBe('partial');

    const run = await one<{ status: string; error_detail: string }>(
      `SELECT status, error_detail FROM retention_runs
        WHERE workspace_id = $1 AND target = 'exports'`,
      [ctx.workspaceId],
    );
    expect(run.status).toBe('partial');
    expect(run.error_detail).toContain('exports');
  });

  it('doplněný handler se použije a běh je completed', async () => {
    const ctx = await testContext();
    await onlyTarget(ctx, 'exports', 7);
    registerHandler('exports', async () => ({ scanned: 3, affected: 2 }));

    try {
      const result = await runRetention({ workspaceId: ctx.workspaceId });
      expect(result.status).toBe('completed');
      const run = await one<{ affected: string }>(
        `SELECT affected FROM retention_runs WHERE workspace_id = $1 AND target = 'exports'`,
        [ctx.workspaceId],
      );
      expect(Number(run.affected)).toBe(2);
    } finally {
      unregisterHandler('exports');
    }
  });

  it('selhání jednoho cíle běh nezastaví a zapíše se do error_detail', async () => {
    const ctx = await testContext();
    await onlyTarget(ctx, 'exports', 7);
    registerHandler('exports', async () => {
      throw new Error('úložiště není dostupné');
    });

    try {
      const result = await runRetention({ workspaceId: ctx.workspaceId });
      expect(result.status).toBe('failed');
      const run = await one<{ status: string; error_detail: string }>(
        `SELECT status, error_detail FROM retention_runs
          WHERE workspace_id = $1 AND target = 'exports'`,
        [ctx.workspaceId],
      );
      expect(run.status).toBe('failed');
      expect(run.error_detail).toContain('úložiště není dostupné');
    } finally {
      unregisterHandler('exports');
    }
  });

  it('KRITÉRIUM 71: souhlasy ani blokované adresy retence nesmaže', async () => {
    const ctx = await testContext();
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await asMigrator().query(
      `INSERT INTO consents (workspace_id, contact_id, purpose, status, legal_basis, source,
                             occurred_at, created_at)
       VALUES ($1, $2, 'email_marketing', 'granted', 'consent', 'form',
               now() - interval '900 days', now() - interval '900 days')`,
      [ctx.workspaceId, contact.id],
    );
    await asMigrator().query(
      `INSERT INTO suppressions (workspace_id, email, fingerprint, fingerprint_key_id, reason,
                                 source, created_at)
       VALUES ($1, 'stary@x.cz', '\\x00'::bytea, 1, 'manual', 'ui', now() - interval '900 days')`,
      [ctx.workspaceId],
    );

    // Všechny cíle zapnuté a se lhůtou jeden den: kdyby retence na tyhle tabulky sahala,
    // smazala by je.
    for (const target of [
      'import_errors',
      'form_submissions',
      'inbound_deliveries',
      'unconfirmed_subscriptions',
    ]) {
      await setPolicy(ctx, target, { days: 1, action: 'delete', enabled: true });
    }
    await runRetention({ workspaceId: ctx.workspaceId });

    expect(
      await all(`SELECT id FROM consents WHERE workspace_id = $1`, [ctx.workspaceId]),
    ).toHaveLength(1);
    expect(
      await all(`SELECT id FROM suppressions WHERE workspace_id = $1`, [ctx.workspaceId]),
    ).toHaveLength(1);
  });
});
