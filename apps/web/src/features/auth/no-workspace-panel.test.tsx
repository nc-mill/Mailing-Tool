// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csAuth from '../../../../../packages/i18n/messages/cs/auth.json';
import { NoWorkspacePanel } from './no-workspace-panel';

// Server Action pro odhlášení sahá na `server-only` a na cookies, což jsou
// věci, které v jsdom neexistují. Panel z ní potřebuje jen referenci, kterou
// předá formuláři, takže se modul nahradí prázdnou funkcí.
vi.mock('@/features/profile/actions', () => ({ logoutAction: vi.fn() }));

const messages = { auth: csAuth };

function renderPanel(canCreate = true) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <NoWorkspacePanel action={vi.fn()} canCreate={canCreate} />
    </NextIntlClientProvider>,
  );
}

describe('NoWorkspacePanel', () => {
  it('použije doslovný text z 5.3 části 1', () => {
    renderPanel();
    expect(
      screen.getByText(
        'Nemáte přístup k žádnému projektu. Požádejte o pozvánku, nebo si založte vlastní.',
      ),
    ).toBeInTheDocument();
  });

  it('nabídne založení projektu jako primární akci', () => {
    renderPanel();
    expect(screen.getByLabelText('Název projektu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Založit projekt' })).not.toHaveAttribute('disabled');
  });

  it('když instalace zakládání nepovoluje, formulář nevykreslí a nabídne kontrolu znovu', () => {
    renderPanel(false);
    expect(screen.queryByLabelText('Název projektu')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zkontrolovat znovu' })).toHaveAttribute(
      'href',
      '/no-workspace',
    );
  });

  it('nabídne odhlášení', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Odhlásit se' })).toBeInTheDocument();
  });

  it('nese skryté pole s klíčem idempotence', () => {
    const { container } = renderPanel();
    expect(container.querySelector('input[name="_idempotency_key"]')).not.toBeNull();
  });
});
