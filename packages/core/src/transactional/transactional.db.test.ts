import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import type { Document } from '@mlain/emails/document/types';
import type { FieldCatalog } from '../contacts/fields/catalog';
import { seedWorkspaceForCoreTests } from '../identity/test-helpers';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { addSuppression } from '../contacts/repo/suppressions';
import { createTemplate, type ServiceContext } from '../templates/service';
import { closePools, withWorkspace } from '../tx';
import { sendTransactional, TransactionalSendError } from './send';

let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

const catalog: FieldCatalog = { version: 'v1', fields: [] };
const ASSETS = 'https://assets.test';

const footer = { id: 'b_000000000099', type: 'footer', props: blockDefaults('footer') };

/**
 * Šablona resetu hesla: tlačítko, jehož odkaz PŘIJDE V POŽADAVKU.
 *
 * `trackable: true` je tu schválně. Transakční profil sledování vynutí na
 * vypnuté, takže `liquid_in_trackable_href` nesmí zablokovat uložení ani
 * kompilaci. Kdyby to někdo rozbil, spadne tenhle test, ne až produkce.
 */
const resetButton = {
  id: 'b_000000000010',
  type: 'button',
  props: {
    ...blockDefaults('button'),
    label: [{ t: 'p', children: [{ t: 's', v: 'Nastavit nové heslo' }] }],
    href: '{{ data.reset_url }}',
    trackable: true,
  },
};

const expiryText = {
  id: 'b_000000000011',
  type: 'text',
  props: {
    ...blockDefaults('text'),
    content: [
      {
        t: 'p',
        children: [
          { t: 's', v: 'Odkaz platí ' },
          { t: 'var', expr: 'data.expires_in_minutes' },
          { t: 's', v: ' minut.' },
        ],
      },
    ],
  },
};

