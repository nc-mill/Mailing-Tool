import { describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '../../../identity/types';
import { processInboundDelivery } from '../../jobs/inbound-process';
import { addSuppression } from '../../repo/suppressions';
import { asMigrator, testContext } from '../support/db';

/**
 * Příchozí webhook a pravidlo 4.
 *
 * Přihlášení do seznamu si webhook nechává hlídat od `subscribeToList`, souhlas ale
 * zapisoval sám a bez jakékoliv brány. E-shop, který posílá „nákup dokončen" s namapovaným
 * souhlasem, by tak odhlášenému zákazníkovi vyrobil nový souhlas při každé objednávce.
 *
 * Test jde CELOU CESTOU: uloží doručení do tabulky, spustí obsluhu jobu a ptá se databáze.
 */

const MAPPING = {
  version: 1,
  event: { path: '$.type', map: { purchase: 'subscribe' } },
  contact: { email: { path: '$.customer.email' } },
  consent: { purpose: 'email_marketing', legal_basis: 'consent' },
};

async function deliver(
  ctx: WorkspaceContext,
  email: string,
): Promise<{ deliveryId: string; createdAt: string }> {
  const endpoint = await asMigrator().query<{ id: string }>(
    `INSERT INTO inbound_endpoints (workspace_id, name, slug, signature_mode, mapping)
     VALUES ($1, 'E-shop', $2, 'none', $3::jsonb) RETURNING id`,
    [
      ctx.workspaceId,
      `eshop${Date.now()}${process.pid}`.slice(0, 32).padEnd(24, '0'),
      JSON.stringify(MAPPING),
    ],
  );

  // created_at se vrací jako TEXT schválně. Sloupec má mikrosekundy, `Date` v JavaScriptu
  // jen milisekundy, takže by `toISOString()` čas zkrátil, dotaz podle partičního klíče
  // by nenašel nic a job by tiše skončil stavem processed, aniž by cokoliv udělal.
  const delivery = await asMigrator().query<{ id: string; created_at: string }>(
    `INSERT INTO inbound_deliveries (workspace_id, endpoint_id, status, payload)
     VALUES ($1, $2, 'received', $3::jsonb) RETURNING id, created_at::text AS created_at`,
    [
      ctx.workspaceId,
      endpoint.rows[0]!.id,
      JSON.stringify({ type: 'purchase', customer: { email } }),
    ],
  );

  return { deliveryId: delivery.rows[0]!.id, createdAt: delivery.rows[0]!.created_at };
}

async function consentCount(ctx: WorkspaceContext, email: string): Promise<number> {
  const { rows } = await asMigrator().query<{ count: string }>(
    `SELECT count(*)::text AS count FROM consents c
       JOIN contacts k ON k.id = c.contact_id
      WHERE c.workspace_id = $1 AND k.email = $2 AND c.status = 'granted'`,
    [ctx.workspaceId, email],
  );
  return Number(rows[0]?.count ?? '0');
}

describe('příchozí webhook u adresy na měkkém suppression listu', () => {
  it('udělený souhlas nezapíše', async () => {
    const ctx = await testContext();
    await addSuppression(ctx, { email: 'odhlaseny@eshop.cz', reason: 'manual', source: 'test' });

    const ref = await deliver(ctx, 'odhlaseny@eshop.cz');
    const result = await processInboundDelivery({ workspaceId: ctx.workspaceId, ...ref });

    expect(result.status).toBe('processed');
    expect(await consentCount(ctx, 'odhlaseny@eshop.cz')).toBe(0);
  });

  it('kontaktu bez blokace souhlas zapíše', async () => {
    const ctx = await testContext();

    const ref = await deliver(ctx, 'cisty@eshop.cz');
    const result = await processInboundDelivery({ workspaceId: ctx.workspaceId, ...ref });

    expect(result.status).toBe('processed');
    expect(await consentCount(ctx, 'cisty@eshop.cz')).toBe(1);
  });
});
