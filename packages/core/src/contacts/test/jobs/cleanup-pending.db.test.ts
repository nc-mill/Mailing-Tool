import { describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '../../../identity/types';
import { cleanupPendingSubscriptions } from '../../jobs/cleanup-pending';
import * as listsRepo from '../../repo/lists';
import { asMigrator, createActiveContact, testContext } from '../support/db';

/**
 * Noční úklid nepotvrzených přihlášení, proti skutečné databázi.
 *
 * Fronta `contacts.cleanup_pending` má cron `55 2 * * *`, ale neměla obsluhu:
 * mrtvé potvrzovací odkazy i jejich důkazní metadata (IP, user agent) tedy
 * zůstávaly v databázi navždy. Test měří stav PŘED a PO a hlídá i to, co se
 * smazat NESMÍ, tedy důkazy o dvojím potvrzení.
 *
 * Job běží NAPŘÍČ PROJEKTY (cron ho plánuje s prázdným nákladem), takže se
 * kontroluje vždycky jen projekt daného testu.
 */

const TARGETS = [
  'import_files',
  'import_errors',
  'form_submissions',
  'inbound_deliveries',
  'unconfirmed_subscriptions',
  'inactive_contacts',
  'exports',
] as const;

/** Nastaví retenci nepotvrzených odběrů a všechny ostatní cíle vypne. */
async function retentionForPending(
  ctx: WorkspaceContext,
  input: { days: number; enabled: boolean },
): Promise<void> {
  for (const target of TARGETS) {
    await asMigrator().query(
      `INSERT INTO retention_policies (workspace_id, target, retain_days, action, enabled)
       VALUES ($1, $2, $3, 'delete', $4)
       ON CONFLICT (workspace_id, target) DO UPDATE SET
         retain_days = excluded.retain_days, enabled = excluded.enabled`,
      [
        ctx.workspaceId,
        target,
        input.days,
        target === 'unconfirmed_subscriptions' ? input.enabled : false,
      ],
    );
  }
}

async function seedSubscription(
  ctx: WorkspaceContext,
  input: { email: string; listId: string; ageDays: number },
): Promise<string> {
  const contact = await createActiveContact(ctx, input.email);
  await asMigrator().query(
    `INSERT INTO list_subscriptions
       (contact_id, list_id, workspace_id, status, source, subscribed_at)
     VALUES ($1, $2, $3, 'pending', 'form', now() - make_interval(days => $4))`,
    [contact.id, input.listId, ctx.workspaceId, input.ageDays],
  );
  return contact.id;
}

async function seedConfirmation(
  ctx: WorkspaceContext,
  input: {
    contactId: string;
    listId: string;
    token: string;
    expiresInDays: number;
    consumed: boolean;
  },
): Promise<void> {
  await asMigrator().query(
    `INSERT INTO subscription_confirmations
       (workspace_id, contact_id, list_id, token_hash, expires_at, consumed_at)
     VALUES ($1, $2, $3, sha256($4::bytea), now() + make_interval(days => $5), $6)`,
    [
      ctx.workspaceId,
      input.contactId,
      input.listId,
      Buffer.from(input.token, 'utf8'),
      input.expiresInDays,
      input.consumed ? new Date() : null,
    ],
  );
}

async function countConfirmations(ctx: WorkspaceContext): Promise<number> {
  const { rows } = await asMigrator().query<{ n: string }>(
    `SELECT count(*) AS n FROM subscription_confirmations WHERE workspace_id = $1`,
    [ctx.workspaceId],
  );
  return Number(rows[0]!.n);
}

async function pendingEmails(ctx: WorkspaceContext): Promise<string[]> {
  const { rows } = await asMigrator().query<{ email: string }>(
    `SELECT c.email::text AS email
       FROM list_subscriptions s JOIN contacts c ON c.id = s.contact_id
      WHERE s.workspace_id = $1 AND s.status = 'pending'
      ORDER BY 1`,
    [ctx.workspaceId],
  );
  return rows.map((r) => r.email);
}

describe('contacts.cleanup_pending proti databázi', () => {
  it('smaže vypršelé nespotřebované tokeny a nechá důkazy o potvrzení', async () => {
    const ctx = await testContext();
    await retentionForPending(ctx, { days: 30, enabled: false });
    const listId = (await listsRepo.create(ctx, { name: 'Newsletter' })).id;
    const contactId = await seedSubscription(ctx, {
      email: 'ceka@x.cz',
      listId,
      ageDays: 1,
    });

    await seedConfirmation(ctx, {
      contactId,
      listId,
      token: 'vyprsel-a-nikdo-neklikl',
      expiresInDays: -1,
      consumed: false,
    });
    await seedConfirmation(ctx, {
      contactId,
      listId,
      token: 'vyprsel-ale-clovek-potvrdil',
      expiresInDays: -1,
      consumed: true,
    });
    await seedConfirmation(ctx, {
      contactId,
      listId,
      token: 'jeste-plati',
      expiresInDays: 5,
      consumed: false,
    });

    // PŘED
    expect(await countConfirmations(ctx)).toBe(3);

    await cleanupPendingSubscriptions();

    // PO: zmizel právě ten jeden mrtvý odkaz.
    const { rows } = await asMigrator().query<{ consumed: boolean; expired: boolean }>(
      `SELECT consumed_at IS NOT NULL AS consumed, expires_at <= now() AS expired
         FROM subscription_confirmations WHERE workspace_id = $1 ORDER BY 1`,
      [ctx.workspaceId],
    );
    expect(rows).toHaveLength(2);
    // Zbyl spotřebovaný (důkaz dvojího potvrzení) a dosud platný.
    expect(rows.filter((r) => r.consumed)).toHaveLength(1);
    expect(rows.filter((r) => !r.consumed && !r.expired)).toHaveLength(1);
  });

  it('smaže nepotvrzený odběr po retenční lhůtě a čerstvý nechá', async () => {
    const ctx = await testContext();
    await retentionForPending(ctx, { days: 30, enabled: true });
    const listId = (await listsRepo.create(ctx, { name: 'Newsletter' })).id;
    await seedSubscription(ctx, { email: 'stary@x.cz', listId, ageDays: 60 });
    await seedSubscription(ctx, { email: 'cerstvy@x.cz', listId, ageDays: 3 });

    // PŘED
    expect(await pendingEmails(ctx)).toEqual(['cerstvy@x.cz', 'stary@x.cz']);

    await cleanupPendingSubscriptions();

    // PO
    expect(await pendingEmails(ctx)).toEqual(['cerstvy@x.cz']);
  });

  it('vypnutá retence projektu se respektuje', async () => {
    const ctx = await testContext();
    await retentionForPending(ctx, { days: 30, enabled: false });
    const listId = (await listsRepo.create(ctx, { name: 'Newsletter' })).id;
    await seedSubscription(ctx, { email: 'stary@x.cz', listId, ageDays: 365 });

    await cleanupPendingSubscriptions();

    expect(await pendingEmails(ctx)).toEqual(['stary@x.cz']);
  });

  it('potvrzeného ani odhlášeného se úklid nedotkne (mazal by důkazy)', async () => {
    const ctx = await testContext();
    await retentionForPending(ctx, { days: 1, enabled: true });
    const listId = (await listsRepo.create(ctx, { name: 'Newsletter' })).id;
    const contactId = await seedSubscription(ctx, {
      email: 'potvrzeny@x.cz',
      listId,
      ageDays: 400,
    });
    await asMigrator().query(
      `UPDATE list_subscriptions SET status = 'confirmed', confirmed_at = now()
        WHERE workspace_id = $1 AND contact_id = $2`,
      [ctx.workspaceId, contactId],
    );
    const odhlaseny = await seedSubscription(ctx, {
      email: 'odhlaseny@x.cz',
      listId,
      ageDays: 400,
    });
    await asMigrator().query(
      `UPDATE list_subscriptions SET status = 'unsubscribed', unsubscribed_at = now()
        WHERE workspace_id = $1 AND contact_id = $2`,
      [ctx.workspaceId, odhlaseny],
    );

    await cleanupPendingSubscriptions();

    const { rows } = await asMigrator().query<{ status: string }>(
      `SELECT status FROM list_subscriptions WHERE workspace_id = $1 ORDER BY status`,
      [ctx.workspaceId],
    );
    expect(rows.map((r) => r.status)).toEqual(['confirmed', 'unsubscribed']);
  });

  it('druhý běh nemá co mazat (idempotence)', async () => {
    const ctx = await testContext();
    await retentionForPending(ctx, { days: 30, enabled: true });
    const listId = (await listsRepo.create(ctx, { name: 'Newsletter' })).id;
    const contactId = await seedSubscription(ctx, { email: 'stary@x.cz', listId, ageDays: 60 });
    await seedConfirmation(ctx, {
      contactId,
      listId,
      token: 'davno-vyprsel',
      expiresInDays: -10,
      consumed: false,
    });

    const first = await cleanupPendingSubscriptions();
    const second = await cleanupPendingSubscriptions();

    expect(first.tokens).toBeGreaterThanOrEqual(1);
    expect(first.subscriptions).toBeGreaterThanOrEqual(1);
    expect(second.tokens).toBe(0);
    expect(second.subscriptions).toBe(0);
  });
});
