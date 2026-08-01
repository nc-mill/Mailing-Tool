// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from '@mlain/ui/patterns/toast';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { Result } from '@/lib/api-client/result';
import { MembersTable, type MemberRow } from './members-table';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const messages = { settings: csSettings };

// ODCHYLKA OD PLÁNU: `useToast` z P05 mimo `ToastProvider` vyhodí výjimku,
// takže pohled potřebuje obal. Popisky jsou testovací, obrazovka si je bere
// z katalogu ve skořápce.
const TOAST_LABELS = {
  undo: 'Vrátit zpět',
  close: 'Zavřít',
  notifications: 'Oznámení',
  countdown: (seconds: number) => `${seconds} s`,
  repeated: (message: string, count: number) => `${message} (${count})`,
};

const ROWS: MemberRow[] = [
  {
    user_id: 'u1',
    email: 'jana@firma.cz',
    name: 'Jana Nováková',
    role: 'owner',
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    user_id: 'u2',
    email: 'petr@firma.cz',
    name: 'Petr Svoboda',
    role: 'editor',
    created_at: '2026-03-01T00:00:00.000Z',
  },
];

function renderTable(
  members: Result<{ data: MemberRow[] }>,
  canManage = true,
  currentUserId = 'u1',
  // `onInvite` chybí právě tehdy, když aktér zvát nesmí. Prázdný stav pak
  // primární akci **neschová**, ale nabídne akci, která funguje, a vysvětlí to.
  //
  // ODCHYLKA OD PLÁNU: plán posílal do parametru s výchozí hodnotou přímo
  // `undefined`, jenže tím se v JavaScriptu výchozí hodnota **použije**,
  // takže by se nikdy netestovala větev bez oprávnění. Rozhoduje proto
  // příznak, ne hodnota.
  canInvite = true,
) {
  const onInvite = canInvite ? vi.fn() : undefined;
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <ToastProvider labels={TOAST_LABELS}>
        <MembersTable
          members={members}
          canManage={canManage}
          currentUserId={currentUserId}
          workspaceId="w1"
          slug="eshop"
          onInvite={onInvite}
          changeRoleAction={vi.fn()}
          removeAction={vi.fn()}
        />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe('MembersTable', () => {
  it('vypíše členy se jménem, e-mailem a rolí', () => {
    const { container } = renderTable({ ok: true, data: { data: ROWS } });
    expect(screen.getByText('Jana Nováková')).toBeInTheDocument();
    expect(screen.getByText('petr@firma.cz')).toBeInTheDocument();
    // ODCHYLKA OD PLÁNU: plán čekal `getByDisplayValue('Editor')`. Výběr role
    // je Radix, tedy `<button>` s popiskem, a jediná hodnota, která dojde na
    // server, sedí ve skrytém poli. Kontroluje se proto obojí, co existuje.
    expect(screen.getByRole('combobox', { name: 'Role člena Petr Svoboda' })).toBeInTheDocument();
    expect(container.querySelector('input[name="role"]')).toHaveValue('editor');
  });

  it('u prázdného seznamu ukáže vysvětlení a primární akci, strukturálně', () => {
    renderTable({ ok: true, data: { data: [] } });
    // Kritérium 76c: kontroluje se struktura, ne doslovné znění. Text se
    // čte z katalogu, takže ho přeformulování neshodí.
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'first');
    expect(within(empty).getByTestId('empty-explanation')).toHaveTextContent(
      csSettings.members.empty,
    );
    expect(
      within(empty).getByRole('button', { name: csSettings.members.emptyAction }),
    ).toBeInTheDocument();
  });

  it('bez oprávnění zvát akci neschová, ale nahradí ji funkční akcí a vysvětlením', () => {
    renderTable({ ok: true, data: { data: [] } }, false, 'u1', false);
    const empty = screen.getByTestId('empty-state');
    expect(
      within(empty).getByRole('button', { name: csSettings.shared.backToOverview }),
    ).toBeInTheDocument();
    expect(within(empty).getByText(csSettings.members.emptyNoPermission)).toBeInTheDocument();
  });

  it('u chyby ukáže blok s request_id a tlačítkem Zkusit znovu', async () => {
    renderTable({
      ok: false,
      problem: {
        type: '',
        title: 'Dependency timeout',
        status: 504,
        detail: '',
        instance: '/api/v1/members',
        code: 'dependency_timeout',
        request_id: 'req_11',
      },
    });
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
    // Číslo požadavku bydlí ve sbalených technických detailech, které
    // `ErrorBlock` z P05 zavřené vůbec nevykresluje. Test je proto rozbalí,
    // stejně jako to udělá člověk, který číslo hledá.
    await userEvent.click(screen.getByText('Technické detaily'));
    expect(screen.getByText('req_11')).toBeInTheDocument();
  });

  it('bez oprávnění správy ukáže roli jako text, ne jako výběr', () => {
    renderTable({ ok: true, data: { data: ROWS } }, false);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Editor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Odebrat/ })).not.toBeInTheDocument();
  });

  it('u sebe sama nenabídne odebrání ani změnu role', () => {
    renderTable({ ok: true, data: { data: ROWS } }, true, 'u1');
    expect(screen.getAllByRole('button', { name: 'Odebrat z projektu' })).toHaveLength(1);
  });

  it('odebrání otevře dialog N2 se jménem a s větou o nové pozvánce', async () => {
    renderTable({ ok: true, data: { data: ROWS } });
    await userEvent.click(screen.getByRole('button', { name: 'Odebrat z projektu' }));
    expect(
      screen.getByRole('heading', { name: 'Odebrat Petr Svoboda z projektu?' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/jen novou pozvánkou/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nechat v projektu' })).toBeInTheDocument();
  });

  it('popisuje, co která role smí', () => {
    renderTable({ ok: true, data: { data: ROWS } });
    expect(screen.getByText(/Tvoří kontakty, šablony a kampaně/)).toBeInTheDocument();
  });

  it('výběr role má přístupné jméno se jménem člena', () => {
    renderTable({ ok: true, data: { data: ROWS } });
    expect(screen.getByRole('combobox', { name: 'Role člena Petr Svoboda' })).toBeInTheDocument();
  });
});
