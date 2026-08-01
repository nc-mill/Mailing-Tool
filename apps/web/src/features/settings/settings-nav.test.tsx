// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csCommon from '../../../../../packages/i18n/messages/cs/common.json';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { SettingsNav } from './settings-nav';

vi.mock('next/navigation', () => ({ usePathname: () => '/w/eshop/settings/members' }));

// Popisky navigace leží v `common`, protože registr vlastní P05 a nezná,
// kdo ho vykreslí. Test proto potřebuje oba katalogy.
const messages = { common: csCommon, settings: csSettings };

function renderNav(permissions: string[]) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <SettingsNav workspaceSlug="eshop" permissions={permissions} />
    </NextIntlClientProvider>,
  );
}

/**
 * Oprávnění jsou ta, která u položek skutečně stojí v registru P05,
 * ne ta, která by se dala odhadnout z názvu obrazovky. Rozdíl je u dvou:
 * `settings-general` chce `workspace:update` (ne `workspace:read`)
 * a `settings-members` chce `members:invite` (ne `members:read`).
 */
const OWNER = [
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'members:read',
  'members:invite',
  'api_keys:read',
  'webhooks:read',
  'audit:read',
];

describe('SettingsNav', () => {
  it('vlastníkovi ukáže všech šest položek MVP 0', () => {
    renderNav(OWNER);
    for (const label of ['Projekt', 'Tým', 'Klíče k API', 'Webhooky', 'Audit log', 'Můj účet']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('prohlížejícímu nechá jen Můj účet, protože ostatní položky mají oprávnění', () => {
    renderNav(['workspace:read']);
    // Můj účet je v registru bez oprávnění: je to vlastní profil uživatele.
    expect(screen.getByRole('link', { name: 'Můj účet' })).toBeInTheDocument();
    for (const label of ['Projekt', 'Tým', 'Klíče k API', 'Webhooky', 'Audit log']) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
    }
  });

  it('editorovi ukáže webhooky, ale ne klíče a audit', () => {
    renderNav(['workspace:read', 'webhooks:read']);
    expect(screen.getByRole('link', { name: 'Webhooky' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Klíče k API' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });

  it('nezobrazuje položky mimo MVP 0', () => {
    renderNav(OWNER);
    expect(screen.queryByRole('link', { name: 'Odesílání' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Zálohy' })).not.toBeInTheDocument();
  });

  it('aktuální položku označí přes aria-current', () => {
    renderNav(OWNER);
    expect(screen.getByRole('link', { name: 'Tým' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Projekt' })).not.toHaveAttribute('aria-current');
  });

  it('odkazy nesou slug projektu a staví je visibleNavigation, ne tenhle soubor', () => {
    renderNav(OWNER);
    expect(screen.getByRole('link', { name: 'Klíče k API' })).toHaveAttribute(
      'href',
      '/w/eshop/settings/api-keys',
    );
  });

  it('navigace má přístupné jméno', () => {
    renderNav(OWNER);
    expect(screen.getByRole('navigation', { name: 'Nastavení' })).toBeInTheDocument();
  });
});
