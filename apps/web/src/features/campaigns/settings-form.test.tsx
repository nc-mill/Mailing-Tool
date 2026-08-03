import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, withProviders } from './test-utils';
import { failed, succeeded, IDLE, type ActionState } from '@/lib/feedback/action-result';
import type { Problem } from '@/lib/api-client/problem';
import {
  CampaignSettingsForm,
  type CampaignSettings,
  type CampaignSettingsOptions,
} from './settings-form';

/**
 * Obrazovka nastavení existuje jen kvůli jedné věci: co kontrolní seznam před
 * odesláním vyžaduje, to musí jít TADY vyplnit. Testy proto míří na tu shodu,
 * ne na vzhled: předmět, publikum, šablona a odesílací účet.
 */

/**
 * Radix `Checkbox` uvnitř `<form>` vykreslí skryté pole a měří ho přes
 * `ResizeObserver`, který jsdom nemá. Prázdná náhrada stačí: měření jen
 * dorovnává velikost, na chování formuláře nemá vliv.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const unschedule = vi.fn().mockResolvedValue({ status: 'success' });
vi.mock('./actions', () => ({
  unscheduleCampaignAction: (input: unknown) => unschedule(input),
}));

// `useRouter` z `@mlain/i18n/navigation` potřebuje kontext směrovače, který
// jsdom nemá. `Link` zůstává obyčejným odkazem, aby šlo tvrdit na `href`.
const refresh = vi.fn();
vi.mock('@mlain/i18n/navigation', async () => {
  const react = await import('react');
  return {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      react.createElement('a', { href, ...rest }, children),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh }),
  };
});

beforeEach(() => {
  unschedule.mockClear();
  unschedule.mockResolvedValue({ status: 'success' });
});

const CAMPAIGN: CampaignSettings = {
  id: 'camp-1',
  name: 'Letní výprodej',
  status: 'draft',
  subject: '',
  preheader: '',
  from_name: '',
  from_email: '',
  reply_to: null,
  template_id: null,
  provider_id: null,
  sender_domain_id: null,
  unsubscribe_list_id: null,
  track_opens: true,
  track_clicks: true,
  include_lists: [],
  include_segments: [],
  exclude_lists: [],
  exclude_segments: [],
};

const OPTIONS: CampaignSettingsOptions = {
  lists: [{ id: 'list-1', name: 'Newsletter' }],
  segments: [{ id: 'seg-1', name: 'Aktivní zákazníci' }],
  templates: [{ id: 'tpl-1', name: 'Výprodejová šablona' }],
  providers: [{ id: 'prov-1', name: 'Amazon SES' }],
  domains: [{ id: 'dom-1', name: 'kolo-shop.cz' }],
};

function renderForm(
  overrides: Partial<CampaignSettings> = {},
  action: (previous: ActionState, formData: FormData) => Promise<ActionState> = async () => IDLE,
  canEdit = true,
) {
  return renderWithProviders(
    <CampaignSettingsForm
      action={action}
      workspaceId="ws-1"
      campaign={{ ...CAMPAIGN, ...overrides }}
      options={OPTIONS}
      canEdit={canEdit}
      basePath="/w/kolo-shop"
    />,
  );
}

describe('nastavení kampaně', () => {
  it('nabízí pole pro všechno, co obrazovka odeslání vyžaduje', () => {
    renderForm();

    expect(screen.getByLabelText('Předmět')).toBeInTheDocument();
    expect(screen.getByLabelText('Šablona')).toBeInTheDocument();
    expect(screen.getByLabelText('Odesílací účet')).toBeInTheDocument();
    // Publikum nese skupina zaškrtávátek, protože seznamů i segmentů může být víc.
    expect(screen.getByRole('checkbox', { name: 'Newsletter' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Aktivní zákazníci' })).toBeInTheDocument();
  });

  it('odešle vyplněné hodnoty serverové akci, ne jen na obrazovku', async () => {
    const action = vi.fn(async (_previous: ActionState, _formData: FormData) => IDLE);
    renderForm({}, action);

    await userEvent.type(screen.getByLabelText('Předmět'), 'Letní výprodej začíná');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Newsletter' }));
    await userEvent.click(screen.getByRole('button', { name: 'Uložit nastavení' }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const formData = action.mock.calls[0]![1];
    expect(formData.get('subject')).toBe('Letní výprodej začíná');
    expect(formData.getAll('include_list')).toEqual(['list-1']);
    expect(formData.get('campaign_id')).toBe('camp-1');
    expect(formData.get('workspace_id')).toBe('ws-1');
  });

  it('předvyplní publikum, které kampaň už má', () => {
    renderForm({ include_lists: ['list-1'] });
    expect(screen.getByRole('checkbox', { name: 'Newsletter' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Aktivní zákazníci' })).not.toBeChecked();
  });

  it('ukáže chybu validace u pole, kterého se týká', async () => {
    const problem: Problem = {
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: '',
      instance: '/api/v1/campaigns/camp-1',
      code: 'validation_failed',
      request_id: '',
      errors: [{ path: 'subject', code: 'required', message: 'Zadejte předmět.' }],
    };
    renderForm({}, async () => failed('inline', problem));

    await userEvent.click(screen.getByRole('button', { name: 'Uložit nastavení' }));

    await waitFor(() => expect(screen.getByText('Zadejte předmět.')).toBeInTheDocument());
    expect(screen.getByLabelText('Předmět')).toHaveAttribute('aria-invalid', 'true');
  });

  it('vede na kontrolní seznam odeslání, aby obrazovka nebyla slepá', () => {
    renderForm();
    expect(screen.getByTestId('to-send')).toHaveAttribute(
      'href',
      '/w/kolo-shop/campaigns/camp-1/send',
    );
  });

  /**
   * Regrese na tichou ztrátu dat, naměřenou v prohlížeči.
   *
   * `SelectField` si hodnotu drží ve vlastním stavu a bere ji z `defaultValue`
   * jen při vzniku. Když se komponenta po akci vytvoří znovu dřív, než dorazí
   * čerstvý payload, ustaví se na starou hodnotu a s novou se už nesrovná:
   * vybraná šablona skočí na „Nevybráno" a DALŠÍ uložení pošle zástupnou
   * hodnotu, takže `template_id` v databázi zmizí.
   *
   * Test na to jde přes to, co vadu léčí: rozbalovací seznam musí mít identitu
   * odvozenou z uložené hodnoty, aby ho nová hodnota donutila vzniknout znovu.
   */
  it('po změně uložené hodnoty se rozbalovací seznam srovná s daty ze serveru', () => {
    const { rerender } = renderForm();
    expect(document.querySelector('input[name=template_id]')).toHaveValue('__none__');

    rerender(
      withProviders(
        <CampaignSettingsForm
          action={async () => succeeded({ channel: 'inline', messageKey: 'settings.saved' })}
          workspaceId="ws-1"
          campaign={{ ...CAMPAIGN, template_id: 'tpl-1' }}
          options={OPTIONS}
          canEdit
          basePath="/w/kolo-shop"
        />,
      ),
    );

    expect(
      document.querySelector('input[name=template_id]'),
      'seznam zůstal na staré hodnotě, takže další uložení šablonu smaže',
    ).toHaveValue('tpl-1');
  });

  it('rozjetou kampaň ukazuje jako text, ne jako zašedlý formulář', () => {
    renderForm({ status: 'sending', subject: 'Letní výprodej začíná' }, undefined, false);

    expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Uložit nastavení' })).not.toBeInTheDocument();
    expect(screen.getByText('Letní výprodej začíná')).toBeInTheDocument();
    // Rozjetou kampaň zpátky k úpravám nedostaneš, tlačítko by lhalo.
    expect(screen.queryByTestId('unschedule')).not.toBeInTheDocument();
  });

  it('naplánované kampani nabídne zrušení plánu, jinak je zámek slepá ulička', async () => {
    renderForm({ status: 'scheduled' }, undefined, false);

    const button = screen.getByTestId('unschedule');
    expect(button).toHaveTextContent('Zrušit plán a upravit');

    await userEvent.click(button);

    await waitFor(() => expect(unschedule).toHaveBeenCalledTimes(1));
    expect(unschedule).toHaveBeenCalledWith({ workspaceId: 'ws-1', campaignId: 'camp-1' });
  });

  it('neúspěch zrušení plánu nespolkne', async () => {
    unschedule.mockResolvedValueOnce({ status: 'error', code: 'invalid_state_transition' });
    renderForm({ status: 'scheduled' }, undefined, false);

    await userEvent.click(screen.getByTestId('unschedule'));

    await waitFor(() => expect(screen.getByTestId('unschedule-failed')).toBeInTheDocument());
  });

  /**
   * Výčet stavů je OTEVŘENÝ (část 4a, 4.1.1). Neznámý stav se musí ukázat
   * neutrálně, nikdy kvůli němu obrazovka nespadne ani nezahodí odpověď.
   */
  it('neznámý stav neshodí obrazovku, jen ji zamkne', () => {
    renderForm({ status: 'nejaky_novy_stav', subject: 'Letní výprodej začíná' }, undefined, false);

    expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
    expect(screen.getByText('Letní výprodej začíná')).toBeInTheDocument();
    expect(screen.queryByTestId('unschedule')).not.toBeInTheDocument();
  });
});
