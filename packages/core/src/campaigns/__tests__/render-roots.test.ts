import { describe, expect, it } from 'vitest';
import { createHtmlEngine } from '@mlain/contracts/liquid/engine';
import { withCampaignRoots, type CampaignRootsSource } from '../render-roots';

const source: CampaignRootsSource = {
  campaignName: 'Letní výprodej',
  subjectSource: 'Ahoj {{ contact.first_name }}',
  preheaderSource: 'Končí v neděli',
  workspaceName: 'Kolo Eshop',
  postalAddress: 'Kolo Eshop s.r.o., Nádražní 5, 110 00 Praha 1',
};

const renderData = {
  contact: { first_name: 'Jana' },
  _context: { timezone: 'Europe/Prague', locale: 'cs' },
  _present: { workspace__sender_address: false, contact__first_name: true },
};

describe('kořeny campaign a workspace v aplikaci', () => {
  it('doplní hodnoty, které v render_data nikdy nejsou', async () => {
    const { data } = await withCampaignRoots({ ...renderData }, source);
    expect(data['campaign']).toMatchObject({ name: 'Letní výprodej' });
    expect(data['workspace']).toEqual({
      name: 'Kolo Eshop',
      sender_address: 'Kolo Eshop s.r.o., Nádražní 5, 110 00 Praha 1',
    });
  });

  it('předmět je vyrenderovaný, ne zdroj s Liquid výrazem', async () => {
    const { roots } = await withCampaignRoots({ ...renderData }, source);
    expect(roots.campaign.subject).toBe('Ahoj Jana');
  });

  /**
   * Bez tohohle přepočtu ukazuje „Zobrazit v prohlížeči" jinou zprávu, než jaká
   * odešla: mapu `_present` plní materializace, kdy poštovní adresu ještě nezná,
   * takže by podmíněný blok v prohlížeči zmizel, i když ho příjemce v e-mailu měl.
   */
  it('přepočítá _present pro kořeny, které se dodávají až teď', async () => {
    const { data } = await withCampaignRoots({ ...renderData }, source);
    expect(data['_present']).toEqual({
      workspace__sender_address: true,
      contact__first_name: true,
    });
  });

  it('prázdná poštovní adresa zůstane nepřítomná', async () => {
    const { data } = await withCampaignRoots({ ...renderData }, { ...source, postalAddress: '' });
    expect((data['_present'] as Record<string, boolean>)['workspace__sender_address']).toBe(false);
  });

  it('vyrenderovaná patička nese poštovní adresu projektu', async () => {
    const { data } = await withCampaignRoots({ ...renderData }, source);
    const html = await createHtmlEngine().parseAndRender(
      '<p>{{ workspace.sender_address }}</p>',
      data,
    );
    expect(html).toContain('Nádražní 5');
  });

  /** Data zprávy se nepřepisují na místě: tentýž objekt čte i volající. */
  it('nemutuje vstupní data', async () => {
    const input = { ...renderData };
    await withCampaignRoots(input, source);
    expect(input).not.toHaveProperty('workspace');
    expect(input._present.workspace__sender_address).toBe(false);
  });
});
