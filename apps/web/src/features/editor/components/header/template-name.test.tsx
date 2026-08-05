// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csEditor from '@mlain/i18n/messages/cs/editor.json';
import { TemplateName, type RenameResult } from './template-name';

/**
 * Název šablony v hlavičce editoru.
 *
 * Vada, kvůli které tenhle soubor vznikl: název šablony nešlo změnit NIKDE.
 * Server pole `name` v `PATCH /templates/{id}` sice měl ve schématu, jenže
 * handler ho zahazoval a `design` navíc vyžadoval, takže v knihovně zůstávala
 * jména jako „E-mail z formuláře test", u kterých nikdo nepozná, k čemu patří.
 */
const ok = (): Promise<RenameResult> => Promise.resolve({ ok: true });

function renderName(
  onRename: (name: string) => Promise<RenameResult> = vi.fn(ok),
  props: { name?: string; readOnly?: boolean } = {},
) {
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: csEditor }} timeZone="Europe/Prague">
      <TemplateName
        name={props.name ?? 'Původní název'}
        onRename={onRename}
        readOnly={props.readOnly ?? false}
      />
    </NextIntlClientProvider>,
  );
  return screen.queryByRole('textbox', { name: 'Název šablony' });
}

describe('název šablony v hlavičce', () => {
  it('ukazuje současný název v poli, ne jako nadpis k proklikání', () => {
    const field = renderName();
    expect(field).toHaveValue('Původní název');
  });

  it('uloží nový název při odchodu z pole', async () => {
    const onRename = vi.fn(ok);
    const field = renderName(onRename)!;

    await userEvent.clear(field);
    await userEvent.type(field, 'Děkujeme za zprávu');
    await userEvent.tab();

    expect(onRename).toHaveBeenCalledWith('Děkujeme za zprávu');
    expect(screen.queryByTestId('template-name-error')).not.toBeInTheDocument();
  });

  it('Enter uloží taky, protože po dopsání nikdo nehledá tlačítko', async () => {
    const onRename = vi.fn(ok);
    const field = renderName(onRename)!;

    await userEvent.clear(field);
    await userEvent.type(field, 'Jiný název{Enter}');

    expect(onRename).toHaveBeenCalledWith('Jiný název');
  });

  it('Escape vrátí poslední uložený název a nic neukládá', async () => {
    const onRename = vi.fn(ok);
    const field = renderName(onRename)!;

    await userEvent.clear(field);
    await userEvent.type(field, 'Rozepsaný překlep{Escape}');

    expect(field).toHaveValue('Původní název');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('beze změny se na server nechodí, aby název nevyskočil na začátek knihovny', async () => {
    const onRename = vi.fn(ok);
    const field = renderName(onRename)!;

    await userEvent.click(field);
    await userEvent.tab();

    expect(onRename).not.toHaveBeenCalled();
  });

  it('mezery navíc se uklidí a neplatí za změnu', async () => {
    const onRename = vi.fn(ok);
    const field = renderName(onRename)!;

    await userEvent.type(field, '   ');
    await userEvent.tab();

    expect(onRename).not.toHaveBeenCalled();
    expect(field).toHaveValue('Původní název');
  });

  it('prázdný název ohlásí u pole a na server ho neposílá', async () => {
    const onRename = vi.fn(ok);
    const field = renderName(onRename)!;

    await userEvent.clear(field);
    await userEvent.tab();

    expect(screen.getByTestId('template-name-error')).toHaveTextContent('Název nesmí být prázdný.');
    expect(onRename).not.toHaveBeenCalled();
    expect(field).toBeInvalid();
  });

  it('delší název než 120 znaků ohlásí u pole, netiše nezkrátí', async () => {
    const onRename = vi.fn(ok);
    const field = renderName(onRename)!;

    await userEvent.clear(field);
    // `paste` místo psaní: 121 znaků po jednom je zbytečně pomalé.
    await userEvent.click(field);
    await userEvent.paste('x'.repeat(121));
    await userEvent.tab();

    expect(screen.getByTestId('template-name-error')).toHaveTextContent(
      'Název může mít nejvýš 120 znaků.',
    );
    expect(onRename).not.toHaveBeenCalled();
    // Zkrácení by uživatel objevil až z e-mailu s useknutým předmětem.
    expect(field).toHaveValue('x'.repeat(121));
  });

  it('zabrané jméno vysvětlí, co s tím, a nechá napsanou hodnotu v poli', async () => {
    const onRename = vi.fn((): Promise<RenameResult> =>
      Promise.resolve({ ok: false, code: 'template_name_conflict' }),
    );
    const field = renderName(onRename)!;

    await userEvent.clear(field);
    await userEvent.type(field, 'Zabrané{Enter}');

    expect(screen.getByTestId('template-name-error')).toHaveTextContent(
      /už v projektu je. Zvolte jiný/,
    );
    expect(field).toHaveValue('Zabrané');
  });

  it('jiná chyba serveru nese technický detail, ať jde nahlásit', async () => {
    const onRename = vi.fn((): Promise<RenameResult> =>
      Promise.resolve({ ok: false, code: 'service_unavailable' }),
    );
    const field = renderName(onRename)!;

    await userEvent.clear(field);
    await userEvent.type(field, 'Cokoli{Enter}');

    expect(screen.getByTestId('template-name-error')).toHaveTextContent('service_unavailable');
  });

  it('bez práva na zápis je název jen k přečtení', () => {
    const field = renderName(vi.fn(ok), { readOnly: true });

    expect(field).not.toBeInTheDocument();
    expect(screen.getByTestId('template-name-readonly')).toHaveTextContent('Původní název');
  });
});
