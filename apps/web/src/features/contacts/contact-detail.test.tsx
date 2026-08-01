import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContactDetail, type ContactDetailData } from './contact-detail';
import { renderWithProviders } from './test-utils';

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('./actions', () => ({
  deleteContactAction: vi.fn().mockResolvedValue({ status: 'success' }),
  unsubscribeContactAction: vi.fn().mockResolvedValue({ status: 'success' }),
  exportContactAction: vi.fn().mockResolvedValue({ status: 'success' }),
}));

const base: ContactDetailData = {
  id: 'c-1',
  email: 'jana@firma.cz',
  name: 'Jana Nováková',
  greeting: 'Jano',
  greeting_locked: true,
  gender: 'female',
  status: 'active',
  processing_restricted: false,
  snooze_until: null,
  anonymized_at: null,
  status_changed_at: '2026-07-03T10:00:00.000Z',
  restriction_requested_at: null,
  lists: [{ id: 'l-1', name: 'Zákazníci' }],
  tags: [{ id: 't-1', name: 'Brno' }],
  attributes: [{ key: 'city', label: 'Město', value: 'Brno' }],
  source: 'Import',
  subscribed_at: '2026-06-12T14:20:00.000Z',
  consent_summary: 'formulář na webu, 12. 6. 2026 14:20',
};

function renderDetail(overrides: Partial<ContactDetailData> = {}) {
  return renderWithProviders(
    <ContactDetail
      basePath="/w/eshop/contacts"
      workspacePath="/w/eshop"
      contact={{ ...base, ...overrides }}
    />,
  );
}

describe('ContactDetail', () => {
  it('u omezeného zpracování ukáže vysvětlující blok včetně věty o segmentech', () => {
    renderDetail({
      processing_restricted: true,
      restriction_requested_at: '2026-07-18T08:00:00.000Z',
    });
    const block = screen.getByTestId('contact-restricted');
    expect(block).toHaveTextContent('Tenhle kontakt má omezené zpracování');
    expect(block).toHaveTextContent('vypadl ze všech segmentů');
    expect(screen.getByRole('link', { name: 'Zobrazit žádost' })).toBeInTheDocument();
  });

  it('bez omezeného zpracování žádný takový blok není', () => {
    renderDetail();
    expect(screen.queryByTestId('contact-restricted')).toBeNull();
  });

  it('u kontaktu s omezeným zpracováním nenabízí jednorázový e-mail', () => {
    renderDetail({ processing_restricted: true });
    expect(screen.queryByRole('button', { name: 'Poslat jednorázový e-mail' })).toBeNull();
  });

  it('stav nese slovo, ne jen barvu', () => {
    renderDetail({ status: 'bounced' });
    expect(screen.getByText('Nedoručitelný')).toBeInTheDocument();
    expect(screen.getByText(/Adresa neexistuje/)).toBeInTheDocument();
  });

  it('u zamčeného oslovení vysvětlí zámek slovem, ne jen ikonou', () => {
    renderDetail();
    expect(screen.getByText('Jano')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Oslovení potvrdil člověk, nástroj ho nepřepíše.'),
    ).toBeInTheDocument();
  });

  it('smazaný kontakt je jen pro čtení a nemá mazací tlačítko', () => {
    renderDetail({ status: 'deleted' });
    expect(screen.getByText('Kontakt je smazaný, takže se dá jen prohlížet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Smazat' })).toBeNull();
  });

  it('má místo pro časovou osu s prázdným stavem, který jmenuje kontakt', () => {
    renderDetail();
    const timeline = screen.getByTestId('contact-timeline');
    expect(timeline).toHaveTextContent('Zatím se nic nestalo');
    expect(timeline).toHaveTextContent('Jana Nováková');
  });

  it('dialog smazání má doslovné znění ze 8.8 části 6 a nabídne stažení dat', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole('button', { name: 'Smazat' }));
    expect(screen.getByText('Smazat kontakt Jana Nováková?')).toBeInTheDocument();
    expect(
      screen.getByText(/V reportech odeslaných kampaní zůstanou jen souhrnná čísla/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Adresa zůstane na blokovaných adresách/)).toBeInTheDocument();
    expect(screen.getByText('Tuhle akci nejde vzít zpět.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stáhnout data kontaktu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nemazat' })).toBeInTheDocument();
  });

  it('u anonymizovaného kontaktu nezobrazuje osobní údaje', () => {
    renderDetail({ status: 'deleted', anonymized_at: '2026-07-20T09:00:00.000Z' });
    expect(screen.queryByText('Město')).toBeNull();
    expect(screen.getByText(/Zůstal jen záznam/)).toBeInTheDocument();
  });
});