function documentWith(children: unknown[]): Document {
  return {
    schemaVersion: 1,
    meta: { name: 'Reset hesla', previewText: 'Nastavte si nové heslo', language: 'cs' },
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

async function seedWorkspace(options: { templateKind?: 'campaign' | 'transactional' } = {}) {
  const ws = await seedWorkspaceForCoreTests();
  const ctx: ServiceContext = { ctx: ws.ctx, fields: catalog, userId: ws.userId };

  await withWorkspace(ws.ctx, async (tx) => {
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
    // Odesílací identita se bere z poslední uživatelské kampaně, stejně jako
    // u testovacího odeslání a u e-mailu z formuláře.
    await tx.insert(schema.campaigns).values({
      workspaceId: ws.workspaceId,
      name: 'Jarní novinky',
      status: 'draft',
      subject: 'Jaro je tady',
      fromName: 'Shop',
      fromEmail: 'noreply@shop.cz',
      providerId: provider!.id,
    });
  });

  const template = await createTemplate(ctx, {
    name: 'Reset hesla',
    kind: options.templateKind ?? 'transactional',
    document: documentWith([resetButton, expiryText]),
  });
  return { ws, ctx, template };
}

const RESET_URL = 'https://shop.cz/reset?token=eyJhbGciOi&uid=8472';

async function send(
  ws: Awaited<ReturnType<typeof seedWorkspace>>['ws'],
  input: Parameters<typeof sendTransactional>[1],
) {
  return sendTransactional(ws.ctx, input);
}

describe('transakční odeslání přes API', () => {
  it('založí zprávu kind = transactional pod skrytou kampaní a dosadí odkaz do tlačítka', async () => {
    const { ws, template } = await seedWorkspace();

    const result = await send(ws, {
      templateId: template.id,
      to: { email: 'jan.novak@example.cz', name: 'Jan' },
      data: { reset_url: RESET_URL, expires_in_minutes: 30 },
      assetBaseUrl: ASSETS,
    });

    const [message] = await withWorkspace(ws.ctx, (tx) =>
      tx.select().from(schema.messages).where(eq(schema.messages.id, result.messageId)),
    );
    expect(message!.kind).toBe('transactional');
    expect(message!.status).toBe('pending');
    expect(message!.email).toBe('jan.novak@example.cz');
    expect(message!.campaignId).toBe(result.campaignId);
    // Hodnota z volání leží v render_data pod kořenem `data`, ne v kontaktu.
    // Kdyby se ukládala do `contact.attr`, dva souběžné resety pro tutéž
    // adresu by si token přepsaly a jeden člověk by dostal odkaz druhého.
    expect((message!.renderData as Record<string, unknown>)['data']).toEqual({
      reset_url: RESET_URL,
      expires_in_minutes: 30,
    });

    const [campaign] = await withWorkspace(ws.ctx, (tx) =>
      tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, result.campaignId)),
    );
    expect(campaign!.kind).toBe('system');
    expect(campaign!.status).toBe('draft');
    // Rozhodnutí zadavatele: transakční pošta se neměří.
    expect(campaign!.trackOpens).toBe(false);
    expect(campaign!.trackClicks).toBe(false);
    // Proměnná v odkazu se nikdy nepřepíše na trackovací značku, takže
    // jednorázový token nemá jak uniknout do statistik.
    expect(campaign!.compiledHtml).toContain('{{ data.reset_url');
    expect(campaign!.compiledHtml).not.toContain('track.mlain.invalid');
  });

  it('bez sledování nevznikne ani jeden odkaz v campaign_links', async () => {
    const { ws, template } = await seedWorkspace();
    const result = await send(ws, {
      templateId: template.id,
      to: { email: 'jan.novak@example.cz' },
      data: { reset_url: RESET_URL, expires_in_minutes: 30 },
      assetBaseUrl: ASSETS,
    });
    const links = await withWorkspace(ws.ctx, (tx) =>
      tx
        .select()
        .from(schema.campaignLinks)
        .where(eq(schema.campaignLinks.campaignId, result.campaignId)),
    );
    expect(links).toHaveLength(0);
  });

  it('chybějící proměnná je chyba, ne prázdný odkaz', async () => {
    const { ws, template } = await seedWorkspace();
    await expect(
      send(ws, {
        templateId: template.id,
        to: { email: 'jan.novak@example.cz' },
        data: { expires_in_minutes: 30 },
        assetBaseUrl: ASSETS,
      }),
    ).rejects.toMatchObject({
      message: 'transactional_variable_unknown',
      params: { paths: ['data.reset_url'] },
    });
  });

  it('kampaňová šablona tímhle rozhraním neprojde', async () => {
    const { ws, template } = await seedWorkspace({ templateKind: 'campaign' });
    await expect(
      send(ws, {
        templateId: template.id,
        to: { email: 'jan.novak@example.cz' },
        data: { reset_url: RESET_URL },
        assetBaseUrl: ASSETS,
      }),
    ).rejects.toBeInstanceOf(TransactionalSendError);
  });

  it('založí kontakt bez souhlasu, bez seznamu a se zdrojem api', async () => {
    const { ws, template } = await seedWorkspace();
    const result = await send(ws, {
      templateId: template.id,
      to: { email: 'novy@example.cz', name: 'Nováček' },
      data: { reset_url: RESET_URL, expires_in_minutes: 30 },
      assetBaseUrl: ASSETS,
    });

    const [contact] = await withWorkspace(ws.ctx, (tx) =>
      tx.select().from(schema.contacts).where(eq(schema.contacts.id, result.contactId)),
    );
    expect(contact!.source).toBe('api');
    expect(contact!.firstName).toBe('Nováček');

    // Že aplikace zákazníka zavolala reset hesla, není souhlas s newsletterem.
    const subs = await withWorkspace(ws.ctx, (tx) =>
      tx
        .select()
        .from(schema.listSubscriptions)
        .where(eq(schema.listSubscriptions.contactId, result.contactId)),
    );
    expect(subs).toHaveLength(0);
    const consents = await withWorkspace(ws.ctx, (tx) =>
      tx.select().from(schema.consents).where(eq(schema.consents.contactId, result.contactId)),
    );
    expect(consents).toHaveLength(0);
  });

  it('při create_contact = false neznámá adresa vrátí chybu, nemlčí', async () => {
    const { ws, template } = await seedWorkspace();
    await expect(
      send(ws, {
        templateId: template.id,
        to: { email: 'nikdo@example.cz' },
        data: { reset_url: RESET_URL, expires_in_minutes: 30 },
        createContact: false,
        assetBaseUrl: ASSETS,
      }),
    ).rejects.toMatchObject({ message: 'recipient_unknown' });
  });

  it('existující kontakt se použije, nezaloží se druhý', async () => {
    const { ws, template } = await seedWorkspace();
    const existingId = await withWorkspace(ws.ctx, async (tx) => {
      const [row] = await tx
        .insert(schema.contacts)
        .values({ workspaceId: ws.workspaceId, email: 'jana@example.cz', firstName: 'Jana' })
        .returning({ id: schema.contacts.id });
      return row!.id;
    });

    const result = await send(ws, {
      templateId: template.id,
      to: { email: 'jana@example.cz' },
      data: { reset_url: RESET_URL, expires_in_minutes: 30 },
      assetBaseUrl: ASSETS,
    });
    expect(result.contactId).toBe(existingId);
  });

  it('odhlášení z marketingu transakční poštu NEZASTAVÍ', async () => {
    const { ws, template } = await seedWorkspace();
    // Přímý INSERT do suppressions je v produktu zakázaný: otisk si počítá
    // sama `addSuppression` pod aktuálním klíčem. Test proto jede touž cestou.
    await addSuppression(ws.ctx, {
      email: 'odhlaseny@example.cz',
      reason: 'global_unsubscribe',
      source: 'app',
    });

    const result = await send(ws, {
      templateId: template.id,
      to: { email: 'odhlaseny@example.cz' },
      data: { reset_url: RESET_URL, expires_in_minutes: 30 },
      assetBaseUrl: ASSETS,
    });
    expect(result.messageId).toBeTruthy();
    expect(result.warnings).toEqual([]);
  });

  it('tvrdý odraz transakční poštu zastaví', async () => {
    const { ws, template } = await seedWorkspace();
    // Přímý INSERT do suppressions je v produktu zakázaný: otisk si počítá
    // sama `addSuppression` pod aktuálním klíčem. Test proto jede touž cestou.
    await addSuppression(ws.ctx, {
      email: 'neexistuje@example.cz',
      reason: 'hard_bounce',
      source: 'sender',
    });

    await expect(
      send(ws, {
        templateId: template.id,
        to: { email: 'neexistuje@example.cz' },
        data: { reset_url: RESET_URL, expires_in_minutes: 30 },
        assetBaseUrl: ASSETS,
      }),
    ).rejects.toMatchObject({
      message: 'recipient_suppressed',
      params: { reason: 'hard_bounce' },
    });
  });

  it('ruční blokace projde, ale s varováním', async () => {
    const { ws, template } = await seedWorkspace();
    // Přímý INSERT do suppressions je v produktu zakázaný: otisk si počítá
    // sama `addSuppression` pod aktuálním klíčem. Test proto jede touž cestou.
    await addSuppression(ws.ctx, { email: 'rucne@example.cz', reason: 'manual', source: 'app' });

    const result = await send(ws, {
      templateId: template.id,
      to: { email: 'rucne@example.cz' },
      data: { reset_url: RESET_URL, expires_in_minutes: 30 },
      assetBaseUrl: ASSETS,
    });
    expect(result.warnings).toEqual([
      { code: 'recipient_suppressed_soft', params: { reason: 'manual' } },
    ]);
  });

  it('objekt data nad limitem skončí chybou, ne oříznutím', async () => {
    const { ws, template } = await seedWorkspace();
    await expect(
      send(ws, {
        templateId: template.id,
        to: { email: 'jan.novak@example.cz' },
        data: { reset_url: RESET_URL, padding: 'x'.repeat(17_000) },
        assetBaseUrl: ASSETS,
      }),
    ).rejects.toMatchObject({ message: 'transactional_data_too_large' });
  });

  it('druhé volání přepíše nosnou kampaň a zvýší revizi, nezaloží druhou', async () => {
    const { ws, template } = await seedWorkspace();
    const first = await send(ws, {
      templateId: template.id,
      to: { email: 'jan.novak@example.cz' },
      data: { reset_url: RESET_URL, expires_in_minutes: 30 },
      assetBaseUrl: ASSETS,
    });
    const second = await send(ws, {
      templateId: template.id,
      to: { email: 'jana@example.cz' },
      data: { reset_url: RESET_URL, expires_in_minutes: 30 },
      assetBaseUrl: ASSETS,
    });
    expect(second.campaignId).toBe(first.campaignId);

    const [campaign] = await withWorkspace(ws.ctx, (tx) =>
      tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, first.campaignId)),
    );
    // Sender cachuje hlavičku podle dvojice (campaign_id, revision). Bez
    // inkrementu by po úpravě šablony odešel starý obsah a nic by nespadlo.
    expect(campaign!.revision).toBeGreaterThan(1);
  });
});
