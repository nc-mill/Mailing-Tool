import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { campaignSegmentDefinition } from '@mlain/core/segments';
import type { SegmentAst } from '@mlain/ui/patterns/query-builder';
import { buildFieldCatalog } from '../../src/features/segments/field-catalog';
import { SegmentEditor } from '../../src/features/segments/segment-editor';
import { renderIntl } from '../helpers/intl';

const CAMPAIGN = { id: '019fcd5c-03ba-7db3-b5b4-6c992f6fa887', name: 'Slouceny krok 1' };

/** Překlady se v katalogu jen vyhledávají, tady stačí klíč a dosazený název. */
const t = (key: string, values?: Record<string, unknown>) =>
  values?.['campaign'] === undefined ? key : `${key}:${String(values['campaign'])}`;

describe('katalog polí omezený na kampaň', () => {
  it('bez kampaně žádná pole navíc nepřidá', () => {
    const ids = buildFieldCatalog(t).map((field) => field.id);
    expect(ids.filter((id) => id.includes('.campaign.'))).toEqual([]);
  });

  /**
   * Tohle je jádro věci. Stavitel poznává pole DOSLOVNÝM porovnáním `ref`
   * s `condition.field`, takže obecná položka se `scope: {}` na podmínku
   * omezenou na kampaň nesedne a výběr pole zůstane prázdný. Uživatel by pak
   * viděl segment, který nejde zkontrolovat, přestože se správně počítá.
   */
  it('pro kampaň přidá pole, jejichž ref se DOSLOVA shoduje s předvyplněnou podmínkou', () => {
    const fields = buildFieldCatalog(t, { campaign: CAMPAIGN });
    const definition = campaignSegmentDefinition('not_opened', CAMPAIGN.id);

    for (const child of definition.root.children) {
      if (child.type !== 'condition') continue;
      const match = fields.find(
        (field) => JSON.stringify(field.ref) === JSON.stringify(child.field),
      );
      expect(match, JSON.stringify(child.field)).toBeDefined();
    }
  });

  it('pole nese název kampaně, ať je věta v segmentu jednoznačná', () => {
    const fields = buildFieldCatalog(t, { campaign: CAMPAIGN });
    const clicked = fields.find((field) => field.id.endsWith(`clicked.campaign.${CAMPAIGN.id}`));
    expect(clicked?.label).toBe('fields.engagementInCampaign.clicked:Slouceny krok 1');
  });
});

describe('předvyplněný segment z reportu kampaně', () => {
  const draft = {
    name: 'Klikli v kampani Slouceny krok 1',
    definition: campaignSegmentDefinition('clicked', CAMPAIGN.id) as SegmentAst,
    notices: ['Podmínku jsme předvyplnili z reportu kampaně.'],
  };

  it('otevře se s vyplněným názvem, hotovou podmínkou a přiznáním, odkud přišla', () => {
    renderIntl(
      <SegmentEditor
        workspaceId="019fc763-7184-72dd-a48d-3cf3ec306179"
        workspaceSlug="petr-osobni-mail"
        segment={null}
        draft={draft}
        fields={buildFieldCatalog(t, { campaign: CAMPAIGN })}
      />,
    );

    expect(screen.getByDisplayValue('Klikli v kampani Slouceny krok 1')).toBeDefined();
    expect(screen.getByTestId('segment-draft-notice').textContent).toContain(
      'předvyplnili z reportu kampaně',
    );
  });

  /**
   * Návrh se NEUKLÁDÁ sám. Odkaz z reportu je GET a kdyby po sobě zakládal
   * trvalý segment, vyrobilo by ho i předběžné načtení odkazu prohlížečem.
   */
  it('samo od sebe nic neukládá, dokud uživatel neklikne na Uložit', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderIntl(
      <SegmentEditor
        workspaceId="019fc763-7184-72dd-a48d-3cf3ec306179"
        workspaceSlug="petr-osobni-mail"
        segment={null}
        draft={draft}
        fields={buildFieldCatalog(t, { campaign: CAMPAIGN })}
      />,
    );
    expect(fetchSpy).not.toHaveBeenCalledWith(
      '/api/v1/segments',
      expect.objectContaining({ method: 'POST' }),
    );
    vi.unstubAllGlobals();
  });

  it('bez návrhu zůstává stavitel prázdný, jak byl', () => {
    renderIntl(
      <SegmentEditor
        workspaceId="019fc763-7184-72dd-a48d-3cf3ec306179"
        workspaceSlug="petr-osobni-mail"
        segment={null}
        fields={buildFieldCatalog(t)}
      />,
    );
    expect(screen.queryByTestId('segment-draft-notice')).toBeNull();
  });
});
