import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from './dialog';

function Harness({ destructive = false }: { destructive?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Otevřít
      </Button>
      <Dialog open={open} onOpenChange={setOpen} destructive={destructive}>
        <DialogTitle>Smazat 12 kontaktů?</DialogTitle>
        <DialogBody>Kontakty zmizí ze všech seznamů a segmentů.</DialogBody>
        <DialogFooter
          retreat={
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Nemazat
            </Button>
          }
          confirm={<Button variant="destructive">Smazat 12 kontaktů</Button>}
        />
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('má aria-modal a popisek z nadpisu', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Otevřít' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Smazat 12 kontaktů?');
  });

  it('výchozí fokus je na tlačítku ústupu, ne na destruktivním', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Otevřít' }));
    expect(screen.getByRole('button', { name: 'Nemazat' })).toHaveFocus();
  });

  it('Esc zavře dialog a fokus se vrátí na spouštěč', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Otevřít' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('u destruktivního dialogu kliknutí mimo nezavírá', async () => {
    // Radix nad otevřeným modálem nastaví body pointer-events: none. Kontrolu
    // v user-event vypínáme, jinak by se kliknutí mimo vůbec nedalo poslat.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<Harness destructive />);
    await user.click(screen.getByRole('button', { name: 'Otevřít' }));
    await user.click(document.body);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('ústup je vlevo a potvrzení vpravo, v celé aplikaci stejně', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Otevřít' }));
    const buttons = screen.getAllByRole('button', { name: /Nemazat|Smazat 12 kontaktů/ });
    expect(buttons[0]).toHaveAccessibleName('Nemazat');
    expect(buttons[1]).toHaveAccessibleName('Smazat 12 kontaktů');
  });
});
