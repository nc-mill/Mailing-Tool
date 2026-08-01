import { beforeAll, describe, expect, it, vi } from 'vitest';
import { asMigrator, explain, seedCampaign, seedMessage } from '../test/support/db';
import { lookupMessage } from './message-lookup';
import { trackingMetrics } from '../metrics';

const CONTACT = '0192f3a0-1c2d-7e43-8d4e-5f60718293a4';

describe('lookupMessage', () => {
  let workspaceId: string;
  let campaignId: string;
  let messageId: string;
  // Datum MUSÍ padnout do aktuálního měsíce. `messages` je partitionovaná podle
  // `created_at` a harness zakládá oddíly od dneška čtyři měsíce dopředu, takže
  // pevné datum z minulosti by skončilo na "no partition of relation messages".
  const createdAt = (() => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCHours(16, 0, 0, 0);
    return d;
  })();
  const createdAtSeconds = Math.floor(createdAt.getTime() / 1000);

  beforeAll(async () => {
    ({ workspaceId, campaignId } = await seedCampaign(createdAt));
    messageId = await seedMessage({ workspaceId, campaignId, contactId: CONTACT, createdAt });
  });

  it('najde zprávu rovnostním dotazem podle obou složek klíče', async () => {
    const row = await lookupMessage({ workspaceId, messageId, messageCreatedAt: createdAtSeconds });
    expect(row).not.toBeNull();
    expect(row!.campaignId).toBe(campaignId);
  });

  it('neshoda o sekundu se najde fallbackem', async () => {
    const row = await lookupMessage({
      workspaceId,
      messageId,
      messageCreatedAt: createdAtSeconds - 1,
    });
    expect(row).not.toBeNull();
  });

  it('zpráva z jiného projektu se nevrátí ani při shodě obou složek klíče', async () => {
    const other = await seedCampaign(createdAt);
    const row = await lookupMessage({
      workspaceId: other.workspaceId,
      messageId,
      messageCreatedAt: createdAtSeconds,
    });
    expect(row).toBeNull();
  });

  it('nenalezení zvýší tracking_message_lookup_miss_total a vrátí null', async () => {
    const spy = vi.spyOn(trackingMetrics.messageLookupMiss, 'inc');
    const row = await lookupMessage({
      workspaceId,
      messageId: '0192f3a0-1c2d-7e41-8b2c-000000000000',
      messageCreatedAt: createdAtSeconds,
    });
    expect(row).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('plán obou dotazů je Index Scan nad jednou partition, nikdy Seq Scan', async () => {
    // Jména oddílů se berou z katalogu, ne z regulárního výrazu nad konvencí
    // pojmenování. Konvenci vlastní P03 a kdyby ji změnil, regex by přestal
    // sedět a test by prošel s nulou nalezených oddílů, tedy zeleně a naprázdno.
    const { rows: parts } = await asMigrator().query<{ name: string }>(
      `SELECT c.relname AS name
         FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'messages'::regclass`,
    );
    expect(parts.length).toBeGreaterThan(1); // jinak by test nic neměřil

    const plan = await explain(
      `SELECT id, created_at, campaign_id, contact_id, workspace_id, sent_at
         FROM messages WHERE id = $1 AND created_at = to_timestamp($2)`,
      [messageId, createdAtSeconds],
    );
    expect(plan).not.toContain('Seq Scan');
    expect(parts.filter((p) => plan.includes(p.name))).toHaveLength(1);
  });
});
