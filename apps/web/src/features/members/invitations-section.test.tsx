// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { Result } from '@/lib/api-client/result';
import { InvitationsSectionView, type InvitationRow } from './invitations-section';

// Moduly akcí se dotýkají `server-only` a cookies, které v jsdom nejsou.
// Pohled si obě akce bere propem, takže stačí prázdné náhrady.
vi.mock('./actions', () => ({
  inviteMemberAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
  changeMemberRoleAction: vi.fn(),
  removeMemberAction: vi.fn(),
}));
vi.mock('./actions-forms', () => ({
  changeMemberRoleFormAction: vi.fn(),
  removeMemberFormAction: vi.fn(),
  revokeInvitationFormAction: vi.fn(),
}));

const messages = { settings: csSettings };

const ROWS: InvitationRow[] = [
  {
    id: 'i1',
    email: 'novy@firma.cz',
    role: 'editor',
    invited_by_name: 'Jana Nováková',
    expires_at: '2026-08-07T10:00:00.000Z',
    created_at: '2026-07-31T10:00:00.000Z',
  },
];

function renderSection(invitations: Result<{ data: InvitationRow[] }>) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <InvitationsSectionView
        invitations={invitations}
        workspaceId="ws1"
        slug="eshop"
        inviteAction={vi.fn()}
        revokeAction={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

function manyInvitations(count: number): InvitationRow[] {
  return Array.from({ length: count }, (_value, index) => ({
    ...ROWS[0]!,
    id: `i${index}`,
    email: `clovek${index}@firma.cz`,
  }));
}

describe('InvitationsSectionView', () => {
  it('vypíše čekající pozvánky s e-mailem, rolí a platností', () => {
    renderSection({ ok: true, data: { data: ROWS } });
    // ODCHYLKA OD PLÁNU, jen zápisem: slovo „Editor" je i ve výběru role
    // ve formuláři pozvání pod tabulkou (Radix vykresluje skrytý nativní
    // `<select>` se všemi volbami), takže se hledá uvnitř tabulky.
    const table = within(screen.getByRole('table'));
    expect(table.getByText('novy@firma.cz')).toBeInTheDocument();
    expect(table.getByText('Editor')).toBeInTheDocument();
    expect(table.getByText('Jana Nováková')).toBeInTheDocument();
  });

  it('u prázdného seznamu ukáže vysvětlení a akci, ne prázdnou tabulku', () => {
    renderSection({ ok: true, data: { data: [] } });
    const empty = screen.getByTestId('empty-state');
    expect(within(empty).getByTestId('empty-explanation')).toHaveTextContent(
      csSettings.members.invitations.empty,
    );
    expect(within(empty).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('formulář pozvání má e-mail, roli a vysvětlení sedmidenní platnosti', () => {
    renderSection({ ok: true, data: { data: ROWS } });
    expect(screen.getByLabelText('E-mail kolegy')).toBeInTheDocument();
    expect(screen.getByLabelText('Role')).toBeInTheDocument();
    expect(screen.getByText(/platí 7 dní/)).toBeInTheDocument();
  });

  it('u stovky pozvánek ukáže stav přes limit a formulář schová', () => {
    renderSection({ ok: true, data: { data: manyInvitations(100) } });
    expect(screen.getByText('Víc pozvánek naráz poslat nejde')).toBeInTheDocument();
    expect(screen.getByText(/100 pozvánek, což je maximum/)).toBeInTheDocument();
    expect(screen.queryByLabelText('E-mail kolegy')).not.toBeInTheDocument();
  });

  it('u devadesáti devíti pozvánek formulář zůstává', () => {
    renderSection({ ok: true, data: { data: manyInvitations(99) } });
    expect(screen.getByLabelText('E-mail kolegy')).toBeInTheDocument();
  });

  it('u chyby ukáže blok s request_id', async () => {
    renderSection({
      ok: false,
      problem: {
        type: '',
        title: 'Forbidden',
        status: 403,
        detail: '',
        instance: '/api/v1/invitations',
        code: 'forbidden',
        request_id: 'req_21',
      },
    });
    // Číslo požadavku je ve sbalených technických detailech, viz `ErrorBlock`.
    await userEvent.click(screen.getByText('Technické detaily'));
    expect(screen.getByText('req_21')).toBeInTheDocument();
  });

  it('u již existujícího člena ukáže hlášku, která radí změnit roli', () => {
    render(
      <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
        <InvitationsSectionView
          invitations={{ ok: true, data: { data: [] } }}
          workspaceId="ws1"
          slug="eshop"
          inviteAction={vi.fn()}
          revokeAction={vi.fn()}
          initialState={{
            status: 'error',
            channel: 'inlineBlock',
            problem: {
              type: '',
              title: 'Already member',
              status: 409,
              detail: '',
              instance: '/api/v1/invitations',
              code: 'already_member',
              request_id: 'req_22',
            },
            fieldErrors: {},
          }}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Tenhle člověk už v projektu je')).toBeInTheDocument();
    expect(screen.getByText(/změnit přímo v seznamu členů/)).toBeInTheDocument();
  });

  it('zrušení pozvánky nabízí Pozvat znovu, ne Vrátit zpět', async () => {
    renderSection({ ok: true, data: { data: ROWS } });
    expect(screen.getByRole('button', { name: 'Zrušit pozvánku' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zrušit pozvánku' }));
    expect(screen.queryByRole('button', { name: 'Vrátit zpět' })).not.toBeInTheDocument();
  });
});
