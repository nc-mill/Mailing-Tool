import { beforeEach, describe, expect, it, vi } from 'vitest';
// Typ modulu se bere `import type`, ne `typeof import(...)` uvnitř anotace:
// vložené `import()` v typu zakazuje pravidlo `consistent-type-imports`.
// Skutečný modul se pořád načítá až dynamicky v testu, aby platily `vi.mock`.
import type * as ActionsModule from './actions';
import { IDLE } from '@/lib/feedback/action-result';

/**
 * Regrese na nález I92, tentokrát nad kampaněmi.
 *
 * Serverová akce, která zavolá API BEZ `workspaceId`, pošle požadavek bez
 * hlavičky `X-Workspace-Id`. Ten pak běží mimo kontext projektu, RLS nevrátí
 * ani řádek a uživatel dostane 404 na kampaň, kterou má otevřenou na obrazovce.
 * Typ ani lint to nechytí: `workspaceId` je v `MutateOptions` nepovinný, protože
 * ho nemají akce přihlášení a profilu.
 *
 * Test proto kontroluje CHOVÁNÍ a hlídá VŠECHNY akce souboru naráz. Když někdo
 * přidá akci sedmou a zapomene na projekt, spadne to tady.
 */

const mutate = vi.fn().mockResolvedValue({ ok: true, data: { id: 'camp-1' } });

