import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './test-utils';
import { CampaignNameField, type RenameOutcome } from './campaign-name-field';
import { canRenameCampaign } from './campaign-rename';

/**
 * Přejmenování kampaně přímo v hlavičce obrazovky.
 *
 * Vada zněla doslova: „Kampaň, která není odeslaná, není možné přejmenovat.
 * Tady kde je název by měla být možnost inline edit." Přejmenovat přitom šlo,
 * ale jen v kroku 2, tedy o obrazovku dál, než kde je název napsaný.
 *
 * Testy proto míří na to, co uživatel na obrazovce dělá: že je vidět pole,
 * že se uloží při odchodu z něj i na Enter, že Escape vrátí původní jméno,
 * že prázdné jméno neuloží, a hlavně že SELHÁNÍ SERVERU se nespolkne.
 */

function renderField(overrides: {
  name?: string;
  canRename?: boolean;
  onRename?: (name: string) => Promise<RenameOutcome>;
}): { rename: ReturnType<typeof vi.fn> } {
  const rename = vi.fn(
    overrides.onRename ?? (async () => ({ status: 'success' }) as RenameOutcome),
  );
  renderWithProviders(
    <CampaignNameField
      name={overrides.name ?? 'Letní výprodej'}
      canRename={overrides.canRename ?? true}
      onRename={rename}
    />,
  );
  return { rename };
}

describe('název kampaně v hlavičce', () => {
  it('je pole, ne nadpis, takže je na první pohled vidět, že jde upravit', () => {
    renderField({});

    const input = screen.getByTestId('campaign-name-input');
    expect(input).toHaveValue('Letní výprodej');
    // Přístupné jméno je totéž, jaké nese pole v kroku 2.
    expect(screen.getByLabelText('Název kampaně')).toBe(input);
  });

  it('ukládá při odchodu z pole', async () => {
    const { rename } = renderField({});

    const input = screen.getByTestId('campaign-name-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'Podzimní výprodej');
    await userEvent.tab();

    await waitFor(() => expect(rename).toHaveBeenCalledWith('Podzimní výprodej'));
  });

  /** Enter je to, co uživatel po dopsání zmáčkne. Bez něj by pole vypadalo jako mrtvé. */
  it('ukládá na Enter, aniž by bylo potřeba odklikávat jinam', async () => {
    const { rename } = renderField({});

    const input = screen.getByTestId('campaign-name-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'Vánoční novinky{Enter}');

    await waitFor(() => expect(rename).toHaveBeenCalledWith('Vánoční novinky'));
  });

  it('po uložení to řekne nahlas, jinak by se nedalo poznat, že se něco stalo', async () => {
    renderField({});

    const input = screen.getByTestId('campaign-name-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'Nové jméno{Enter}');

    expect(await screen.findByText('Název kampaně uložen.')).toBeInTheDocument();
  });

  /** Escape je cesta ven z rozepsaného překlepu. Nesmí po sobě nic uložit. */
  it('Escape vrátí původní jméno a nic neukládá', async () => {
    const { rename } = renderField({});

    const input = screen.getByTestId('campaign-name-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'Překlep{Escape}');

    expect(input).toHaveValue('Letní výprodej');
    await userEvent.tab();
    expect(rename).not.toHaveBeenCalled();
  });

  it('prázdné jméno neuloží a řekne proč', async () => {
    const { rename } = renderField({});

    const input = screen.getByTestId('campaign-name-input');
    await userEvent.clear(input);
    await userEvent.tab();

    expect(rename).not.toHaveBeenCalled();
    expect(screen.getByTestId('campaign-name-error')).toHaveTextContent('Zadejte název kampaně.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('jméno delší než dvě stě znaků neuloží', async () => {
    const { rename } = renderField({});

    const input = screen.getByTestId('campaign-name-input');
    await userEvent.clear(input);
    // `paste` místo `type`: 201 znaků po jednom je v jsdom zbytečně dlouhé.
    await userEvent.click(input);
    await userEvent.paste('x'.repeat(201));
    await userEvent.tab();

    expect(rename).not.toHaveBeenCalled();
    expect(screen.getByTestId('campaign-name-error')).toHaveTextContent(
      'Název je delší než 200 znaků.',
    );
  });

  it('samé mezery navíc nejsou změna, server se kvůli nim neobtěžuje', async () => {
    const { rename } = renderField({});

    const input = screen.getByTestId('campaign-name-input');
    await userEvent.click(input);
    await userEvent.paste('   ');
    await userEvent.tab();

    expect(rename).not.toHaveBeenCalled();
    expect(input).toHaveValue('Letní výprodej');
  });

  /**
   * TOHLE JE TA VADA, KTERÁ SE HLEDALA. Jinde v aplikaci se chyba serveru
   * spolkla a okno se prostě zavřelo. Tady musí platit obojí: jméno se vrátí
   * na to, co na serveru opravdu je, a řekne se, že se neuložilo.
   */
  it('selhání uložení vrátí původní jméno a nespolkne se', async () => {
    renderField({ onRename: async () => ({ status: 'error', code: 'internal_error' }) });

    const input = screen.getByTestId('campaign-name-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'Neuloží se{Enter}');

    await waitFor(() => expect(input).toHaveValue('Letní výprodej'));
    expect(screen.getByTestId('campaign-name-error')).toHaveTextContent(
      'Název se nepodařilo uložit, zůstal ten původní.',
    );
  });

  it('zamčená kampaň má vlastní hlášku, ne obecné „zkuste to znovu"', async () => {
    renderField({ onRename: async () => ({ status: 'error', code: 'campaign_locked' }) });

    const input = screen.getByTestId('campaign-name-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'Pozdě{Enter}');

    expect(await screen.findByTestId('campaign-name-error')).toHaveTextContent(
      'Rozjetou kampaň už přejmenovat nejde.',
    );
  });

  /**
   * Ve stavech, kde přejmenovat nejde, se pole NENABÍZÍ. Pole, které se dá
   * vyplnit a při odchodu z něj vyhodí chybu, je horší než holý nadpis.
   */
  it('tam, kde přejmenovat nejde, žádné pole není', () => {
    renderField({ canRename: false });

    expect(screen.queryByTestId('campaign-name-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-name-readonly')).toHaveTextContent('Letní výprodej');
  });
});

describe('ve kterých stavech se smí přejmenovat', () => {
  /**
   * NENÍ TO TÁŽ MNOŽINA JAKO U OBSAHU. Naplánovaná kampaň má obsah zamčený,
   * ale `PATCH /campaigns/{id}` u ní `name` pouští, protože je
   * v `EDITABLE_WHILE_SCHEDULED`. Kdyby se tady jelo podle stavů obsahu,
   * u naplánované kampaně by přejmenování zbytečně zmizelo.
   */
  it.each(['draft', 'schedule_missed', 'scheduled'])('%s se přejmenovat smí', (status) => {
    expect(canRenameCampaign(status)).toBe(true);
  });

  it.each(['queueing', 'sending', 'paused', 'sent', 'partially_sent', 'cancelled', 'failed'])(
    '%s se přejmenovat nesmí',
    (status) => {
      expect(canRenameCampaign(status)).toBe(false);
    },
  );

  /** Výčet stavů je otevřený. Cokoli neznámého je zamčené, ne otevřené dokořán. */
  it('neznámý stav se přejmenovat nesmí', () => {
    expect(canRenameCampaign('ab_testing')).toBe(false);
  });
});
