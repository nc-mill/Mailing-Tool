import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import type { Document } from '@mlain/emails/document/types';
import type { FieldCatalog } from '../fields/catalog';
import { seedWorkspaceForCoreTests } from '../../identity/test-helpers';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import { createTemplate, type ServiceContext } from '../../templates/service';
import { closePools, withWorkspace } from '../../tx';
import { addSuppression } from '../repo/suppressions';
import { decodePublicRef } from '../public/ids';
import { CONFIRM_URL_EXPRESSION, defaultSubscriptionEmail } from './default-emails';
import { sendSubscriptionEmail } from './subscription-emails';

/**
 * E-maily seznamu se opravdu zařadí do outboxu.
 *
 * Test se ptá DATABÁZE, ne portu. Do téhle chvíle byl `sendConfirmation` no-op,
 * nikde nespadl a uživatel viděl úspěch, takže zelený test nad portem by nic
 * nedokázal: jediný důkaz je řádek v `messages` s odkazem v `render_data`.
 */

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
const APP_URL = 'https://app.test';
const TOKEN = 'abcdefghijklmnopqrstuvwx';

type Seeded = Awaited<ReturnType<typeof seedWorkspace>>;

async function seedWorkspace(options: { sendingConfigured?: boolean } = {}) {
  const ws = await seedWorkspaceForCoreTests();
  const service: ServiceContext = { ctx: ws.ctx, fields: catalog, userId: ws.userId };

  await withWorkspace(ws.ctx, async (tx) => {
    if (options.sendingConfigured !== false) {
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
    }
  });

  return { ws, service };
}

async function createList(seeded: Seeded, patch: Record<string, unknown> = {}): Promise<string> {
  return withWorkspace(seeded.ws.ctx, async (tx) => {
    const [row] = await tx
      .insert(schema.lists)
      .values({
        workspaceId: seeded.ws.workspaceId,
        name: `Newsletter ${Math.random().toString(36).slice(2)}`,
        optIn: 'double',
        ...patch,
      })
      .returning({ id: schema.lists.id });
    return row!.id;
  });
}

async function createContact(seeded: Seeded, email: string): Promise<string> {
  return withWorkspace(seeded.ws.ctx, async (tx) => {
    const [row] = await tx
      .insert(schema.contacts)
      .values({
        workspaceId: seeded.ws.workspaceId,
        email,
        status: 'unconfirmed',
        source: 'manual',
        locale: 'cs',
      })
      .returning({ id: schema.contacts.id });
    return row!.id;
  });
}

async function messagesOf(seeded: Seeded, contactId: string) {
  return withWorkspace(seeded.ws.ctx, (tx) =>
    tx.select().from(schema.messages).where(eq(schema.messages.contactId, contactId)),
  );
}

async function failureAudit(seeded: Seeded, listId: string) {
  return withWorkspace(seeded.ws.ctx, (tx) =>
    tx
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'list.email_send_failed'),
          eq(schema.auditLog.targetId, listId),
        ),
      ),
  );
}

