// Matchery jest-dom se typují modulovou augmentací. Registruje je
// `apps/web/vitest.setup.ts`, jenže ten soubor vlastní P01 a v `tsconfig.json`
// není v `include`, takže `tsc` augmentaci nevidí. Import tady je typová
// oprava bez dopadu na chování: modul se stejně načítá v setupu.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SelectField } from './select-field';

const OPTIONS = [
  { value: 'cs', label: 'Čeština' },
  { value: 'en', label: 'English' },
];

describe('SelectField', () => {
  it('nese hodnotu ve skrytém poli, aby se dostala do FormData', () => {
    const { container } = render(
      <SelectField
        name="locale"
        label="Jazyk rozhraní"
        options={OPTIONS}
        defaultValue="cs"
        placeholder="Vyberte"
      />,
    );
    // Tohle je jediná cesta, kterou se hodnota dostane na server.
    // Radix do formuláře sám nic nevkládá.
    expect(container.querySelector('input[name="locale"]')).toHaveValue('cs');
  });

  it('spouštěč má přístupné jméno, takže na něj míří i getByLabelText', () => {
    render(
      <SelectField
        name="locale"
        label="Jazyk rozhraní"
        options={OPTIONS}
        defaultValue="cs"
        placeholder="Vyberte"
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Jazyk rozhraní' })).toBeInTheDocument();
    expect(screen.getByLabelText('Jazyk rozhraní')).toBeInTheDocument();
  });

  it('spouštěč nemá disabled ani v prázdném stavu', () => {
    render(<SelectField name="role" label="Role" options={OPTIONS} placeholder="Vyberte roli" />);
    expect(screen.getByRole('combobox', { name: 'Role' })).not.toHaveAttribute('disabled');
  });
});
