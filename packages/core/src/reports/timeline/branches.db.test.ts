import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestTx,
  startTestDatabase,
  testContext,
  type TestDatabase,
} from '../test-support/db';
import {
  ensurePartitions,
  seedCampaign,
  seedContact,
  seedMessageEvent,
  seedWorkspace,
} from '../test-support/fixtures';
import { contactBranch, messageBranch, messageEventBranch, webEventBranch } from './branches';
import { pickWindow } from './months';

// Okno se skládá stejně jako v provozu, aby se test neptal jiných čísel
// než produkční kód. Retence 37 měsíců je výchozí hodnota P01.
const WINDOW = pickWindow(
  new Date('2026-08-01T00:00:00.000Z'),
  new Date('2026-07-01T00:00:00.000Z'),
  37,
);

describe('větve časové osy', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('větev zpráv vrátí položku "dostal kampaň" i bez jediné události (kritérium 84)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId);
    await db.pool.query(
      `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, status, created_at, sent_at)
       VALUES ($1, $2, $3, $4, 'x@example.cz', 'sent', $5, '2026-07-31T14:38:00.000Z')`,
      [randomUUID(), ws.workspaceId, campaign.campaignId, contact, campaign.audienceBuiltAt],
    );

    const rows = await messageBranch(createTestTx(db), testContext(ws.workspaceId), {
      contactId: contact,
      window: WINDOW,
      limit: 51,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('message_sent');
    expect(rows[0]?.occurredAt.toISOString()).toBe('2026-07-31T14:38:00.000Z');
    expect(rows[0]?.campaign?.name).toBe('Letní výprodej');
  });

  it('větev událostí zprávy skryje boty, skenery a předstahování (kritérium 69)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId);
    const messageId = randomUUID();
    await db.pool.query(
      `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, status, created_at, sent_at)
       VALUES ($1, $2, $3, $4, 'x@example.cz', 'sent', $5, $5)`,
      [messageId, ws.workspaceId, campaign.campaignId, contact, campaign.audienceBuiltAt],
    );
    const events: Array<[string, string | null]> = [
      ['open', 'human'],
      ['open', 'proxy_apple'],
      ['open', 'bot'],
      ['click', 'human'],
      ['click', 'scanner'],
      ['delivered', null],
    ];
    for (const [type, subtype] of events) {
      await seedMessageEvent(db, {
        workspaceId: ws.workspaceId,
        campaignId: campaign.campaignId,
        messageId,
        messageCreatedAt: campaign.audienceBuiltAt,
        contactId: contact,
        type,
        subtype,
        ts: '2026-07-31T15:00:00.000Z',
      });
    }

    const rows = await messageEventBranch(createTestTx(db), testContext(ws.workspaceId), {
      contactId: contact,
      window: WINDOW,
      limit: 51,
    });
    const types = rows.map((r) => `${r.type}:${r.reliability ?? '-'}`);
    expect(types).toContain('message_opened:confirmed');
    expect(types).toContain('message_opened:machine');
    expect(types).toContain('message_clicked:confirmed');
    expect(types).toContain('message_delivered:-');
    expect(rows).toHaveLength(4);
  });

  /**
   * Proklik na odkaz v patičce dostane VLASTNÍ typ položky.
   *
   * Bez toho z něj byla věta „Klikl na  v kampani Test kampaň", tedy s dírou
   * uprostřed: systémový odkaz nemá řádek v `campaign_links`, takže slot
   * `{link}` nikdo nenaplnil. Přitom je z `metadata.system_link` přesně známo,
   * kam příjemce klikl, a „Otevřel centrum předvoleb" je užitečnější věta.
   */
  it('proklik na systémový odkaz dostane vlastní typ a zůstane potvrzený', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId);
    const messageId = randomUUID();
    await db.pool.query(
      `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, status, created_at, sent_at)
       VALUES ($1, $2, $3, $4, 'x@example.cz', 'sent', $5, $5)`,
      [messageId, ws.workspaceId, campaign.campaignId, contact, campaign.audienceBuiltAt],
    );
    for (const kind of ['preferences', 'unsubscribe_page', 'webview']) {
      await seedMessageEvent(db, {
        workspaceId: ws.workspaceId,
        campaignId: campaign.campaignId,
        messageId,
        messageCreatedAt: campaign.audienceBuiltAt,
        contactId: contact,
        type: 'click',
        subtype: 'system',
        ts: '2026-07-31T15:00:00.000Z',
        metadata: { system_link: kind },
      });
    }

    const rows = await messageEventBranch(createTestTx(db), testContext(ws.workspaceId), {
      contactId: contact,
      window: WINDOW,
      limit: 51,
    });

    const types = rows.map((r) => r.type).sort();
    expect(types).toEqual([
      'message_clicked_preferences',
      'message_clicked_unsubscribe_page',
      'message_clicked_webview',
    ]);
    // Stránku odhlášení ani předvoleb si poštovní klient sám neotevře.
    expect(rows.every((r) => r.reliability === 'confirmed')).toBe(true);
    expect(rows[0]?.detail).toMatchObject({ subtype: 'system' });
  });

  it('odraz, který dorazil dlouho po odeslání, v ose zůstane (R21)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId);
    const messageId = randomUUID();
    await db.pool.query(
      `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, status, created_at, sent_at)
       VALUES ($1, $2, $3, $4, 'x@example.cz', 'sent', $5, $5)`,
      [messageId, ws.workspaceId, campaign.campaignId, contact, campaign.audienceBuiltAt],
    );
    // Událost vznikla uvnitř okna, ale provider ji doručil o třicet dní později.
    // Se sedmidenní mezí převzatou z ck_web_events__lag by z osy tiše zmizela.
    await ensurePartitions(db, new Date('2026-08-30T00:00:00.000Z'));
    await seedMessageEvent(db, {
      workspaceId: ws.workspaceId,
      campaignId: campaign.campaignId,
      messageId,
      messageCreatedAt: campaign.audienceBuiltAt,
      contactId: contact,
      type: 'bounced_soft',
      ts: '2026-07-31T15:00:00.000Z',
      receivedAt: '2026-08-30T15:00:00.000Z',
      recipient: 'x@example.cz',
    });

    const rows = await messageEventBranch(createTestTx(db), testContext(ws.workspaceId), {
      contactId: contact,
      window: WINDOW,
      limit: 51,
    });
    expect(rows.map((r) => r.type)).toEqual(['message_bounced']);
  });

  it('větev webu prořezává partition podle received_at', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await ensurePartitions(db, new Date('2026-07-15T00:00:00.000Z'));
    await db.pool.query(
      `INSERT INTO web_events (id, received_at, occurred_at, workspace_id, name, contact_id, session_id, source, page)
       VALUES (gen_random_uuid(), '2026-07-15T10:00:00.000Z', '2026-07-15T09:59:00.000Z', $1, 'page_view', $2, gen_random_uuid(), 'web', $3)`,
      [ws.workspaceId, contact, JSON.stringify({ url: 'https://x.cz/kola', title: 'Kola' })],
    );

    const rows = await webEventBranch(createTestTx(db), testContext(ws.workspaceId), {
      contactId: contact,
      window: WINDOW,
      limit: 51,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('page_view');
    expect(rows[0]?.slots['page']).toBe('https://x.cz/kola');
  });

  /**
   * Otevření e-mailu je v ose JEDNOU, ne dvakrát.
   *
   * `process-engagement` je zapisuje i do `web_events` jako `email_opened`,
   * takže v ose stálo „Otevřel kampaň …" a hned pod tím „Událost email_opened".
   * Druhá položka navíc tvrdila, že jde o web, přestože kontakt na web nepřišel.
   */
  it('větev webu přeskočí události, které přišly z e-mailu', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await ensurePartitions(db, new Date('2026-07-15T10:00:00.000Z'));
    await db.pool.query(
      `INSERT INTO web_events (id, occurred_at, received_at, workspace_id, name, contact_id, source, page)
       VALUES (gen_random_uuid(), '2026-07-15T10:00:00.000Z', '2026-07-15T09:59:00.000Z', $1, 'email_opened', $2, 'email', '{}'::jsonb),
              (gen_random_uuid(), '2026-07-15T10:05:00.000Z', '2026-07-15T10:04:00.000Z', $1, 'page_view', $2, 'web', $3)`,
      [ws.workspaceId, contact, JSON.stringify({ url: 'https://x.cz/a' })],
    );

    const rows = await webEventBranch(createTestTx(db), testContext(ws.workspaceId), {
      contactId: contact,
      window: WINDOW,
      limit: 51,
    });

    expect(rows.map((r) => r.type)).toEqual(['page_view']);
  });

  it('větev kontaktu složí vznik, přihlášení a souhlasy', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await db.pool.query(
      `UPDATE contacts SET created_at = '2026-07-02T08:00:00.000Z' WHERE id = $1`,
      [contact],
    );
    const listId = randomUUID();
    await db.pool.query(
      `INSERT INTO lists (id, workspace_id, name) VALUES ($1, $2, 'Newsletter')`,
      [listId, ws.workspaceId],
    );
    await db.pool.query(
      `INSERT INTO list_subscriptions (contact_id, list_id, workspace_id, status, source, subscribed_at)
       VALUES ($1, $2, $3, 'confirmed', 'form', '2026-07-03T09:00:00.000Z')`,
      [contact, listId, ws.workspaceId],
    );
    await db.pool.query(
      `INSERT INTO consents (id, workspace_id, contact_id, purpose, status, legal_basis, source, occurred_at)
       VALUES (gen_random_uuid(), $1, $2, 'email_marketing', 'granted', 'consent', 'form', '2026-07-03T09:00:01.000Z')`,
      [ws.workspaceId, contact],
    );

    const rows = await contactBranch(createTestTx(db), testContext(ws.workspaceId), {
      contactId: contact,
      window: WINDOW,
      limit: 51,
    });
    expect(rows.map((r) => r.type)).toEqual([
      'consent_granted',
      'list_subscribed',
      'contact_created',
    ]);
    expect(rows[1]?.slots['list']).toBe('Newsletter');
  });
});
