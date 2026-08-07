import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceContext } from '../../../identity/types';
import {
  registerRevokePendingMessages,
  resetRevokePendingMessages,
  type RevokePendingMessagesInput,
} from '../../campaigns-port';
import { resetConsentEraser } from '../../gdpr/consents-role';
import { purgeContact } from '../../gdpr/erase';
import { severContactLinks } from '../../jobs/gdpr-sever-links';
import { createGdprRequest } from '../../repo/gdpr';
import { asMigrator, testContext } from '../support/db';
import {
  all,
  closeGdprPool,
  contactExists,
  countRowsFor,
  createFullContact,
  ensureQueue,
  gdprRequestRow,
  one,
  suppressionByFingerprintOf,
  useGdprConsentEraser,
} from '../support/phase-c';

const revoke = vi.fn(async (_input: RevokePendingMessagesInput) => ({ revoked: 0 }));

beforeAll(async () => {
  await ensureQueue('gdpr.sever_links');
});

beforeEach(() => {
  revoke.mockClear();
  registerRevokePendingMessages(revoke);
  useGdprConsentEraser();
});

afterEach(() => {
  resetRevokePendingMessages();
  resetConsentEraser();
});

afterAll(async () => {
  await closeGdprPool();
});

/**
 * Kampaně a k nim zprávy, události a engagement. Vše pod migrátorem, jde o výchozí stav.
 *
 * Každá zpráva má vlastní kampaň, protože částečný unikátní index
 * `(campaign_id, contact_id, created_at)` nedovolí dvě zprávy téhož kontaktu v jedné
 * kampani. Je to invariant materializace publika, ne omezení testu.
 */
async function seedCampaignTraffic(
  ctx: WorkspaceContext,
  contactId: string,
  count: number,
): Promise<{ campaignIds: string[] }> {
  const campaignIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    campaignIds.push(await seedOneCampaign(ctx, contactId));
  }
  return { campaignIds };
}

async function seedOneCampaign(ctx: WorkspaceContext, contactId: string): Promise<string> {
  // `fk_messages__campaign_audience` je složený cizí klíč (campaign_id, created_at)
  // na (campaigns.id, campaigns.audience_built_at). Kampaň bez materializace tedy
  // nemůže mít zprávy a `created_at` zprávy MUSÍ být rovné `audience_built_at`.
  const campaign = await one<{ id: string }>(
    `INSERT INTO campaigns (workspace_id, name, status, audience_built_at)
     VALUES ($1, 'Kampaň', 'draft', now()) RETURNING id`,
    [ctx.workspaceId],
  );

  // Hodnota `audience_built_at` se čte poddotazem a nejde přes JavaScript:
  // timestamptz má v PostgreSQL mikrosekundy, kdežto `Date` jen milisekundy,
  // takže by se po zaokrouhlení s rodičovským řádkem přestala shodovat
  // a cizí klíč by spadl.
  const message = await one<{ id: string }>(
    `INSERT INTO messages (workspace_id, campaign_id, contact_id, email, render_data, status,
                           created_at)
     VALUES ($1, $2, $3, $4, '{"first_name":"Jana"}'::jsonb, 'sent',
             (SELECT audience_built_at FROM campaigns WHERE id = $2))
     RETURNING id`,
    [ctx.workspaceId, campaign.id, contactId, 'j@x.cz'],
  );
  await asMigrator().query(
    `INSERT INTO message_events (workspace_id, message_id, message_created_at, campaign_id,
                                 contact_id, recipient, type, ts, source)
     VALUES ($1, $2, (SELECT audience_built_at FROM campaigns WHERE id = $3), $3, $4,
             'j@x.cz', 'open', now(), 'tracking')`,
    [ctx.workspaceId, message.id, campaign.id, contactId],
  );
  await asMigrator().query(
    `INSERT INTO message_engagement (message_id, created_at, workspace_id, campaign_id,
                                     contact_id, open_count)
     VALUES ($1, (SELECT audience_built_at FROM campaigns WHERE id = $3), $2, $3, $4, 1)`,
    [message.id, ctx.workspaceId, campaign.id, contactId],
  );

  return campaign.id;
}

async function campaignOpenCount(ctx: WorkspaceContext, campaignId: string): Promise<number> {
  const row = await one<{ total: string }>(
    `SELECT count(*) AS total FROM message_events
      WHERE workspace_id = $1 AND campaign_id = $2 AND type = 'open'`,
    [ctx.workspaceId, campaignId],
  );
  return Number(row.total);
}

describe('fyzické smazání', () => {
  it('smaže řádek i všechny kaskády', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await purgeContact(ctx, contact.id);
    expect(await contactExists(ctx, contact.id)).toBe(false);
    expect(await countRowsFor('consents', ctx, contact.id)).toBe(0);
  });

  it('suppression řádek zůstává i po fyzickém smazání', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await purgeContact(ctx, contact.id);
    // Po kontaktu nezbude nic, takže proti vzkříšení dalším importem chrání
    // JEN suppression řádek. Proto se zakládá i v tomhle režimu.
    expect((await suppressionByFingerprintOf(ctx, 'j@x.cz'))?.reason).toBe('gdpr_erasure');
  });

  it('záznam v gdpr_requests zůstává s počty', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    const request = await createGdprRequest(ctx, {
      email: 'j@x.cz',
      type: 'erasure',
      mode: 'purge',
      channel: 'preference_center',
    });
    await purgeContact(ctx, contact.id, request.id);
    const row = await gdprRequestRow(ctx, request.id);
    expect(row.affected).toHaveProperty('contacts');
  });
});

