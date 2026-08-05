import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@mlain/db/schema';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import type { Document } from '@mlain/emails/document/types';
import type { FieldCatalog } from '../fields/catalog';
import { seedWorkspaceForCoreTests } from '../../identity/test-helpers';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import { preSendCheck } from '../../templates/precheck';
import { createTemplate, saveDesign, type ServiceContext } from '../../templates/service';
import { isListEmailTemplate } from './list-email-guards';
import { closePools, withWorkspace } from '../../tx';
import { defaultSubscriptionEmail } from './default-emails';

/**
 * ZÁVORY SEZNAMU PŘI UKLÁDÁNÍ ŠABLONY.
 *
 * Testuje se `saveDesign`, tedy cesta, kterou jde každé uložení z editoru.
 * Připojení šablony k seznamu má vlastní závoru v API a odeslání třetí; tahle
 * chytá okamžik mezi nimi, kdy autor obsah upraví. Bez ní se autor o rozbitém
 * potvrzovacím e-mailu dozví až tím, že se lidem nedaří dokončit přihlášení,
 * a o odhlašovacím odkazu v uvítacím e-mailu vůbec, protože ten odejde
 * s prázdným `href` a nic nespadne.
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

async function seed() {
  const ws = await seedWorkspaceForCoreTests();
  const service: ServiceContext = { ctx: ws.ctx, fields: catalog, userId: ws.userId };
  return { ws, service };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

async function attachToList(
  seeded: Seeded,
  column: 'confirmationTemplateId' | 'welcomeTemplateId' | 'goodbyeTemplateId',
  templateId: string,
): Promise<void> {
  await withWorkspace(seeded.ws.ctx, async (tx) => {
    await tx.insert(schema.lists).values({
      workspaceId: seeded.ws.workspaceId,
      name: `Seznam ${Math.random().toString(36).slice(2)}`,
      optIn: 'double',
      [column]: templateId,
    });
  });
}

/** Dokument s patičkou, kde se odhlášení dá zapnout i vypnout. */
function documentWithFooter(options: {
  showUnsubscribe: boolean;
  confirmButton: boolean;
}): Document {
  const children: unknown[] = [
    {
      id: 'b_000000000002',
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [{ t: 'p', children: [{ t: 's', v: 'Vítejte v odběru.' }] }],
      },
    },
  ];
  if (options.confirmButton) {
    children.push({
      id: 'b_000000000003',
      type: 'button',
      props: {
        ...blockDefaults('button'),
        label: [{ t: 'p', children: [{ t: 's', v: 'Potvrdit' }] }],
        href: '{{ data.confirm_url }}',
      },
    });
  }
  children.push({
    id: 'b_000000000099',
    type: 'footer',
    props: {
      ...blockDefaults('footer'),
      showUnsubscribe: options.showUnsubscribe,
      showPreferences: false,
      showWebview: false,
    },
  });

  return {
    schemaVersion: 1,
    meta: { name: 'E-mail seznamu', previewText: '', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [{ id: 'b_000000000001', type: 'section', props: blockDefaults('section'), children }],
  } as unknown as Document;
}

