import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('primární tlačítko nikdy nemá atribut disabled', () => {
    render(
      <Button variant="primary" unavailableReason="K odeslání je potřeba oprávnění campaigns:send.">
        Odeslat 1 129 e-mailů
      </Button>,
    );
    const button = screen.getByRole('button', { name: /Odeslat 1 129 e-mailů/ });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-describedby');
  });

  it('nedostupné tlačítko neprovede akci, ale vysvětlí důvod', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onUnavailable = vi.fn();
    render(
      <Button
        variant="primary"
        unavailableReason="Nejdřív potvrďte, že rozumíte následkům."
        onUnavailable={onUnavailable}
        onClick={onClick}
      >
        Smazat 3 402 kontaktů
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Nejdřív potvrďte, že rozumíte následkům.')).toBeVisible();
  });

  it('čekající tlačítko zůstává čitelné, hlásí aria-busy a nespustí akci podruhé', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button variant="primary" pending pendingLabel="Ukládáme…" onClick={onClick}>
        Uložit
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('Ukládáme…');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('sekundární tlačítko disabled mít smí', () => {
    render(
      <Button variant="secondary" disabled>
        Předchozí
      </Button>,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('destruktivní varianta je barevně odlišená a nese sloveso s číslem', () => {
    render(<Button variant="destructive">Smazat 12 kontaktů</Button>);
    const button = screen.getByRole('button', { name: 'Smazat 12 kontaktů' });
    expect(button.className).toContain('bg-danger');
  });

  // Akce, která musí zůstat odkazem: prostřední tlačítko myši ani Cmd+klik
  // na `<button>` nefungují, takže „otevřít na novém panelu" nejde.
  it('asChild předá vzhled odkazu a žádné tlačítko nevykreslí', () => {
    render(
      <Button asChild variant="primary">
        <a href="/w/test/forms/new">Nový formulář</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Nový formulář' });
    expect(link).toHaveAttribute('href', '/w/test/forms/new');
    expect(link.className).toContain('bg-primary');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // Regrese: `cva` skládá varianty před velikostmi, takže výchozí `size: 'md'`
  // přebíjelo to, co si `variant: 'link'` nastavil, a odkaz v textu dostal
  // výšku 44 px i vodorovný okraj 20 px. Opraveno compound variantou.
  it('odkazové tlačítko nemá rozměry tlačítka', () => {
    render(<Button variant="link">Zobrazit report</Button>);
    const className = screen.getByRole('button').className;
    expect(className).toContain('min-h-0');
    expect(className).toContain('px-0');
    expect(className).not.toContain('min-h-[var(--size-target-min)]');
  });

  // Výška se bere z tokenu `--size-target-min`, ne z čísla ve třídě. Test
  // hlídá právě to: kdyby někdo napsal `min-h-11`, vypadalo by to dnes stejně,
  // ale změna minimální cílové plochy v tokenech by tenhle prvek minula.
  it('respektuje minimální cílovou plochu z tokenu', () => {
    render(<Button variant="primary">Uložit</Button>);
    expect(screen.getByRole('button').className).toContain('min-h-[var(--size-target-min)]');
  });
});
