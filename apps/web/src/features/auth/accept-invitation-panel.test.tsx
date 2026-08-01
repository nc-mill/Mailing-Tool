// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csAuth from '../../../../../packages/i18n/messages/cs/auth.json';
import { AcceptInvitationPanel, type InvitationView } from './accept-invitation-panel';

const messages = { auth: csAuth };

function renderPanel(view: InvitationView) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <AcceptInvitationPanel view={view} action={vi.fn()} token="TOKEN" />
    </NextIntlClientProvider>,
  );
}

describe('AcceptInvitationPanel', () => {
  it('u chybějícího tokenu ukáže neplatnou pozvánku', () => {
    renderPanel({ kind: 'invalid' });
    expect(screen.getByText('Pozvánka už neplatí')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Přejít na přihlášení' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('nepřihlášeného pošle na přihlášení s návratem zpět', () => {
    renderPanel({ kind: 'signedOut' });
    const link = screen.getByRole('link', { name: 'Přihlásit se a přijmout' });
    expect(link).toHaveAttribute('href', '/login?next=%2Finvitations%2Faccept%3Ftoken%3DTOKEN');
  });

  it('přihlášenému ukáže projekt, roli a tlačítko přijmout', () => {
    renderPanel({
      kind: 'signedIn',
      email: 'jana@firma.cz',
      workspaceName: 'E-shop Kolo',
      roleLabel: 'Editor',
    });
    expect(
      screen.getByRole('heading', { name: 'Pozvánka do projektu E-shop Kolo' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/roli Editor/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Přijmout pozvánku' })).not.toHaveAttribute(
      'disabled',
    );
  });

  it('u odlišné adresy upozorní, že se do auditu zapíšou obě', () => {
    renderPanel({
      kind: 'signedIn',
      email: 'jana@firma.cz',
      invitedEmail: 'jana.novakova@firma.cz',
      workspaceName: 'E-shop Kolo',
      roleLabel: 'Editor',
    });
    expect(screen.getByText(/poznamenáme obě adresy/)).toBeInTheDocument();
  });

  it('u shodné adresy poznámku neukáže', () => {
    renderPanel({
      kind: 'signedIn',
      email: 'jana@firma.cz',
      invitedEmail: 'jana@firma.cz',
      workspaceName: 'E-shop Kolo',
      roleLabel: 'Editor',
    });
    expect(screen.queryByText(/poznamenáme obě adresy/)).not.toBeInTheDocument();
  });

  it('nese token ve skrytém poli', () => {
    const { container } = renderPanel({
      kind: 'signedIn',
      email: 'jana@firma.cz',
      workspaceName: 'E-shop Kolo',
      roleLabel: 'Editor',
    });
    expect(container.querySelector('input[name="token"]')).toHaveValue('TOKEN');
  });
});
