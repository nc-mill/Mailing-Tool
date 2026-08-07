import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from './command';

// `cmdk` si při připojení sahá na `ResizeObserver` a odroluje vybranou položku
// do zorného pole. Ani jedno jsdom nemá, takže bez těchhle atrap spadne
// vykreslení a test by o atributech pole neřekl nic.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

function Harness() {
  return (
    <Command label="Hledat">
      <CommandInput placeholder="Hledat pole" />
      <CommandList>
        <CommandGroup heading="Kontakt">
          <CommandItem value="Křestní jméno" onSelect={() => {}}>
            Křestní jméno
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

describe('CommandInput', () => {
  // Vada z provozu: nad vyhledávacím polem paletky vysunul Bitwarden nabídku
  // uložených přihlášení, zakryla první položky seznamu a nešla zavřít. Značky
  // níž jsou jediné, co správcům hesel řekne, ať sem nelezou. Kdyby je někdo
  // smazal jako zbytečné, vada se vrátí a nikdo si jí v testech nevšimne.
  it('nese značky, kterými správci hesel vypínají nabídku', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('Hledat pole');
    expect(input).toHaveAttribute('data-1p-ignore', 'true');
    expect(input).toHaveAttribute('data-op-ignore', 'true');
    expect(input).toHaveAttribute('data-lpignore', 'true');
    expect(input).toHaveAttribute('data-bwignore', 'true');
    expect(input).toHaveAttribute('data-form-type', 'other');
    expect(input).toHaveAttribute('data-protonpass-ignore', 'true');
  });

  it('zůstává obyčejné textové pole bez doplňování prohlížeče', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('Hledat pole');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('autocomplete', 'off');
    // Bez `name` nemá správce hesel podle čeho pole spárovat s uloženou položkou.
    expect(input).not.toHaveAttribute('name');
  });
});
