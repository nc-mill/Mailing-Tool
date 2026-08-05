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
/**
 * Čtení musí projekt předávat úplně stejně jako zápis. Akce obsahu si dotahují
 * dokument šablony přes `apiFetch`, takže kdyby ho vynechaly, vrátilo by se 404
 * na šablonu, která existuje, a obrazovka by jen řekla „nepodařilo se".
 */
const fetchJson = vi.fn().mockResolvedValue({ ok: true, data: { design: { blocks: [] } } });

vi.mock('@/lib/api-client/mutate', () => ({ apiMutate: (...args: unknown[]) => mutate(...args) }));
vi.mock('@/lib/api-client/fetch', () => ({ apiFetch: (...args: unknown[]) => fetchJson(...args) }));
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
  pauseCampaignAction: (m) =>
    m.pauseCampaignAction({ workspaceId: WORKSPACE, campaignId: CAMPAIGN }),
  resumeCampaignAction: (m) =>
    m.resumeCampaignAction({ workspaceId: WORKSPACE, campaignId: CAMPAIGN }),
  cancelCampaignAction: (m) =>
    m.cancelCampaignAction({ workspaceId: WORKSPACE, campaignId: CAMPAIGN }),
  undoCampaignAction: (m) => m.undoCampaignAction({ workspaceId: WORKSPACE, campaignId: CAMPAIGN }),
  sendCampaignNowAction: (m) =>
    m.sendCampaignNowAction({ workspaceId: WORKSPACE, campaignId: CAMPAIGN }),
  unscheduleCampaignAction: (m) =>
    m.unscheduleCampaignAction({ workspaceId: WORKSPACE, campaignId: CAMPAIGN }),
  updateCampaignSettingsAction: (m) => m.updateCampaignSettingsAction(IDLE, settingsForm()),
  useLibraryTemplateAction: (m) =>
    m.useLibraryTemplateAction({
      workspaceId: WORKSPACE,
      campaignId: CAMPAIGN,
      workingCopyId: 'work-1',
      templateId: 'tpl-1',
    }),
  saveCampaignContentAsTemplateAction: (m) =>
    m.saveCampaignContentAsTemplateAction({
      workspaceId: WORKSPACE,
      workingCopyId: 'work-1',
      name: 'Newsletter',
    }),
  createCampaignContentAction: (m) =>
    m.createCampaignContentAction({
      workspaceId: WORKSPACE,
      campaignId: CAMPAIGN,
      campaignName: 'Kampaň',
      locale: 'cs',
    }),
  deleteCampaignAction: (m) =>
    m.deleteCampaignAction({ workspaceId: WORKSPACE, campaignId: CAMPAIGN }),
  startCampaignFromBlankAction: (m) =>
    m.startCampaignFromBlankAction({ workspaceId: WORKSPACE, name: 'Kampaň', locale: 'cs' }),
  startCampaignFromTemplateAction: (m) =>
    m.startCampaignFromTemplateAction({
      workspaceId: WORKSPACE,
      name: 'Kampaň',
      templateId: 'tpl-1',
    }),
};