describe('uložení šablony připojené k seznamu', () => {
  it('potvrzovací e-mail nejde uložit bez odkazu na potvrzení', async () => {
    const seeded = await seed();
    const template = await createTemplate(seeded.service, {
      name: 'Potvrzení',
      kind: 'transactional',
      document: defaultSubscriptionEmail('confirmation', 'cs'),
    });
    await attachToList(seeded, 'confirmationTemplateId', template.id);

    await expect(
      saveDesign(
        seeded.service,
        template.id,
        documentWithFooter({ showUnsubscribe: false, confirmButton: false }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'confirmation_template_missing_confirm_link' }],
    });
  }, 120_000);

  it('potvrzovací e-mail s odkazem se uloží', async () => {
    const seeded = await seed();
    const template = await createTemplate(seeded.service, {
      name: 'Potvrzení 2',
      kind: 'transactional',
      document: defaultSubscriptionEmail('confirmation', 'cs'),
    });
    await attachToList(seeded, 'confirmationTemplateId', template.id);

    const result = await saveDesign(
      seeded.service,
      template.id,
      documentWithFooter({ showUnsubscribe: false, confirmButton: true }),
    );
    expect(result.changed).toBe(true);
  }, 120_000);

  it('uvítací e-mail nejde uložit s odhlašovacím odkazem', async () => {
    const seeded = await seed();
    const template = await createTemplate(seeded.service, {
      name: 'Uvítání',
      kind: 'transactional',
      document: defaultSubscriptionEmail('welcome', 'cs'),
    });
    await attachToList(seeded, 'welcomeTemplateId', template.id);

    await expect(
      saveDesign(
        seeded.service,
        template.id,
        documentWithFooter({ showUnsubscribe: true, confirmButton: false }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'subscription_email_has_unsubscribe_link' }],
    });
  }, 120_000);

  it('rozloučení nejde uložit s odhlašovacím odkazem', async () => {
    const seeded = await seed();
    const template = await createTemplate(seeded.service, {
      name: 'Rozloučení',
      kind: 'transactional',
      document: defaultSubscriptionEmail('goodbye', 'cs'),
    });
    await attachToList(seeded, 'goodbyeTemplateId', template.id);

    await expect(
      saveDesign(
        seeded.service,
        template.id,
        documentWithFooter({ showUnsubscribe: true, confirmButton: false }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'subscription_email_has_unsubscribe_link' }],
    });
  }, 120_000);

  it('NEPŘIPOJENÁ šablona projde s odhlašovacím odkazem i bez potvrzení', async () => {
    // Tohle je celý smysl toho, že se pravidlo ptá na VAZBU, ne na šablonu:
    // kampaňová šablona odhlašovací odkaz mít MUSÍ (pravidlo S4) a nesmí ji
    // shodit závora, která patří seznamu.
    const seeded = await seed();
    const template = await createTemplate(seeded.service, {
      name: 'Obyčejná kampaň',
      kind: 'campaign',
      document: documentWithFooter({ showUnsubscribe: true, confirmButton: false }),
    });

    const result = await saveDesign(
      seeded.service,
      template.id,
      documentWithFooter({ showUnsubscribe: true, confirmButton: true }),
    );
    expect(result.changed).toBe(true);
  }, 120_000);
});

/**
 * DVĚ PRAVIDLA SI NESMÍ ODPOROVAT.
 *
 * Předodesílací kontrola vyžaduje odhlašovací odkaz, závora na uložení ho
 * u e-mailu seznamu zakazuje. Kdyby platila obě naráz, autor by se z toho
 * nedostal: bez odkazu křičí kontrola, s odkazem závora. Naměřeno na
 * potvrzovacím e-mailu v editoru 5. 8. 2026.
 */
describe('předodesílací kontrola u e-mailu seznamu', () => {
  const bezOdhlaseni = {
    compileMeta: {
      htmlBytes: 1000,
      links: [],
      assetIds: [],
      warnings: [],
      hasUnsubscribeLink: false,
    },
    validationIssues: [],
    subject: 'Potvrďte přihlášení',
    preheader: 'Zbývá jediné kliknutí',
    appUrl: 'https://mlain.example.com',
    emptyFieldRatios: [],
  };

  it('u běžné šablony odhlašovací odkaz VYŽADUJE dál', () => {
    const check = preSendCheck(bezOdhlaseni);
    expect(check.findings.map((f) => f.code)).toContain('precheck_missing_unsubscribe');
    expect(check.blocking).toBe(true);
  });

  it('u e-mailu seznamu ho nevyžaduje', () => {
    const check = preSendCheck({ ...bezOdhlaseni, unsubscribeRequired: false });
    expect(check.findings.map((f) => f.code)).not.toContain('precheck_missing_unsubscribe');
  });

  it('připojenou šablonu pozná podle vazby na seznam, nepřipojenou ne', async () => {
    const seeded = await seed();
    const pripojena = await createTemplate(seeded.service, {
      name: 'Potvrzení vazba',
      kind: 'transactional',
      document: defaultSubscriptionEmail('confirmation', 'cs'),
    });
    const volna = await createTemplate(seeded.service, {
      name: 'Obyčejná kampaň vazba',
      kind: 'campaign',
      document: documentWithFooter({ showUnsubscribe: true, confirmButton: false }),
    });
    await attachToList(seeded, 'confirmationTemplateId', pripojena.id);

    await withWorkspace(seeded.ws.ctx, async (tx) => {
      expect(await isListEmailTemplate(tx, seeded.ws.ctx, pripojena.id)).toBe(true);
      // Kampaňová šablona bez vazby na seznam musí odhlašovací odkaz mít dál.
      expect(await isListEmailTemplate(tx, seeded.ws.ctx, volna.id)).toBe(false);
    });
  }, 120_000);
});
