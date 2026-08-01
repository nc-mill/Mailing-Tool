// Matchery jest-dom se typují modulovou augmentací. Registruje je
// `apps/web/vitest.setup.ts`, jenže ten soubor vlastní P01 a v `tsconfig.json`
// není v `include`, takže `tsc` augmentaci nevidí. Import tady je typová
// oprava bez dopadu na chování: modul se stejně načítá v setupu.
import '@testing-library/jest-dom/vitest';

import type * as ReactDom from 'react-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const useFormStatus = vi.fn(() => ({ pending: false }));
vi.mock('react-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactDom>()),
  useFormStatus: () => useFormStatus(),
}));

const { SubmitButton } = await import('./submit-button');

describe('SubmitButton', () => {
  it('ukáže popisek a nemá atribut disabled', () => {
    render(<SubmitButton label="Přihlásit se" pendingLabel="Přihlašujeme vás" />);
    const button = screen.getByRole('button', { name: 'Přihlásit se' });
    expect(button).not.toHaveAttribute('disabled');
    // ODCHYLKA OD PLÁNU, vynucená chováním `Button` z P05: ten `aria-busy`
    // v klidovém stavu vůbec nevykresluje, místo `aria-busy="false"`. Je to
    // vědomé rozhodnutí designového systému a P06 do něj nesahá. Tvrzení
    // proto zní „atribut tam není", ne „atribut je false"; měří se totéž.
    expect(button).not.toHaveAttribute('aria-busy');
  });

  it('při odesílání změní text a nastaví aria-busy, ale zůstane klikatelné', () => {
    useFormStatus.mockReturnValue({ pending: true });
    render(<SubmitButton label="Přihlásit se" pendingLabel="Přihlašujeme vás" />);
    const button = screen.getByRole('button', { name: 'Přihlašujeme vás' });
    expect(button).not.toHaveAttribute('disabled');
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});