beforeEach(() => {
  mutate.mockClear();
  fetchJson.mockClear();
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

      const calls = [...mutate.mock.calls, ...fetchJson.mock.calls];
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

describe('useLibraryTemplateAction', () => {
  /**
   * Knihovní šablona se do kampaně dostane PŘES PRACOVNÍ KOPII, ne přímo.
   *
   * Kdyby `apply-template` dostalo rovnou knihovní šablonu, přepsalo by
   * `campaigns.template_id` na ni, editor obsahu kampaně by pak otevíral ji
   * a psaní jednoho newsletteru by přepsalo šablonu uloženou pro příště.
   * Test proto hlídá POŘADÍ a CÍLE volání, ne jen to, že něco proběhlo.
   */
  it('zapíše dokument do pracovní kopie a teprve tu použije na kampaň', async () => {
    const { useLibraryTemplateAction } = await import('./actions');
    await useLibraryTemplateAction({
      workspaceId: WORKSPACE,
      campaignId: CAMPAIGN,
      workingCopyId: 'work-1',
      templateId: 'tpl-1',
    });

    expect(fetchJson.mock.calls[0]?.[0]).toBe('/api/v1/templates/tpl-1');

    const [writePath, writeOptions] = mutate.mock.calls[0] as [
      string,
      { method: string; body: Record<string, unknown> },
    ];
    expect(writePath).toBe('/api/v1/templates/work-1');
    expect(writeOptions.method).toBe('PATCH');
    expect(writeOptions.body['design']).toEqual({ blocks: [] });

    const [applyPath, applyOptions] = mutate.mock.calls[1] as [
      string,
      { method: string; body: unknown },
    ];
    expect(applyPath).toBe(`/api/v1/campaigns/${CAMPAIGN}/apply-template`);
    expect(applyOptions.method).toBe('POST');
    // Pracovní kopie, ne `tpl-1`: knihovní šablona se tímhle krokem nesmí stát
    // šablonou kampaně.
    expect(applyOptions.body).toEqual({ template_id: 'work-1' });
  });
});

describe('saveCampaignContentAsTemplateAction', () => {
  /**
   * „Uložit jako šablonu" zakládá NOVÝ řádek knihovny, nikdy neupravuje
   * pracovní kopii. Jen tak platí, že se kampaň a šablona od sebe osamostatní.
   */
  it('založí novou šablonu s dokumentem pracovní kopie', async () => {
    const { saveCampaignContentAsTemplateAction } = await import('./actions');
    const result = await saveCampaignContentAsTemplateAction({
      workspaceId: WORKSPACE,
      workingCopyId: 'work-1',
      name: 'Měsíční newsletter',
    });

    expect(fetchJson.mock.calls[0]?.[0]).toBe('/api/v1/templates/work-1');
    const [path, options] = mutate.mock.calls[0] as [
      string,
      { method: string; body: Record<string, unknown> },
    ];
    expect(path).toBe('/api/v1/templates');
    expect(options.method).toBe('POST');
    expect(options.body).toEqual({ name: 'Měsíční newsletter', document: { blocks: [] } });
    // Bez `kind` je výchozí `campaign`, tedy řádek, který v knihovně vidět JE.
    expect(options.body['kind']).toBeUndefined();
    expect(result).toEqual({ status: 'success', templateId: 'camp-1' });
  });

  it('prázdný název odmítne dřív, než se cokoli zapíše', async () => {
    const { saveCampaignContentAsTemplateAction } = await import('./actions');
    const result = await saveCampaignContentAsTemplateAction({
      workspaceId: WORKSPACE,
      workingCopyId: 'work-1',
      name: '   ',
    });
    expect(result).toEqual({ status: 'error', code: 'validation_failed' });
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('zakládání obsahu kampaně', () => {
  /**
   * Pracovní obsah kampaně je `kind: 'system'`, a je to jediná věc, která ho
   * drží mimo knihovnu šablon. Kdyby se ta hodnota ztratila, uživateli začnou
   * v knihovně znovu přibývat rozepsané kampaně, což je přesně ta vada, kvůli
   * které tenhle tvar vznikl.
   */
  it('prázdný e-mail založí pracovní obsah s kind system', async () => {
    const { startCampaignFromBlankAction } = await import('./actions');
    await startCampaignFromBlankAction({ workspaceId: WORKSPACE, name: 'Kampaň', locale: 'cs' });

    const create = mutate.mock.calls.find(([path]) => path === '/api/v1/templates') as
      [string, { body: Record<string, unknown> }] | undefined;
    expect(create, 'pracovní obsah se vůbec nezaložil').toBeDefined();
    expect(create?.[1].body['kind']).toBe('system');
    // Jméno řádku nese identifikátor kampaně, jinak by druhá kampaň se stejným
    // jménem spadla na unikátní index `uq_templates__workspace_name`.
    expect(String(create?.[1].body['name'])).toContain('camp-1');
  });

  it('start ze šablony si udělá vlastní kopii, kampaň se na knihovní šablonu nenaváže', async () => {
    const { startCampaignFromTemplateAction } = await import('./actions');
    await startCampaignFromTemplateAction({
      workspaceId: WORKSPACE,
      name: 'Kampaň',
      templateId: 'tpl-1',
    });

    expect(fetchJson.mock.calls[0]?.[0]).toBe('/api/v1/templates/tpl-1');
    const create = mutate.mock.calls.find(([path]) => path === '/api/v1/templates') as
      [string, { body: Record<string, unknown> }] | undefined;
    expect(create?.[1].body['kind']).toBe('system');
    expect(create?.[1].body['document']).toEqual({ blocks: [] });

    const link = mutate.mock.calls.find(([path]) => path === `/api/v1/campaigns/camp-1`) as
      [string, { body: Record<string, unknown> }] | undefined;
    // Propojuje se s VLASTNÍ kopií (`camp-1` je id, které vrací náhrada API),
    // ne s `tpl-1`.
    expect(link?.[1].body['template_id']).not.toBe('tpl-1');
  });
});

describe('deleteCampaignAction', () => {
  it('míří na DELETE kampaně, ne na ovládací cestu', async () => {
    const { deleteCampaignAction } = await import('./actions');
    await deleteCampaignAction({ workspaceId: WORKSPACE, campaignId: CAMPAIGN });

    const [path, options] = mutate.mock.calls[0] as [string, { method: string }];
    expect(path).toBe(`/api/v1/campaigns/${CAMPAIGN}`);
    expect(options.method).toBe('DELETE');
  });

  /**
   * Stav kampaně chodí v `params` odpovědi. Bez něj by dialog uměl leda obecné
   * „nejde to", přestože u naplánované kampaně stačí zrušit plán.
   */
  it('odmítnutí vytáhne stav kampaně z params, ne z detailu', async () => {
    const { deleteCampaignAction } = await import('./actions');
    mutate.mockResolvedValueOnce({
      ok: false,
      problem: {
        code: 'conflict',
        detail: 'Conflict',
        params: { reason: 'campaign_not_draft', status: 'sent' },
      },
    });

    const result = await deleteCampaignAction({ workspaceId: WORKSPACE, campaignId: CAMPAIGN });

    expect(result).toEqual({
      status: 'error',
      code: 'conflict',
      campaignStatus: 'sent',
      detail: 'Conflict',
    });
  });
});

describe('zakládání kampaně obsahem', () => {
  it('prázdný e-mail založí kampaň, její pracovní obsah a obojí propojí', async () => {
    const { startCampaignFromBlankAction } = await import('./actions');
    mutate
      .mockResolvedValueOnce({ ok: true, data: { id: 'camp-9' } })
      .mockResolvedValueOnce({ ok: true, data: { id: 'tpl-9' } })
      .mockResolvedValueOnce({ ok: true, data: { id: 'camp-9' } });

    const result = await startCampaignFromBlankAction({
      workspaceId: WORKSPACE,
      name: 'Vítací e-mail',
      locale: 'cs',
    });

    expect(result).toEqual({ status: 'success', campaignId: 'camp-9', templateId: 'tpl-9' });
    const paths = mutate.mock.calls.map(([path]) => String(path));
    expect(paths).toEqual(['/api/v1/campaigns', '/api/v1/templates', '/api/v1/campaigns/camp-9']);

    // Dokument musí projít schématem hned napoprvé: `meta.name` nesmí být
    // prázdný a patička s odhlašovacím odkazem je podmínka platnosti.
    const [, templateOptions] = mutate.mock.calls[1] as [
      string,
      { body: { name: string; kind: string; document: { meta: { name: string } } } },
    ];
    // `system` je to jediné, co pracovní obsah drží mimo knihovnu šablon.
    expect(templateOptions.body.kind).toBe('system');
    expect(templateOptions.body.document.meta.name).toBe('Vítací e-mail');
    // Jméno ŘÁDKU nese identifikátor kampaně kvůli unikátnímu indexu nad
    // `lower(name)`. Bez něj neprojde druhá kampaň se stejným jménem.
    expect(templateOptions.body.name).toContain('camp-9');

    // Propojení jde PATCHem, ne přes apply-template: ten kompiluje a čerstvá
    // kampaň nemá předmět, takže by první krok skončil chybou.
    const [, patchOptions] = mutate.mock.calls[2] as [string, { method: string; body: unknown }];
    expect(patchOptions.method).toBe('PATCH');
    expect(patchOptions.body).toEqual({ template_id: 'tpl-9' });
  });

  it('start ze šablony si udělá vlastní kopii a knihovní šablonu nepřipojí', async () => {
    const { startCampaignFromTemplateAction } = await import('./actions');
    mutate
      .mockResolvedValueOnce({ ok: true, data: { id: 'camp-8' } })
      .mockResolvedValueOnce({ ok: true, data: { id: 'tpl-8' } })
      .mockResolvedValueOnce({ ok: true, data: { id: 'camp-8' } });

    const result = await startCampaignFromTemplateAction({
      workspaceId: WORKSPACE,
      name: 'Jarní novinky',
      templateId: 'tpl-1',
    });

    // `templateId` v odpovědi je PRACOVNÍ KOPIE, ne knihovní šablona: obrazovka
    // podle něj otevírá editor a ten nesmí sahat do knihovny.
    expect(result).toEqual({ status: 'success', campaignId: 'camp-8', templateId: 'tpl-8' });
    const paths = mutate.mock.calls.map(([path]) => String(path));
    expect(paths).toEqual(['/api/v1/campaigns', '/api/v1/templates', '/api/v1/campaigns/camp-8']);
  });

  it('když založení kampaně selže, šablona se nezakládá', async () => {
    const { startCampaignFromBlankAction } = await import('./actions');
    mutate.mockResolvedValueOnce({ ok: false, problem: { code: 'forbidden', detail: '' } });

    const result = await startCampaignFromBlankAction({
      workspaceId: WORKSPACE,
      name: 'Kampaň',
      locale: 'cs',
    });

    expect(result).toEqual({ status: 'error', code: 'forbidden' });
    expect(mutate).toHaveBeenCalledTimes(1);
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
    form.set('has_design', 'true');
    form.set('provider_id', 'prov-1');
    form.set('sender_domain_id', 'dom-1');
    form.set('unsubscribe_list_id', 'list-1');
    form.append('include_segment', 'seg-1');
    form.append('exclude_list', 'list-9');
    form.set('track_opens', 'on');

    const state = await updateCampaignSettingsAction(IDLE, form);

    expect(state.status).toBe('success');
    // Dvě volání, a v tomhle pořadí: nejdřív se uloží nastavení, teprve pak se
    // kampaň kompiluje. Obráceně by se kompilovala ještě podle starého předmětu.
    expect(mutate).toHaveBeenCalledTimes(2);
    const [path, options] = mutate.mock.calls[0] as [string, { method: string; body: unknown }];
    expect(path).toBe(`/api/v1/campaigns/${CAMPAIGN}`);
    expect(options.method).toBe('PATCH');
    expect(mutate.mock.calls[1]?.[0]).toBe(`/api/v1/campaigns/${CAMPAIGN}/compile`);
    expect(options.body).toEqual({
      name: 'Letní výprodej',
      subject: 'Letní výprodej začíná',
      preheader: 'Slevy až 50 %',
      from_name: 'Kolo Shop',
      from_email: 'info@kolo-shop.cz',
      reply_to: 'odpovedi@kolo-shop.cz',
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

  /**
   * Kompilace se pouští jen tehdy, když kampaň OBSAH MÁ. Bez obsahu by cesta
   * při KAŽDÉM uložení vracela `campaign_not_compiled`, tedy chybu u kroku,
   * který se obsahu vůbec netýkal.
   *
   * `template_id` se z formuláře nastavení NEPOSÍLÁ. Rozbalovací seznam znal
   * jen knihovní šablony, takže by uložení nastavení vynulovalo odkaz na
   * pracovní obsah kampaně a ta by přišla o jedinou cestu ke svému e-mailu.
   */
  it('bez obsahu kampaň nekompiluje', async () => {
    const { updateCampaignSettingsAction } = await import('./actions');
    await updateCampaignSettingsAction(IDLE, settingsForm());

    const paths = mutate.mock.calls.map(([path]) => String(path));
    expect(paths).toEqual([`/api/v1/campaigns/${CAMPAIGN}`]);
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
    form.set('provider_id', NO_SELECTION);
    form.set('sender_domain_id', NO_SELECTION);

    await updateCampaignSettingsAction(IDLE, form);

    const [, options] = mutate.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body['provider_id']).toBeNull();
    expect(options.body['sender_domain_id']).toBeNull();
  });

  /**
   * Obsah kampaně přes tenhle formulář NEPROCHÁZÍ. `template_id` tu bývalo
   * a bylo to nebezpečné: rozbalovací seznam znal jen knihovní šablony, takže
   * pracovní obsah kampaně mezi jeho položkami nikdy nebyl a uložení nastavení
   * by odkaz na něj vynulovalo. Kampaň by pak neměla čím obsah upravit.
   */
  it('template_id do PATCH kampaně neposílá vůbec', async () => {
    const { updateCampaignSettingsAction } = await import('./actions');
    const form = settingsForm();
    form.set('template_id', 'tpl-1');

    await updateCampaignSettingsAction(IDLE, form);

    const [, options] = mutate.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(Object.keys(options.body)).not.toContain('template_id');
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

/**
 * Odkaz kampaně na uloženou předvolbu odesílatele.
 *
 * `sender_identity_id` je poznámka „těchhle pět údajů vzniklo z předvolby X".
 * Formulář ta pole pouští k ruční úpravě, takže poznámka nesmí přežít okamžik,
 * kdy se s předvolbou rozejdou: rozbalovací seznam by nad kampaní ukazoval
 * cizí jméno a uživatel by odeslal pod adresou, kterou v seznamu nevidí.
 */
describe('odkaz na uloženou předvolbu odesílatele', () => {
  const NEWSLETTER = {
    id: 'sid-1',
    from_name: 'Kolo Shop',
    from_email: 'newsletter@kolo-shop.cz',
    reply_to: 'odpovedi@kolo-shop.cz',
    provider_id: 'prov-1',
    sender_domain_id: 'dom-1',
  };

  /** Formulář vyplněný přesně hodnotami předvolby, tedy stav po jejím výběru. */
  async function formFromIdentity(): Promise<FormData> {
    const { encodeSenderIdentityFingerprints } = await import('./sender-fingerprint');
    const form = settingsForm();
    form.set('from_name', NEWSLETTER.from_name);
    form.set('from_email', NEWSLETTER.from_email);
    form.set('reply_to', NEWSLETTER.reply_to);
    form.set('provider_id', NEWSLETTER.provider_id);
    form.set('sender_domain_id', NEWSLETTER.sender_domain_id);
    form.set('sender_identity_id', NEWSLETTER.id);
    form.set('sender_identity_options', encodeSenderIdentityFingerprints([NEWSLETTER]));
    return form;
  }

  it('drží odkaz, dokud se údaje s předvolbou shodují', async () => {
    const { updateCampaignSettingsAction } = await import('./actions');

    await updateCampaignSettingsAction(IDLE, await formFromIdentity());

    const [, options] = mutate.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body['sender_identity_id']).toBe('sid-1');
  });

  it('po ruční změně adresy odkaz zruší, aby seznam nelhal', async () => {
    const { updateCampaignSettingsAction } = await import('./actions');
    const form = await formFromIdentity();
    form.set('from_email', 'neco-jineho@kolo-shop.cz');

    await updateCampaignSettingsAction(IDLE, form);

    const [, options] = mutate.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body['sender_identity_id']).toBeNull();
  });

  /**
   * Otisk se počítá z NORMALIZOVANÝCH hodnot. Velikost písmen v adrese ani
   * mezera na konci jména nejsou změna údajů, jen jiný zápis téhož, a odkaz
   * kvůli nim mizet nesmí.
   */
  it('jiný zápis téže hodnoty odkaz neruší', async () => {
    const { updateCampaignSettingsAction } = await import('./actions');
    const form = await formFromIdentity();
    form.set('from_email', 'Newsletter@Kolo-Shop.cz');

    await updateCampaignSettingsAction(IDLE, form);

    const [, options] = mutate.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body['sender_identity_id']).toBe('sid-1');
  });

  /**
   * Bez seznamu otisků se odkaz NEPOSÍLÁ vůbec. Prázdný seznam znamená
   * „předvolby se nepodařilo načíst", ne „žádná nesedí"; nulovat uložený odkaz
   * kvůli výpadku číselníku by byla ztráta dat za nic.
   */
  it('bez seznamu předvoleb se odkazu ani nedotkne', async () => {
    const { updateCampaignSettingsAction } = await import('./actions');
    const form = await formFromIdentity();
    form.set('sender_identity_options', '');

    await updateCampaignSettingsAction(IDLE, form);

    const [, options] = mutate.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(Object.keys(options.body)).not.toContain('sender_identity_id');
  });
});
