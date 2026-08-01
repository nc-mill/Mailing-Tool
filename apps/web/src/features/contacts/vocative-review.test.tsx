import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VocativeReview } from './vocative-review';
import type { VocativeReviewGroupView } from './vocative-review-types';
import { renderWithProviders } from './test-utils';

const confirmGroup = vi.fn().mockResolvedValue({ status: 'success' });
const neutralAll = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('./actions', () => ({
  vocativeReviewAction: (...args: unknown[]) => confirmGroup(...args),
  vocativeNeutralAllAction: (...args: unknown[]) => neutralAll(...args),
}));

const groups: VocativeReviewGroupView[] = [
  {
    name_key: 'nikola',
    kind: 'first',
    display_name: 'Nikola',
    gender: 'unknown',
    gender_source: 'unknown',
    suggested_vocative: 'Nikolo',
    contact_count: 27,
    sample_surnames: ['Dvořák', 'Nováková'],
    sample_contact_id: 'c-9',
    reasons: ['AMBIGUOUS_GIVEN_NAME'],
  },
  {
    name_key: 'nguyen',
    kind: 'first',
    display_name: 'Nguyen',
    gender: 'unknown',
    gender_source: 'unknown',
    suggested_vocative: null,
    contact_count: 4,
    sample_surnames: ['Thi'],
    sample_contact_id: 'c-11',
    reasons: ['gender_unknown', 'non_latin_script'],
  },
];

function renderReview(overrides: Partial<React.ComponentProps<typeof VocativeReview>> = {}) {
  return renderWithProviders(
    <VocativeReview
      basePath="/w/eshop/contacts"
      workspaceId="w-1"
      groups={groups}
      totals={{ groups: 2, uncertainContacts: 31, totalContacts: 3214 }}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  confirmGroup.mockClear();
  window.localStorage.clear();
});

describe('VocativeReview', () => {
  it('zobrazuje skupiny, ne jednotlivé kontakty', () => {
    renderReview();
    expect(screen.getAllByTestId('vocative-group')).toHaveLength(2);
    expect(screen.getByText('27 kontaktů')).toBeInTheDocument();
    expect(screen.queryByText('c-9')).toBeNull();
  });

  it('u skupiny ukáže vzorek příjmení, ať uživatel ví, o koho jde', () => {
    renderReview();
    expect(screen.getByText(/Dvořák/)).toBeInTheDocument();
  });

  it('nabídne u skupiny všech pět operací', () => {
    renderReview();
    const group = screen.getAllByTestId('vocative-group')[0]!;
    for (const label of [
      'Potvrdit návrh',
      'Opravit oslovení',
      'Nastavit rod',
      'Nepoužívat jméno',
      'Odložit',
    ]) {
      expect(within(group).getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('volba uložit i pro budoucí kontakty je ve výchozím stavu zaškrtnutá', () => {
    renderReview();
    const group = screen.getAllByTestId('vocative-group')[0]!;
    expect(within(group).getByRole('checkbox')).toBeChecked();
  });

  it('potvrzení pošle akci včetně příznaku o zapamatování', async () => {
    const user = userEvent.setup();
    renderReview();
    const group = screen.getAllByTestId('vocative-group')[0]!;
    await user.click(within(group).getByRole('button', { name: 'Potvrdit návrh' }));
    expect(confirmGroup).toHaveBeenCalledWith({
      groups: [
        {
          name_key: 'nikola',
          kind: 'first',
          action: 'confirm',
          gender: 'unknown',
          vocative: 'Nikolo',
          save_override: true,
        },
      ],
    });
  });

  it('u skupiny bez návrhu potvrzení nenabízí, protože není co potvrdit', () => {
    renderReview();
    const group = screen.getAllByTestId('vocative-group')[1]!;
    expect(within(group).queryByRole('button', { name: 'Potvrdit návrh' })).toBeNull();
    expect(within(group).getByText('Zatím nemáme návrh, jak jméno skloňovat.')).toBeInTheDocument();
  });

  it('pod stropem ruční práce nenabízí hromadné neutrální oslovení', () => {
    renderReview();
    expect(screen.queryByTestId('vocative-soft-limit')).toBeNull();
  });

  it('nad stropem skupin nabídne neutrální oslovení jako doporučenou volbu', () => {
    renderReview({ totals: { groups: 140, uncertainContacts: 900, totalContacts: 100000 } });
    const banner = screen.getByTestId('vocative-soft-limit');
    expect(
      within(banner).getByRole('button', {
        name: 'Použít u nejistých kontaktů neutrální oslovení',
      }),
    ).toHaveAttribute('data-recommended', 'true');
    expect(banner).toHaveTextContent('140 skupin');
    expect(within(banner).getByRole('button', { name: 'Přesto projít ručně' })).toBeInTheDocument();
  });

  it('nad desetinou kontaktů nabídne totéž a uvede podíl v procentech', () => {
    renderReview({ totals: { groups: 8, uncertainContacts: 400, totalContacts: 3000 } });
    expect(screen.getByTestId('vocative-soft-limit')).toHaveTextContent('13,3 %');
  });

  it('odložení skupinu schová a přežije v prohlížeči', async () => {
    const user = userEvent.setup();
    renderReview();
    const group = screen.getAllByTestId('vocative-group')[0]!;
    await user.click(within(group).getByRole('button', { name: 'Odložit' }));
    expect(screen.getAllByTestId('vocative-group')).toHaveLength(1);
    expect(window.localStorage.getItem('mlain.vocative-review.deferred.w-1')).toContain(
      'first:nikola',
    );
  });

  it('prázdná fronta vysvětlí, proč je prázdná, a nabídne cestu dál', () => {
    renderReview({ groups: [], totals: { groups: 0, uncertainContacts: 0, totalContacts: 3214 } });
    expect(screen.getByRole('heading', { name: 'Není co kontrolovat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zpět na kontakty' })).toBeInTheDocument();
  });
});