describe('odstřižení vazeb v cizích doménách', () => {
  it('zprávy si contact_id NECHÁVAJÍ, mizí z nich adresa a render_data', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await seedCampaignTraffic(ctx, contact.id, 3);
    await severContactLinks({ workspaceId: ctx.workspaceId, contactId: contact.id });

    // messages.contact_id je NOT NULL (rozhodnutí R3 plánu P03). Očekávat nula zpráv
    // s vazbou by znamenalo očekávat přesně to, co databáze nedovolí.
    const rows = await all<{ email: string; render_data: unknown }>(
      `SELECT email, render_data FROM messages WHERE workspace_id = $1 AND contact_id = $2`,
      [ctx.workspaceId, contact.id],
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.email).toBe(`erased+${contact.id}@erased.invalid`);
      expect(row.render_data).toEqual({});
    }
  });

  it('REGRESE: vynulování web_events bez erased_at by porušilo CHECK', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    // Serverová událost má vyplněné JEN contact_id. ck_web_events__subject žádá
    // aspoň jednu z trojice anonymous_id, contact_id, erased_at, takže samotné
    // vynulování skončí na 23514 a shodí celou transakci.
    await asMigrator().query(
      `INSERT INTO web_events (id, occurred_at, workspace_id, name, contact_id, source)
       VALUES (gen_random_uuid(), now(), $1, 'page_view', $2, 'server')`,
      [ctx.workspaceId, contact.id],
    );

    await expect(
      severContactLinks({ workspaceId: ctx.workspaceId, contactId: contact.id }),
    ).resolves.toBeTruthy();

    const event = await one<{ contact_id: string | null; erased_at: Date | null }>(
      `SELECT contact_id, erased_at FROM web_events WHERE workspace_id = $1`,
      [ctx.workspaceId],
    );
    expect(event.contact_id).toBeNull();
    expect(event.erased_at).not.toBeNull();
  });

  it('ČLÁNEK 17: e-mail ani otisk prohlížeče nezůstanou ve web_events', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    // Přesně ten tvar, jaký v databázi opravdu leží: událost `identify` nese
    // v properties traits s e-mailem a jménem plus dva identifikátory osoby,
    // context nese IP a složky otisku prohlížeče a page historii procházení.
    // Sloupcový GRANT UPDATE z migrace 0005 na žádný z těch tří sloupců
    // NESAHAL, takže je výmaz nechával být.
    await asMigrator().query(
      `INSERT INTO web_events
         (id, occurred_at, workspace_id, name, contact_id, source, properties, context, page)
       VALUES (gen_random_uuid(), now(), $1, 'identify', $2, 'web', $3::jsonb, $4::jsonb, $5::jsonb)`,
      [
        ctx.workspaceId,
        contact.id,
        JSON.stringify({
          traits: { email: 'j@x.cz', first_name: 'Jan' },
          external_id: 'customer_42',
          signature: 'cIuTWeEV9kUyCck2N8HiPwVnMBu3n8EHzQoXJBTnpm8',
        }),
        JSON.stringify({
          ip: '203.0.113.7',
          browser: 'Firefox 129',
          screen: { w: 3440, h: 1440 },
          timezone: 'Europe/Prague',
        }),
        // `search` je tu schválně: dotazový řetězec bere, co do něj zákazník dá,
        // takže se do historie procházení dostane i adresa samotná.
        JSON.stringify({
          url: 'https://obchod.example.cz/kosik?email=j@x.cz',
          path: '/kosik',
          search: '?email=j@x.cz',
          referrer: 'https://obchod.example.cz/produkt/intimni-zdravi',
          title: 'Košík',
        }),
      ],
    );

    await severContactLinks({ workspaceId: ctx.workspaceId, contactId: contact.id });

    const event = await one<{
      properties: unknown;
      context: unknown;
      page: unknown;
      erased_at: Date | null;
    }>(
      `SELECT properties, context, page, erased_at FROM web_events
        WHERE workspace_id = $1 AND name = 'identify'`,
      [ctx.workspaceId],
    );
    expect(event.properties).toEqual({});
    expect(event.context).toEqual({});
    expect(event.page).toEqual({});
    expect(event.erased_at).not.toBeNull();

    // Nejtvrdší tvrzení souboru: adresa nesmí zbýt NIKDE v tabulce, ani
    // zanořená v jsonb, ani schovaná v dotazovém řetězci navštívené adresy.
    // Kontrola na rovnost `{}` po jednotlivých sloupcích by prošla i tehdy,
    // kdyby se e-mail přestěhoval do jiného sloupce.
    const leftovers = await one<{ total: string }>(
      `SELECT count(*) AS total FROM web_events
        WHERE workspace_id = $1
          AND (properties::text LIKE '%j@x.cz%'
            OR context::text LIKE '%j@x.cz%'
            OR page::text LIKE '%j@x.cz%')`,
      [ctx.workspaceId],
    );
    expect(Number(leftovers.total)).toBe(0);
  });

  it('ČLÁNEK 17: adresa nezůstane v message_events.recipient ani v engagementu', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await seedCampaignTraffic(ctx, contact.id, 1);
    await severContactLinks({ workspaceId: ctx.workspaceId, contactId: contact.id });

    // Bez tohohle kroku by původní adresa zůstala uložená v plaintextu ve sloupci
    // recipient a vazba na osobu v message_engagement.
    const recipients = await all<{ recipient: string | null }>(
      `SELECT recipient FROM message_events WHERE workspace_id = $1`,
      [ctx.workspaceId],
    );
    expect(recipients.map((r) => r.recipient)).not.toContain('j@x.cz');

    const engagement = await one<{ total: string }>(
      `SELECT count(*) AS total FROM message_engagement WHERE workspace_id = $1 AND contact_id = $2`,
      [ctx.workspaceId, contact.id],
    );
    expect(Number(engagement.total)).toBe(0);
  });

  /**
   * NÁLEZ ze 7. 8. 2026. `inbound_deliveries` drží syrovou zprávu od
   * poskytovatele a `markDelivery` jí při mapování doplní `contact_id`,
   * takže po výmazu zůstávala adresa v plaintextu a vedla přímo k vymazané
   * osobě. Retenční cíl ty řádky sice po 30 dnech maže, ale lhůta je
   * nastavení projektu a dá se prodloužit i vypnout; výmaz podle článku 17
   * se na ni spoléhat nesmí.
   */
  it('ČLÁNEK 17: adresa nezůstane v příchozím doručení od poskytovatele', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');

    const endpoint = await asMigrator().query<{ id: string }>(
      `INSERT INTO inbound_endpoints (workspace_id, name, slug, signature_mode, mapping)
       VALUES ($1, 'E-shop', $2, 'none', '{}'::jsonb) RETURNING id`,
      [ctx.workspaceId, `vymaz${Date.now()}${process.pid}`.slice(0, 32).padEnd(24, '0')],
    );
    await asMigrator().query(
      `INSERT INTO inbound_deliveries
         (workspace_id, endpoint_id, status, contact_id, payload, headers)
       VALUES ($1, $2, 'processed', $3, $4::jsonb, $5::jsonb)`,
      [
        ctx.workspaceId,
        endpoint.rows[0]!.id,
        contact.id,
        JSON.stringify({
          type: 'bounce',
          recipient: 'j@x.cz',
          diagnostic: 'smtp; 550 5.1.1 user unknown j@x.cz',
        }),
        JSON.stringify({ 'x-forwarded-for': '203.0.113.7', from: 'j@x.cz' }),
      ],
    );

    await severContactLinks({ workspaceId: ctx.workspaceId, contactId: contact.id });

    const delivery = await one<{
      contact_id: string | null;
      payload: unknown;
      headers: unknown;
      status: string;
    }>(
      `SELECT contact_id, payload, headers, status FROM inbound_deliveries
        WHERE workspace_id = $1`,
      [ctx.workspaceId],
    );
    expect(delivery.contact_id).toBeNull();
    expect(delivery.payload).toEqual({});
    expect(delivery.headers).toEqual({});
    // Řádek zůstává a diagnostika s ním: „kolik odrazů z tohohle endpointu"
    // odpovídá dál, mizí jen osoba.
    expect(delivery.status).toBe('processed');

    const leftovers = await one<{ total: string }>(
      `SELECT count(*) AS total FROM inbound_deliveries
        WHERE workspace_id = $1
          AND (payload::text LIKE '%j@x.cz%' OR headers::text LIKE '%j@x.cz%')`,
      [ctx.workspaceId],
    );
    expect(Number(leftovers.total)).toBe(0);
  });

  it('je idempotentní', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await seedCampaignTraffic(ctx, contact.id, 2);
    const payload = { workspaceId: ctx.workspaceId, contactId: contact.id };
    const first = await severContactLinks(payload);
    const second = await severContactLinks(payload);
    // Druhý běh po pádu workeru nesmí nic zkazit ani nic znovu přepsat.
    expect(second.messages).toBe(0);
    expect(second.webEvents).toBe(0);
    expect(first.messages).toBeGreaterThanOrEqual(0);
  });

  it('KRITÉRIUM 67: agregované počty kampaně se nemění', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    const { campaignIds } = await seedCampaignTraffic(ctx, contact.id, 5);
    const before = await campaignOpenCount(ctx, campaignIds[0]!);
    await severContactLinks({ workspaceId: ctx.workspaceId, contactId: contact.id });
    expect(await campaignOpenCount(ctx, campaignIds[0]!)).toBe(before);
  });
});
