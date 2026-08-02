import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReadinessChecklist, type Preflight } from './readiness-checklist';
import { renderWithProviders } from './test-utils';

const breakdown = {
  raw: 1208,
  eligible: 1129,
  excluded_suppressed: 12,
  excluded_unsubscribed: 43,
  excluded_unconfirmed: 17,
  excluded_snoozed: 4,
  excluded_processing_restricted: 3,
  excluded_invalid_email: 0,
  excluded_deleted: 0,
  excluded_sample: 0,
  excluded_by_selection: 0,
  duplicates_removed: 0,
};

const preflight: Preflight = {
  can_send: true,
  audience_estimate: 1129,
  breakdown,
  quota_remaining: 48_000,
  undo_window_seconds: 60,
  findings: [{ code: 'domain_dmarc_missing', severity: 'warning' }],
  checked_at: '2026-08-01T12:00:00.000Z',
};

function renderChecklist(override: Partial<Preflight> = {}) {
  return renderWithProviders(
    <ReadinessChecklist
      preflight={{ ...preflight, ...override }}
      campaignName="Letní výprodej"
      fromLine="Jana z Kolo Shopu <jana@kolo-shop.cz>"
      subject="Letní výprodej začíná"
      onSend={vi.fn().mockResolvedValue({ status: 'success' })}
    />,
  );
}

describe('kontrolní seznam připravenosti', () => {
  it('ukazuje, komu se to pošle: počet, odesílatele i předmět', () => {
    renderChecklist();
    // Číslo formátuje `Intl` úzkou nezlomitelnou mezerou, ne obyčejnou; regulární
    // výraz s `\s` proto sedí na obojí a test se nerozbije podle prostředí.
    expect(screen.getByTestId('recipient-count')).toHaveTextContent(/1\s?129 příjemců/u);
    expect(screen.getByText('Jana z Kolo Shopu <jana@kolo-shop.cz>')).toBeInTheDocument();
    expect(screen.getByText('Letní výprodej začíná')).toBeInTheDocument();
  });

  it('součet vyloučených plus výsledný počet se rovná vstupnímu počtu', () => {
    renderChecklist();
    const text = screen.getByTestId('audience-sum-check').textContent ?? '';
    expect(text).toMatch(/1\s?208/u);
    expect(text).toMatch(/1\s?129/u);
  });

  it('řádek Vyloučeno je pojmenovaný po branách, ne souhrnný', () => {
    renderChecklist();
    const list = screen.getByTestId('excluded-list');
    expect(list).toHaveTextContent('12 blokovaných');
    expect(list).toHaveTextContent('3 s omezeným zpracováním');
  });

  it('nulové brány se v seznamu nezobrazují, v rozpadu ano', async () => {
    renderChecklist();
    expect(screen.getByTestId('excluded-list')).not.toHaveTextContent('ukázkových kontaktů');
    // Rozpad je sbalený a jeho obsah se do stromu vkládá až po rozbalení.
    await userEvent.click(screen.getByRole('button', { name: 'Rozpad' }));
    expect(screen.getByTestId('breakdown-panel')).toHaveTextContent('ukázkových kontaktů');
  });

  it('číslo na tlačítku pochází ze stejného volání jako řádek Publikum', () => {
    renderChecklist();
    expect(screen.getByRole('button', { name: /Odeslat 1\s?129 e-mailů/u })).toBeInTheDocument();
  });

  it('varování je vidět i bez otevření dialogu', () => {
    renderChecklist();
    expect(screen.getByTestId('finding-domain_dmarc_missing')).toBeInTheDocument();
  });

  it('tlačítko zůstává aktivní i při blokující položce a přesune na ni fokus', async () => {
    renderChecklist({
      can_send: false,
      findings: [{ code: 'campaign_no_unsubscribe', severity: 'error' }],
    });
    const button = screen.getByRole('button', { name: /Odeslat/ });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(screen.getByTestId('finding-campaign_no_unsubscribe')).toHaveFocus();
  });

  it('neznámý kód nálezu obrazovku nepoloží', () => {
    renderChecklist({ findings: [{ code: 'nova_kontrola_z_budoucnosti', severity: 'warning' }] });
    expect(screen.getByTestId('finding-nova_kontrola_z_budoucnosti')).toBeInTheDocument();
  });
});

describe('potvrzovací dialog odeslání', () => {
  it('otevře se až kliknutím a má roli dialog s popiskem', async () => {
    renderChecklist();
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Odeslat 1\s?129 e-mailů/u }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/Odeslat kampaň/);
  });

  it('věta o nevratnosti je doslova, ne jen červené tlačítko', async () => {
    renderChecklist();
    await userEvent.click(screen.getByRole('button', { name: /Odeslat 1\s?129 e-mailů/u }));
    expect(screen.getByText(/Potom už e-maily zpátky vzít nejde/)).toBeInTheDocument();
  });

  it('fokus po otevření je na Zpět k úpravám, ne na Odeslat', async () => {
    renderChecklist();
    await userEvent.click(screen.getByRole('button', { name: /Odeslat 1\s?129 e-mailů/u }));
    expect(screen.getByRole('button', { name: 'Zpět k úpravám' })).toHaveFocus();
  });

  it('souhrn v dialogu opakuje příjemce, odesílatele i předmět', async () => {
    renderChecklist();
    await userEvent.click(screen.getByRole('button', { name: /Odeslat 1\s?129 e-mailů/u }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/1\s?129 příjemců/u);
    expect(dialog).toHaveTextContent('jana@kolo-shop.cz');
    expect(dialog).toHaveTextContent('Letní výprodej začíná');
  });
});
