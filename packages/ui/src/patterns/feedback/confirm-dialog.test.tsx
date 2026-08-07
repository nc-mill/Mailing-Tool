import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';

const labels = {
  irreversible: 'Tohle nejde vzít zpět.',
  whatHappens: 'Co se stane:',
  notYetConfirmed: 'Nejdřív zaškrtněte, že rozumíte následkům.',
  notYetTyped: 'Nejdřív opište název.',
  typeToConfirmMismatch: 'Opsaný text zatím nesouhlasí.',
  filterInWords: (filter: string) => `Filtr: ${filter}`,
};

function base(overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  return {
    open: true,
    onOpenChange: () => {},
    level: 'N3' as const,
    destructive: true,
    title: 'Smazat 3 402 kontaktů?',
    consequences: [
      'Kontakty zmizí ze všech seznamů a segmentů',
      'Jejich historie otevření a kliknutí se smaže',
      'Kontakty, které se odhlásily, zůstanou na blokovaných adresách',
    ],
    confirmLabel: 'Smazat 3 402 kontaktů',
    cancelLabel: 'Nemazat',
    acknowledgement: 'Rozumím, že smazané kontakty nepůjde obnovit',
    onConfirm: vi.fn(),
    labels,
    ...overrides,
  };
}

describe('ConfirmDialog', () => {
  it('nadpis i tlačítko nesou počet', () => {
    render(<ConfirmDialog {...base()} />);
    expect(screen.getByRole('heading', { name: 'Smazat 3 402 kontaktů?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Smazat 3 402 kontaktů' })).toBeVisible();
  });

  it('vypisuje následky jako body, ne obecnou větu', () => {
    render(<ConfirmDialog {...base()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('N3 bez zaškrtnutí akci neprovede a řekne proč', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...base({ onConfirm })} />);

    await user.click(screen.getByRole('button', { name: 'Smazat 3 402 kontaktů' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Nejdřív zaškrtněte, že rozumíte následkům.')).toBeVisible();
  });

  it('potvrzovací tlačítko nikdy nemá atribut disabled', () => {
    render(<ConfirmDialog {...base()} />);
    expect(screen.getByRole('button', { name: 'Smazat 3 402 kontaktů' })).not.toBeDisabled();
  });

  it('po zaškrtnutí akci provede', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...base({ onConfirm })} />);

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Smazat 3 402 kontaktů' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('N4 žádá opsání identifikátoru', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        {...base({
          level: 'N4',
          title: 'Smazat projekt E-shop Kolo?',
          confirmLabel: 'Smazat projekt',
          acknowledgement: undefined,
          confirmPhrase: 'E-shop Kolo',
          confirmPhraseLabel: 'Pro potvrzení opište název projektu',
          onConfirm,
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Smazat projekt' }));
    expect(onConfirm).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Pro potvrzení opište název projektu'), 'E-shop Kolo');
    await user.click(screen.getByRole('button', { name: 'Smazat projekt' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('destruktivní akce má potvrzení v barvě nebezpečí', () => {
    render(<ConfirmDialog {...base()} />);
    expect(screen.getByRole('button', { name: 'Smazat 3 402 kontaktů' })).toHaveClass('bg-danger');
  });

  it('nedestruktivní potvrzení nese barvu primární akce, ne červenou', () => {
    // Kdyby červeně svítilo i „Archivovat pole", přestane červená v aplikaci
    // odlišovat mazání a lidé si zvyknou odklikávat červená tlačítka bez čtení.
    render(
      <ConfirmDialog
        {...base({
          level: 'N2',
          destructive: false,
          acknowledgement: undefined,
          title: 'Archivovat pole Telefon?',
          confirmLabel: 'Archivovat pole',
        })}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Archivovat pole' });
    expect(confirm).toHaveClass('bg-primary');
    expect(confirm).not.toHaveClass('bg-danger');
  });

  it('výchozí fokus je na ústupu, ne na destruktivním tlačítku', () => {
    // Pravidlo 9.4. Kdo dialog odklikne poslepu Enterem, nesmí tím smazat
    // tři a půl tisíce kontaktů.
    render(<ConfirmDialog {...base()} />);
    expect(screen.getByRole('button', { name: 'Nemazat' })).toHaveFocus();
  });

  it('umí jedno tlačítko navíc vedle ústupu', async () => {
    const user = userEvent.setup();
    const onExtra = vi.fn();
    render(
      <ConfirmDialog
        {...base({
          extraAction: (
            <button type="button" onClick={onExtra}>
              Vyexportovat a pak smazat
            </button>
          ),
        })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Vyexportovat a pak smazat' }));
    expect(onExtra).toHaveBeenCalledTimes(1);
  });

  it('opisované pole jde řídit zvenčí', async () => {
    const user = userEvent.setup();
    const onConfirmPhraseChange = vi.fn();
    render(
      <ConfirmDialog
        {...base({
          level: 'N4',
          acknowledgement: undefined,
          confirmPhrase: 'E-shop Kolo',
          confirmPhraseLabel: 'Opište název projektu',
          onConfirmPhraseChange,
        })}
      />,
    );
    await user.type(screen.getByLabelText('Opište název projektu'), 'X');
    expect(onConfirmPhraseChange).toHaveBeenCalled();
  });

  it('N1 se nesmí použít, dialog to nahlásí jako chybu vývojáře', () => {
    expect(() => render(<ConfirmDialog {...base({ level: 'N1' })} />)).toThrow(/N1/);
  });

  it('u hromadné akce nad výběrem podle filtru zopakuje filtr slovy', () => {
    render(
      <ConfirmDialog
        {...base({ filterDescription: 'seznam Zákazníci, štítek Brno, stav Aktivní' })}
      />,
    );
    expect(screen.getByText('Filtr: seznam Zákazníci, štítek Brno, stav Aktivní')).toBeVisible();
  });

  it('nabídne export před smazáním, když ho volající předá', async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(
      <ConfirmDialog
        {...base({ exportAction: { label: 'Stáhnout těchto 3 402 kontaktů jako CSV', onExport } })}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Stáhnout těchto 3 402 kontaktů jako CSV' }),
    );
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('nabídne měkčí variantu, když existuje', async () => {
    const user = userEvent.setup();
    const onSofter = vi.fn();
    render(
      <ConfirmDialog
        {...base({
          softerAlternative: {
            question: 'Chcete jen na chvíli zastavit a pak pokračovat?',
            label: 'Radši pozastavit',
            onChoose: onSofter,
          },
        })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Radši pozastavit' }));
    expect(onSofter).toHaveBeenCalledTimes(1);
  });
});
