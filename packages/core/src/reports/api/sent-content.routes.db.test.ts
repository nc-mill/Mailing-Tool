import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestTx,
  startTestDatabase,
  testContext,
  type TestDatabase,
} from '../test-support/db';
import { seedCampaign, seedContact, seedMessage, seedWorkspace } from '../test-support/fixtures';
import { createTestApp } from './test-app';
import { sentContentRoutes } from './sent-content.routes';

/**
 * Sekce reportu „Co se doopravdy rozeslalo" ukazovala prázdný rám a syrové
 * Liquid výrazy. Tenhle soubor drží obojí, co se tím opravilo: tělo se vrací
 * VYRENDEROVANÉ daty skutečné zprávy a e-mail bez obsahu se pozná jako takový,
 * ne jako chyba načtení.
 */
const FOOTER_HTML =
  '<html><body><p>{{ workspace.sender_address }}</p>' +
  '<a href="{{ unsubscribe_url }}">Odhlásit se z odběru</a>' +
  '<p>Dobrý den, {{ contact.first_name }}.</p></body></html>';

const FOOTER_TEXT = '{{ workspace.sender_address }}\r\nOdhlásit se: {{ unsubscribe_url }}';

/** Dokument, ve kterém není nic než patička. Přesně ten tvar odešel v provozu. */
const FOOTER_ONLY_DESIGN = {
  blocks: [{ id: 'b1', type: 'section', children: [{ id: 'b2', type: 'footer', props: {} }] }],
};

const WITH_CONTENT_DESIGN = {
  blocks: [
    {
      id: 'b1',
      type: 'section',
      children: [
        { id: 'b2', type: 'text', props: {} },
        { id: 'b3', type: 'footer', props: {} },
      ],
    },
  ],
};

describe('GET /campaigns/{id}/sent-content', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  function appFor(workspaceId: string) {
    return createTestApp(testContext(workspaceId), createTestTx(db), [sentContentRoutes as never]);
  }

  it('vrátí tělo vyrenderované daty odeslané zprávy, ne zdrojové výrazy', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, {
      compiledHtml: FOOTER_HTML,
      compiledText: FOOTER_TEXT,
      design: WITH_CONTENT_DESIGN,
    });
    const contactId = await seedContact(db, ws.workspaceId, { email: 'jana@example.cz' });
    await seedMessage(db, {
      workspaceId: ws.workspaceId,
      campaignId: campaign.campaignId,
      contactId,
      email: 'jana@example.cz',
      createdAt: campaign.audienceBuiltAt,
      renderData: { contact: { first_name: 'Jana' } },
    });

    const response = await appFor(ws.workspaceId).request(
      `/campaigns/${campaign.campaignId}/sent-content`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    const html = body.html as string;
    expect(html).toContain('Dobrý den, Jana.');
    // Ani jeden syrový výraz: uživatel se dívá na to, co přišlo do schránky.
    expect(html).not.toContain('{{');
    // Systémové adresy nikam nevedou, podepsaný token se kvůli náhledu nevyrábí.
    expect(html).toContain('#preview-disabled');
    expect(body.personalized_for).toBe('jana@example.cz');
    expect(body.content_state).toBe('ok');
  });

  it('textovou verzi renderuje textovým enginem, tedy bez escapování', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, {
      compiledHtml: '<html><body>{{ contact.company }}</body></html>',
      compiledText: '{{ contact.company }}',
      design: WITH_CONTENT_DESIGN,
    });
    const contactId = await seedContact(db, ws.workspaceId);
    await seedMessage(db, {
      workspaceId: ws.workspaceId,
      campaignId: campaign.campaignId,
      contactId,
      email: 'k@example.cz',
      createdAt: campaign.audienceBuiltAt,
      renderData: { contact: { company: 'Novák & synové' } },
    });

    const body = (await (
      await appFor(ws.workspaceId).request(`/campaigns/${campaign.campaignId}/sent-content`)
    ).json()) as Record<string, unknown>;

    expect(body.text).toBe('Novák & synové');
    // V HTML se escapuje, v textu ne. Kdyby to bylo naopak, prostý text by
    // uživateli ukázal `&amp;`.
    expect(body.html as string).toContain('Novák &amp; synové');
  });

  it('e-mail, ve kterém nebylo nic než patička, hlásí jako prázdný obsah', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, {
      compiledHtml: FOOTER_HTML,
      compiledText: FOOTER_TEXT,
      design: FOOTER_ONLY_DESIGN,
    });

    const body = (await (
      await appFor(ws.workspaceId).request(`/campaigns/${campaign.campaignId}/sent-content`)
    ).json()) as Record<string, unknown>;

    expect(body.content_state).toBe('empty');
    // Tělo se přesto vrací: doklad o odeslaném e-mailu se neschovává.
    expect(body.html).not.toBeNull();
  });

  it('nezkompilovaná kampaň vrací 200 s html null, ne 404', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'draft' });

    const response = await appFor(ws.workspaceId).request(
      `/campaigns/${campaign.campaignId}/sent-content`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.html).toBeNull();
    expect(body.text).toBeNull();
    expect(body.content_state).toBe('missing');
    expect(body.personalized_for).toBeNull();
  });

  it('kampaň z cizího projektu nevydá', async () => {
    const owner = await seedWorkspace(db);
    const stranger = await seedWorkspace(db);
    const campaign = await seedCampaign(db, owner.workspaceId, {
      compiledHtml: FOOTER_HTML,
      design: WITH_CONTENT_DESIGN,
    });

    const response = await appFor(stranger.workspaceId).request(
      `/campaigns/${campaign.campaignId}/sent-content`,
    );
    expect(response.status).toBe(404);
  });

  it('bez odeslané zprávy renderuje s prázdnými daty a přizná, že nemá podle koho', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, {
      compiledHtml: FOOTER_HTML,
      compiledText: FOOTER_TEXT,
      design: WITH_CONTENT_DESIGN,
    });

    const body = (await (
      await appFor(ws.workspaceId).request(`/campaigns/${campaign.campaignId}/sent-content`)
    ).json()) as Record<string, unknown>;

    expect(body.personalized_for).toBeNull();
    // Neznámá proměnná je podle kontraktu prázdný řetězec, ne doslovný výraz.
    expect(body.html as string).not.toContain('{{');
  });
});