vi.mock('@/lib/api-client/mutate', () => ({ apiMutate: (...args: unknown[]) => mutate(...args) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Katalog se v akci čte jen kvůli textům chyb validace. Náhrada vrací klíč,
// takže tvrzení testu nezávisí na znění překladu.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

const WORKSPACE = 'ws-1';
const CAMPAIGN = 'camp-1';

/** Formulář nastavení vyplněný tak, aby prošel validací a došel až k API. */
function settingsForm(): FormData {
  const form = new FormData();
  form.set('workspace_id', WORKSPACE);
  form.set('campaign_id', CAMPAIGN);
  form.set('name', 'Letní výprodej');
  form.set('subject', 'Letní výprodej začíná');
  form.append('include_list', 'list-1');
  return form;
}

/** Každá exportovaná akce se zavolá právě jednou, s minimem povinných hodnot. */
const CALLS: Record<string, (module: typeof ActionsModule) => Promise<unknown>> = {
  sendCampaignAction: (m) =>
    m.sendCampaignAction({
      workspaceId: WORKSPACE,
      campaignId: CAMPAIGN,
      confirmRecipientCount: 3,
    }),
  createCampaignAction: (m) => m.createCampaignAction({ workspaceId: WORKSPACE, name: 'Kampaň' }),
  pauseCampaignAction: (m) =>
    m.pauseCampaignAction({ workspaceId: WORKSPACE, campaignId: CAMPAIGN }),
  resumeCampaignAction: (m) =>
    m.resumeCampaignAction({ workspaceId: WORKSPACE, campaignId: CAMPAIGN }),
  cancelCampaignAction: (m) =>
    m.cancelCampaignAction({ workspaceId: WORKSPACE, campaignId: CAMPAIGN }),
  undoCampaignAction: (m) => m.undoCampaignAction({ workspaceId: WORKSPACE, campaignId: CAMPAIGN }),
  unscheduleCampaignAction: (m) =>
    m.unscheduleCampaignAction({ workspaceId: WORKSPACE, campaignId: CAMPAIGN }),
  updateCampaignSettingsAction: (m) => m.updateCampaignSettingsAction(IDLE, settingsForm()),
};

beforeEach(() => {
  mutate.mockClear();
});

describe('serverové akce kampaní posílají projekt', () => {
  it('výčet v testu pokrývá všechny exportované akce souboru', async () => {
    const module = await import('./actions');
    const exported = Object.entries(module)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();
    expect(exported).toEqual(Object.keys(CALLS).sort());
  });

  for (const [name, call] of Object.entries(CALLS)) {
    it(`${name} předá workspaceId klientovi API`, async () => {
      const module = await import('./actions');
      await call(module);

      const calls = mutate.mock.calls;
      expect(calls, `${name} nezavolala žádný klient API`).not.toHaveLength(0);
      for (const [path, options] of calls) {
        expect(
          (options as { workspaceId?: string } | undefined)?.workspaceId,
          `${name} volá ${String(path)} bez workspaceId, takže požadavku chybí X-Workspace-Id`,
        ).toBe(WORKSPACE);
      }
    });
  }
});

describe('unscheduleCampaignAction', () => {
  it('míří na cestu zrušení plánu, ne na obecné ovládání', async () => {
    const { unscheduleCampaignAction } = await import('./actions');
    await unscheduleCampaignAction({ workspaceId: WORKSPACE, campaignId: CAMPAIGN });

    const [path, options] = mutate.mock.calls[0] as [string, { method: string; body: unknown }];
    expect(path).toBe(`/api/v1/campaigns/${CAMPAIGN}/unschedule`);
    expect(options.method).toBe('POST');
    // Prázdné tělo je povinné: kostra API kontroluje `Content-Type` u každého POST
    // a bez těla by hlavička chyběla a cesta by vrátila 415.
    expect(options.body).toEqual({});
  });
});

describe('updateCampaignSettingsAction', () => {
  it('pošle na PATCH kampaně to, co obrazovka odeslání vyžaduje', async () => {
    const { updateCampaignSettingsAction } = await import('./actions');
    const form = settingsForm();
    form.set('preheader', 'Slevy až 50 %');
    form.set('from_name', 'Kolo Shop');
    form.set('from_email', 'info@kolo-shop.cz');
    form.set('reply_to', 'odpovedi@kolo-shop.cz');
    form.set('template_id', 'tpl-1');
    form.set('provider_id', 'prov-1');
    form.set('sender_domain_id', 'dom-1');
    form.set('unsubscribe_list_id', 'list-1');
    form.append('include_segment', 'seg-1');
    form.append('exclude_list', 'list-9');
    form.set('track_opens', 'on');

    const state = await updateCampaignSettingsAction(IDLE, form);

    expect(state.status).toBe('success');
    expect(mutate).toHaveBeenCalledTimes(1);
    const [path, options] = mutate.mock.calls[0] as [string, { method: string; body: unknown }];
    expect(path).toBe(`/api/v1/campaigns/${CAMPAIGN}`);
    expect(options.method).toBe('PATCH');
    expect(options.body).toEqual({
      name: 'Letní výprodej',
      subject: 'Letní výprodej začíná',
      preheader: 'Slevy až 50 %',
      from_name: 'Kolo Shop',
      from_email: 'info@kolo-shop.cz',
      reply_to: 'odpovedi@kolo-shop.cz',
      template_id: 'tpl-1',
      provider_id: 'prov-1',
      sender_domain_id: 'dom-1',
      unsubscribe_list_id: 'list-1',
      track_opens: true,
      // Nezaškrtnuté zaškrtávátko se ve `FormData` neobjeví vůbec, takže se
      // musí uložit jako `false`; jinak by se prokliky nedaly vypnout.
      track_clicks: false,
      audience: {
        include: { lists: ['list-1'], segments: ['seg-1'] },
        exclude: { lists: ['list-9'], segments: [] },
      },
    });
  });

  it('prázdnou adresu odesílatele neposílá, protože schéma API ji nepřipouští', async () => {
    const { updateCampaignSettingsAction } = await import('./actions');
    await updateCampaignSettingsAction(IDLE, settingsForm());

    const [, options] = mutate.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(Object.keys(options.body)).not.toContain('from_email');
  });

  it('zástupnou hodnotu „nevybráno" překládá na null, ne na text', async () => {
    const { updateCampaignSettingsAction } = await import('./actions');
    const { NO_SELECTION } = await import('./no-selection');
    const form = settingsForm();
    form.set('template_id', NO_SELECTION);
    form.set('provider_id', NO_SELECTION);

    await updateCampaignSettingsAction(IDLE, form);

    const [, options] = mutate.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body['template_id']).toBeNull();
    expect(options.body['provider_id']).toBeNull();
  });

  it('prázdný předmět zastaví u pole, ne až na API', async () => {
    const { updateCampaignSettingsAction } = await import('./actions');
    const form = settingsForm();
    form.set('subject', '   ');

    const state = await updateCampaignSettingsAction(IDLE, form);

    expect(state.status).toBe('error');
    if (state.status !== 'error') throw new Error('nedosažitelné');
    expect(state.fieldErrors['subject']).toEqual(['subjectRequired']);
    expect(mutate, 'neplatný formulář se na API posílat nesmí').not.toHaveBeenCalled();
  });

  it('publikum bez jediné položky zastaví u skupiny zaškrtávátek', async () => {
    const { updateCampaignSettingsAction } = await import('./actions');
    const form = settingsForm();
    form.delete('include_list');

    const state = await updateCampaignSettingsAction(IDLE, form);

    expect(state.status).toBe('error');
    if (state.status !== 'error') throw new Error('nedosažitelné');
    expect(state.fieldErrors['audience']).toEqual(['audienceRequired']);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('neplatnou adresu pro odpovědi hlásí u toho pole', async () => {
    const { updateCampaignSettingsAction } = await import('./actions');
    const form = settingsForm();
    form.set('reply_to', 'tohle-neni-adresa');

    const state = await updateCampaignSettingsAction(IDLE, form);

    expect(state.status).toBe('error');
    if (state.status !== 'error') throw new Error('nedosažitelné');
    expect(state.fieldErrors['reply_to']).toEqual(['emailInvalid']);
    expect(mutate).not.toHaveBeenCalled();
  });
});