/** Dokument bez jediného odkazu na potvrzení. Přesně ten, co nesmí odejít. */
function documentWithoutConfirmLink(): Document {
  return {
    schemaVersion: 1,
    meta: { name: 'Potvrzení', previewText: 'Vítejte', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [
      {
        id: 'b_000000000001',
        type: 'section',
        props: blockDefaults('section'),
        children: [
          {
            id: 'b_000000000002',
            type: 'text',
            props: {
              ...blockDefaults('text'),
              content: [{ t: 'p', children: [{ t: 's', v: 'Díky za přihlášení.' }] }],
            },
          },
          { id: 'b_000000000099', type: 'footer', props: blockDefaults('footer') },
        ],
      },
    ],
  } as unknown as Document;
}

describe('e-maily seznamu přes outbox', () => {
  it('vestavěné znění potvrzení vyrobí zprávu kind = transactional s odkazem v render_data', async () => {
    const seeded = await seedWorkspace();
    const listId = await createList(seeded);
    const contactId = await createContact(seeded, 'jan.novak@example.cz');

    const outcome = await sendSubscriptionEmail(seeded.ws.ctx, {
      kind: 'confirmation',
      contactId,
      listId,
      token: TOKEN,
      appUrl: APP_URL,
      assetBaseUrl: ASSETS,
    });
    expect(outcome).toBe('sent');

    const messages = await messagesOf(seeded, contactId);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.kind).toBe('transactional');
    expect(messages[0]!.status).toBe('pending');
    /*
     * TOHLE je celý smysl plánu: odkaz na potvrzení leží v datech zprávy,
     * takže ho sender dosadí do šablony bez jediné změny v Go.
     *
     * ADRESA SE ROZEBÍRÁ, ne porovnává s řetězcem. V cestě NENÍ holý token,
     * ale veřejný odkaz (token složený s projektem), protože přesně tak ho
     * potvrzovací stránka čte. Porovnání s `\${APP_URL}/s/c/\${TOKEN}` bylo
     * zeleně chybné: odkaz vypadal správně a stránka na něj odpověděla
     * „Tenhle odkaz neplatí".
     */
    const data = (messages[0]!.renderData as Record<string, unknown>)['data'] as {
      confirm_url: string;
    };
    expect(data.confirm_url.startsWith(`${APP_URL}/s/c/`)).toBe(true);
    const ref = data.confirm_url.slice(`${APP_URL}/s/c/`.length);
    expect(decodePublicRef(ref)).toEqual({
      workspaceId: seeded.ws.workspaceId,
      value: TOKEN,
    });

    const [campaign] = await withWorkspace(seeded.ws.ctx, (tx) =>
      tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, messages[0]!.campaignId!)),
    );
    expect(campaign!.kind).toBe('system');
    // Potvrzovací e-mail se neměří: měřený odkaz by spotřeboval skener ve schránce.
    expect(campaign!.trackOpens).toBe(false);
    expect(campaign!.trackClicks).toBe(false);
    expect(campaign!.compiledHtml).toContain('{{ data.confirm_url');
  }, 120_000);

  it('druhé odeslání přepíše tutéž skrytou kampaň a zvýší revizi', async () => {
    const seeded = await seedWorkspace();
    const listId = await createList(seeded);
    const first = await createContact(seeded, 'prvni@example.cz');
    const second = await createContact(seeded, 'druhy@example.cz');

    const input = { listId, token: TOKEN, appUrl: APP_URL, assetBaseUrl: ASSETS } as const;
    await sendSubscriptionEmail(seeded.ws.ctx, {
      ...input,
      kind: 'confirmation',
      contactId: first,
    });
    await sendSubscriptionEmail(seeded.ws.ctx, {
      ...input,
      kind: 'confirmation',
      contactId: second,
    });

    const campaigns = await withWorkspace(seeded.ws.ctx, (tx) =>
      tx.select().from(schema.campaigns).where(eq(schema.campaigns.kind, 'system')),
    );
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]!.revision).toBeGreaterThan(1);
  }, 120_000);

  it('bez tokenu potvrzovací e-mail neodejde a zůstane po něm řádek v auditu', async () => {
    const seeded = await seedWorkspace();
    const listId = await createList(seeded);
    const contactId = await createContact(seeded, 'bez.tokenu@example.cz');

    const outcome = await sendSubscriptionEmail(seeded.ws.ctx, {
      kind: 'confirmation',
      contactId,
      listId,
      appUrl: APP_URL,
      assetBaseUrl: ASSETS,
    });

    expect(outcome).toBe('confirm_link_missing');
    expect(await messagesOf(seeded, contactId)).toHaveLength(0);
    const audit = await failureAudit(seeded, listId);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({
      kind: 'confirmation',
      reason: 'confirm_link_missing',
    });
  }, 120_000);

  it('připojená šablona bez odkazu na potvrzení se neodešle', async () => {
    const seeded = await seedWorkspace();
    const template = await createTemplate(seeded.service, {
      name: 'Potvrzení bez odkazu',
      kind: 'transactional',
      document: documentWithoutConfirmLink(),
    });
    const listId = await createList(seeded, { confirmationTemplateId: template.id });
    const contactId = await createContact(seeded, 'bez.odkazu@example.cz');

    const outcome = await sendSubscriptionEmail(seeded.ws.ctx, {
      kind: 'confirmation',
      contactId,
      listId,
      token: TOKEN,
      appUrl: APP_URL,
      assetBaseUrl: ASSETS,
    });

    expect(outcome).toBe('confirm_link_missing');
    expect(await messagesOf(seeded, contactId)).toHaveLength(0);
  }, 120_000);

  it('rozloučení odejde i na adresu odhlášenou z odběru, stížnost ho zastaví', async () => {
    const seeded = await seedWorkspace();
    const listId = await createList(seeded);

    const leaving = await createContact(seeded, 'odhlaseny@example.cz');
    await addSuppression(seeded.ws.ctx, {
      email: 'odhlaseny@example.cz',
      reason: 'global_unsubscribe',
      source: 'link',
    });
    const goodbye = await sendSubscriptionEmail(seeded.ws.ctx, {
      kind: 'goodbye',
      contactId: leaving,
      listId,
      appUrl: APP_URL,
      assetBaseUrl: ASSETS,
    });
    // Kdyby stačila existence řádku v suppression, rozloučení by zablokovalo
    // právě to odhlášení, které potvrzuje, a neodešlo by nikdy.
    expect(goodbye).toBe('sent');

    const complained = await createContact(seeded, 'stiznost@example.cz');
    await addSuppression(seeded.ws.ctx, {
      email: 'stiznost@example.cz',
      reason: 'complaint',
      source: 'webhook',
    });
    const blocked = await sendSubscriptionEmail(seeded.ws.ctx, {
      kind: 'goodbye',
      contactId: complained,
      listId,
      appUrl: APP_URL,
      assetBaseUrl: ASSETS,
    });
    expect(blocked).toBe('suppressed');
    expect(await messagesOf(seeded, complained)).toHaveLength(0);
  }, 120_000);

  it('projekt bez odesílání vrátí důvod, ne výjimku', async () => {
    const seeded = await seedWorkspace({ sendingConfigured: false });
    const listId = await createList(seeded);
    const contactId = await createContact(seeded, 'bez.odesilani@example.cz');

    const outcome = await sendSubscriptionEmail(seeded.ws.ctx, {
      kind: 'welcome',
      contactId,
      listId,
      appUrl: APP_URL,
      assetBaseUrl: ASSETS,
    });
    expect(outcome).toBe('sending_not_configured');
  }, 120_000);
});

describe('vestavěné znění', () => {
  it('potvrzení nese odkaz na potvrzení, uvítání a rozloučení ne', () => {
    const confirmation = JSON.stringify(defaultSubscriptionEmail('confirmation', 'cs'));
    expect(confirmation).toContain('data.confirm_url');
    expect(JSON.stringify(defaultSubscriptionEmail('welcome', 'cs'))).not.toContain(
      'data.confirm_url',
    );
    expect(JSON.stringify(defaultSubscriptionEmail('goodbye', 'en'))).not.toContain(
      'data.confirm_url',
    );
    expect(CONFIRM_URL_EXPRESSION).toBe('{{ data.confirm_url }}');
  });

  it('patička výchozího znění nenabízí odhlášení, sender ho transakční zprávě nedodá', () => {
    const document = defaultSubscriptionEmail('welcome', 'cs');
    const footer = document.blocks[0]!.children.find((child) => child.type === 'footer');
    expect(footer).toBeDefined();
    expect((footer as { props: { showUnsubscribe: boolean } }).props.showUnsubscribe).toBe(false);
  });
});
