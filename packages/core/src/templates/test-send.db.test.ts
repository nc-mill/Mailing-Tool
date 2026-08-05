import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import type { Document } from '@mlain/emails/document/types';
import type { FieldCatalog } from '../contacts/fields/catalog';
import { seedWorkspaceForCoreTests } from '../identity/test-helpers';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, withWorkspace } from '../tx';
import { createTemplate, type ServiceContext } from './service';
import { sendTemplateTest, TestSendError, TEST_SEND_MAX_PER_WINDOW } from './test-send';

let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

const catalog: FieldCatalog = { version: 'v1', fields: [] };

const footer = { id: 'b_000000000099', type: 'footer', props: blockDefaults('footer') };
const text = {
  id: 'b_000000000010',
  type: 'text',
  props: { ...blockDefaults('text'), content: [{ t: 'p', children: [{ t: 's', v: 'Vítejte.' }] }] },
};

function documentWith(children: unknown[]): Document {
  return {
    schemaVersion: 1,
    meta: { name: 'Uvítací e-mail', previewText: 'Vítejte', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [
      {
        id: 'b_000000000001',
        type: 'section',
        props: blockDefaults('section'),
        children: [...children, footer],
      },
    ],
  } as unknown as Document;
}

/**
 * Šablona s obsahem. Textový blok tu nebyl a musel přibýt: testovací odeslání
 * od opravy vady s prázdným e-mailem odmítá dokument, ve kterém není nic než
 * patička, takže by na něm padaly všechny ostatní testy tohohle souboru.
 */
const design = documentWith([text]);

/** Dokument, ve kterém není nic než patička. Přesně to, co se odeslat nesmí. */
const emptyDesign = documentWith([]);

/**
 * Projekt připravený k odeslání: kontakt, odesílací účet a jedna uživatelská
 * kampaň, ze které se bere odesílací identita.
 */
async function seedSendableWorkspace(options: { withCampaign?: boolean } = {}) {
  const ws = await seedWorkspaceForCoreTests();
  const ctx: ServiceContext = { ctx: ws.ctx, fields: catalog, userId: ws.userId };

  const ids = await withWorkspace(ws.ctx, async (tx) => {
    await tx.insert(schema.contacts).values({
      workspaceId: ws.workspaceId,
      email: 'kontakt@example.cz',
      firstName: 'Jana',
    });
    const [provider] = await tx
      .insert(schema.sendingProviders)
      .values({
        workspaceId: ws.workspaceId,
        name: 'SMTP',
        type: 'smtp',
        configEncrypted: 'enc:v1:test',
        status: 'ready',
      })
      .returning({ id: schema.sendingProviders.id });

    if (options.withCampaign === false) return { providerId: provider!.id };

    await tx.insert(schema.campaigns).values({
      workspaceId: ws.workspaceId,
      name: 'Jarní novinky',
      status: 'draft',
      subject: 'Jaro je tady',
      fromName: 'Demo',
      fromEmail: 'demo@example.cz',
      providerId: provider!.id,
    });
    return { providerId: provider!.id };
  });

  const template = await createTemplate(ctx, { name: 'Uvítací e-mail', document: design });
  return { ws, ctx, template, ...ids };
}

async function messagesOf(ws: { ctx: Parameters<typeof withWorkspace>[0] }) {
  return withWorkspace(ws.ctx, (tx) =>
    tx
      .select({
        email: schema.messages.email,
        kind: schema.messages.kind,
        status: schema.messages.status,
        campaignId: schema.messages.campaignId,
        renderData: schema.messages.renderData,
      })
      .from(schema.messages),
  );
}

describe('testovací odeslání šablony', () => {
  it('zařadí zprávy do outboxu pod skrytou systémovou kampaň', async () => {
    const { ws, ctx, template } = await seedSendableWorkspace();

    const result = await sendTemplateTest(ctx, {
      templateId: template.id,
      recipients: ['kolega@example.cz', 'sefka@example.cz'],
      renderData: { contact: { first_name: 'Jana' } },
      assetBaseUrl: 'https://assets.test',
    });

    expect(result.created).toBe(2);
    expect(result.subject).toBe('Uvítací e-mail');

    const messages = await messagesOf(ws);
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.kind === 'test')).toBe(true);
    expect(messages.every((m) => m.status === 'pending')).toBe(true);
    expect(messages.every((m) => m.campaignId === result.campaignId)).toBe(true);
    // `_present` plní `prepareRenderData`, stejně jako u ostré materializace.
    // Bez ní by se podmíněné bloky v testu chovaly jinak než v ostrém mailu.
    expect(messages[0]!.renderData).toHaveProperty('_present');

    const campaign = await withWorkspace(ws.ctx, (tx) =>
      tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, result.campaignId)),
    );
    expect(campaign[0]!.kind).toBe('system');
    expect(campaign[0]!.status).toBe('draft');
    expect(campaign[0]!.templateId).toBe(template.id);
    // Sender čte obsah z hlavičky kampaně, takže tam musí být zkompilovaný.
    expect(campaign[0]!.compiledHtml).toContain('<!DOCTYPE html>');
    expect(campaign[0]!.compiledText).not.toBe('');
    expect(campaign[0]!.providerId).not.toBeNull();
    expect(campaign[0]!.fromEmail).toBe('demo@example.cz');
  });

  it('skrytá kampaň se v seznamu kampaní neobjeví', async () => {
    const { ws, ctx, template } = await seedSendableWorkspace();
    await sendTemplateTest(ctx, {
      templateId: template.id,
      recipients: ['kolega@example.cz'],
      renderData: {},
      assetBaseUrl: 'https://assets.test',
    });
    const { listCampaigns } = await import('../campaigns/api/service');
    const page = await listCampaigns(ws.ctx, { limit: 50 });
    expect(page.rows.map((row) => row.name)).toEqual(['Jarní novinky']);
  });

  it('druhý test téže šablony přepíše obsah a nezaloží druhou kampaň', async () => {
    const { ws, ctx, template } = await seedSendableWorkspace();
    const send = () =>
      sendTemplateTest(ctx, {
        templateId: template.id,
        recipients: ['kolega@example.cz'],
        renderData: {},
        assetBaseUrl: 'https://assets.test',
      });
    const first = await send();
    const second = await send();
    expect(second.campaignId).toBe(first.campaignId);

    const rows = await withWorkspace(ws.ctx, (tx) =>
      tx.select().from(schema.campaigns).where(eq(schema.campaigns.kind, 'system')),
    );
    expect(rows).toHaveLength(1);
    // Sender si hlavičku cachuje podle dvojice (campaign_id, revision). Bez
    // zvýšení revize by druhý test odešel se starým obsahem a nic by nespadlo.
    expect(rows[0]!.revision).toBeGreaterThan(1);
    expect(await messagesOf(ws)).toHaveLength(2);
  });

  it('opakovaná adresa v témže testu projde, unikátní index ji neshodí', async () => {
    // Bez částečnosti indexu `uq_messages__campaign_contact` (migrace 0010)
    // by druhá zpráva spadla na 23505: obě mají týž campaign_id, týž dohledaný
    // contact_id i totéž created_at.
    const { ws, ctx, template } = await seedSendableWorkspace();
    await sendTemplateTest(ctx, {
      templateId: template.id,
      recipients: ['kolega@example.cz', 'kolega@example.cz', 'jiny@example.cz'],
      renderData: {},
      assetBaseUrl: 'https://assets.test',
    });
    expect(await messagesOf(ws)).toHaveLength(3);
  });

  it('kampaňová zpráva bez materializace naopak spadnout MUSÍ', async () => {
    // Druhá strana téže mince: migrace 0010 nesmí uvolnit invariant I1.
    const { ws } = await seedSendableWorkspace();
    await expect(
      withWorkspace(ws.ctx, async (tx) => {
        const [campaign] = await tx
          .select({ id: schema.campaigns.id })
          .from(schema.campaigns)
          .limit(1);
        const [contact] = await tx
          .select({ id: schema.contacts.id })
          .from(schema.contacts)
          .limit(1);
        await tx.insert(schema.messages).values({
          workspaceId: ws.workspaceId,
          campaignId: campaign!.id,
          contactId: contact!.id,
          kind: 'campaign',
          email: 'kdokoliv@example.cz',
        });
      }),
    ).rejects.toThrow();
  });

  it('cizí adresa na seznamu potlačených se odmítne', async () => {
    const { ws, ctx, template } = await seedSendableWorkspace();
    await withWorkspace(ws.ctx, (tx) =>
      tx.insert(schema.suppressions).values({
        workspaceId: ws.workspaceId,
        email: 'zablokovany@example.cz',
        fingerprint: Buffer.alloc(32),
        fingerprintKeyId: 1,
        reason: 'hard_bounce',
        source: 'ses_event',
      }),
    );
    await expect(
      sendTemplateTest(ctx, {
        templateId: template.id,
        recipients: ['zablokovany@example.cz'],
        renderData: {},
        assetBaseUrl: 'https://assets.test',
      }),
    ).rejects.toThrowError(/test_recipient_suppressed/);
    expect(await messagesOf(ws)).toHaveLength(0);
  });

  it('adresa člena projektu na seznamu potlačených projde', async () => {
    // Bez téhle výjimky by si uživatel nezkusil nic potom, co si sám omylem
    // nahlásil spam.
    const { ws, ctx, template } = await seedSendableWorkspace();
    // Člen TOHOHLE projektu. `users` nemá RLS, takže holé `.limit(1)` by
    // vrátilo libovolného uživatele, klidně z cizího projektu, a test by měřil
    // něco jiného, než co má.
    const [member] = await withWorkspace(ws.ctx, (tx) =>
      tx
        .select({ email: schema.users.email })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(eq(schema.memberships.workspaceId, ws.workspaceId))
        .limit(1),
    );
    await withWorkspace(ws.ctx, (tx) =>
      tx.insert(schema.suppressions).values({
        workspaceId: ws.workspaceId,
        email: member!.email,
        fingerprint: Buffer.alloc(32),
        fingerprintKeyId: 1,
        reason: 'hard_bounce',
        source: 'ses_event',
      }),
    );
    await expect(
      sendTemplateTest(ctx, {
        templateId: template.id,
        recipients: [member!.email],
        renderData: {},
        assetBaseUrl: 'https://assets.test',
      }),
    ).resolves.toMatchObject({ created: 1 });
  });

  it('šestá adresa se odmítne, strop je pět', async () => {
    const { ctx, template } = await seedSendableWorkspace();
    await expect(
      sendTemplateTest(ctx, {
        templateId: template.id,
        recipients: ['a@x.cz', 'b@x.cz', 'c@x.cz', 'd@x.cz', 'e@x.cz', 'f@x.cz'],
        renderData: {},
        assetBaseUrl: 'https://assets.test',
      }),
    ).rejects.toThrowError(/test_recipients_out_of_range/);
  });

  it('překročení limitu četnosti vrací test_rate_limited', async () => {
    const { ws, ctx, template } = await seedSendableWorkspace();
    // Limit se počítá nad skutečně vyrobenými zprávami, takže se dá naplnit
    // přímo, bez dvaceti kol odesílání.
    await withWorkspace(ws.ctx, async (tx) => {
      const [campaign] = await tx
        .select({ id: schema.campaigns.id })
        .from(schema.campaigns)
        .limit(1);
      const [contact] = await tx.select({ id: schema.contacts.id }).from(schema.contacts).limit(1);
      for (let i = 0; i < TEST_SEND_MAX_PER_WINDOW; i += 1) {
        await tx.insert(schema.messages).values({
          workspaceId: ws.workspaceId,
          campaignId: campaign!.id,
          contactId: contact!.id,
          kind: 'test',
          email: `naplneni-${i}@example.cz`,
        });
      }
    });
    await expect(
      sendTemplateTest(ctx, {
        templateId: template.id,
        recipients: ['kolega@example.cz'],
        renderData: {},
        assetBaseUrl: 'https://assets.test',
      }),
    ).rejects.toThrowError(/test_rate_limited/);
  });

  it('bez nastaveného odesílání se odmítne s vlastním kódem', async () => {
    const { ctx, template } = await seedSendableWorkspace({ withCampaign: false });
    await expect(
      sendTemplateTest(ctx, {
        templateId: template.id,
        recipients: ['kolega@example.cz'],
        renderData: {},
        assetBaseUrl: 'https://assets.test',
      }),
    ).rejects.toThrowError(/test_sending_not_configured/);
  });

  /**
   * Testovací e-mail je opravdový e-mail. Kdyby prázdná šablona prošla tudy
   * a neprošla odesláním kampaně, choval by se nástroj na dvou místech různě
   * k téže věci a uživatel by se o prázdném obsahu dozvěděl ze schránky.
   */
  it('šablona, ve které není nic než patička, se neodešle ani na test', async () => {
    const { ctx } = await seedSendableWorkspace();
    const empty = await createTemplate(ctx, { name: 'Prázdná', document: emptyDesign });

    await expect(
      sendTemplateTest(ctx, {
        templateId: empty.id,
        recipients: ['kolega@example.cz'],
        renderData: {},
        assetBaseUrl: 'https://assets.test',
      }),
    ).rejects.toThrowError(/test_template_empty/);

    // Nic se nezařadilo do outboxu: kontrola je před zápisem zpráv, ne po něm.
    expect(await messagesOf({ ctx: ctx.ctx })).toHaveLength(0);
  });

  it('cizí šablona je not_found', async () => {
    const { ctx } = await seedSendableWorkspace();
    const stranger = await seedSendableWorkspace();
    await expect(
      sendTemplateTest(ctx, {
        templateId: stranger.template.id,
        recipients: ['kolega@example.cz'],
        renderData: {},
        assetBaseUrl: 'https://assets.test',
      }),
    ).rejects.toThrowError(/not_found/);
  });

  it('smazání odesílacího účtu uklidí skrytou kampaň, nespadne na cizím klíči', async () => {
    const { ws, ctx, template, providerId } = await seedSendableWorkspace();
    await sendTemplateTest(ctx, {
      templateId: template.id,
      recipients: ['kolega@example.cz'],
      renderData: {},
      assetBaseUrl: 'https://assets.test',
    });
    // Uživatelská kampaň v draftu mazání účtu nebrání, brání jen rozpracovaná.
    await withWorkspace(ws.ctx, (tx) =>
      tx.execute(sql`UPDATE campaigns SET provider_id = NULL WHERE kind = 'campaign'`),
    );

    const { deleteProvider } = await import('../providers/repo/provider');
    await expect(deleteProvider(ws.ctx, providerId)).resolves.toBeUndefined();

    const left = await withWorkspace(ws.ctx, (tx) =>
      tx
        .select({ id: schema.campaigns.id })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.kind, 'system')),
    );
    expect(left).toHaveLength(0);
    // Čekající testovací zprávy odešly s ní, jinak by je sender claimoval
    // donekonečna naprázdno.
    expect(await messagesOf(ws)).toHaveLength(0);
  });

  it('chyba domény je TestSendError, ne holý Error', async () => {
    const { ctx, template } = await seedSendableWorkspace();
    const failure = await sendTemplateTest(ctx, {
      templateId: template.id,
      recipients: [],
      renderData: {},
      assetBaseUrl: 'https://assets.test',
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TestSendError);
  });
});
