import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BulkDeleteDialog } from './bulk-delete-dialog';
import { renderWithProviders } from './test-utils';

function renderDialog(props: Partial<React.ComponentProps<typeof BulkDeleteDialog>> = {}) {
  const onConfirm = vi.fn().mockResolvedValue({ status: 'success' });
  const onExport = vi.fn().mockResolvedValue({ status: 'success' });
  const view = renderWithProviders(
    <BulkDeleteDialog
      open
      onOpenChange={vi.fn()}
      selection={{ mode: 'ids', ids: new Set(['a', 'b']), count: 3402 }}
      filterDescription={null}
      onConfirm={onConfirm}
      onExport={onExport}
      {...props}
    />,
  );
  return { ...view, onConfirm, onExport };
}

describe('BulkDeleteDialog', () => {
  it('má počet v nadpisu i na tlačítku', () => {
    renderDialog();
    expect(screen.getByText(/^Smazat 3\s402 kontaktů\?$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Smazat 3\s402 kontaktů$/ })).toBeInTheDocument();
  });

  it('vyjmenuje čtyři konkrétní následky včetně věty o blokovaných adresách', () => {
    renderDialog();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText(/zůstanou na blokovaných adresách/)).toBeInTheDocument();
  });

  it('nabídne export přímo v dialogu a počká na něj', async () => {
    const user = userEvent.setup();
    const { onExport } = renderDialog();
    await user.click(
      screen.getByRole('button', { name: /^Stáhnout těchto 3\s402 kontaktů jako CSV$/ }),
    );
    expect(onExport).toHaveBeenCalledOnce();
    expect(
      await screen.findByText('Soubor je stažený. Teď můžete kontakty smazat.'),
    ).toBeInTheDocument();
  });

  it('nepoužívá opisování slova, jen jednu zaškrtávací větu', () => {
    renderDialog();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Rozumím, že smazané kontakty nepůjde obnovit')).toBeInTheDocument();
  });

  it('bez zaškrtnutí nemaže a místo zašedlého tlačítka vysvětlí proč', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();
    const confirm = screen.getByRole('button', { name: /^Smazat 3\s402 kontaktů$/ });
    expect(confirm).not.toBeDisabled();
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Ještě jste nezaškrtli potvrzení nad tlačítkem.')).toBeInTheDocument();
  });

  it('po zaškrtnutí smaže', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /^Smazat 3\s402 kontaktů$/ }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('u výběru podle filtru zopakuje filtr slovy', () => {
    renderDialog({
      selection: { mode: 'allMatching', count: 12480 },
      filterDescription: 'seznam Zákazníci, štítek Brno a stav Aktivní',
    });
    expect(screen.getByText(/seznam Zákazníci, štítek Brno a stav Aktivní/)).toBeInTheDocument();
  });

  it('u výběru na stránce žádný filtr nezmiňuje', () => {
    renderDialog();
    expect(screen.queryByText(/Týká se to výběru/)).toBeNull();
  });

  it('výchozí fokus není na destruktivním tlačítku', () => {
    renderDialog();
    expect(document.activeElement).not.toBe(
      screen.getByRole('button', { name: /^Smazat 3\s402 kontaktů$/ }),
    );
  });
});
