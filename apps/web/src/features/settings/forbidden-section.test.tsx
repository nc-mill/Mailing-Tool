// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { ForbiddenSection } from './forbidden-section';

vi.mock('next-intl/server', () => ({
  getTranslations: async () => {
    const { createTranslator } = await import('next-intl');
    return createTranslator({
      locale: 'cs',
      messages: { settings: csSettings },
      namespace: 'settings',
    });
  },
}));

describe('ForbiddenSection', () => {
  it('pojmenuje chybějící oprávnění, role, které ho mají, a roli uživatele', async () => {
    render(
      await ForbiddenSection({
        permission: 'audit:read',
        currentRole: 'viewer',
        workspaceSlug: 'eshop',
      }),
    );
    expect(screen.getByText(/audit:read/)).toBeInTheDocument();
    expect(screen.getByText(/Správce, Vlastník/)).toBeInTheDocument();
    expect(screen.getByText(/Prohlížející/)).toBeInTheDocument();
  });

  it('bez jmen ze serveru odkáže na roli, ne na osobu', async () => {
    render(
      await ForbiddenSection({
        permission: 'api_keys:read',
        currentRole: 'editor',
        workspaceSlug: 'eshop',
      }),
    );
    expect(
      screen.getByText('Roli vám může změnit vlastník nebo správce projektu.'),
    ).toBeInTheDocument();
  });

  it('se jmény ze serveru odkáže na konkrétního člověka', async () => {
    render(
      await ForbiddenSection({
        permission: 'api_keys:read',
        currentRole: 'editor',
        workspaceSlug: 'eshop',
        problem: {
          type: '',
          title: 'Forbidden',
          status: 403,
          detail: '',
          instance: '/api/v1/api-keys',
          code: 'forbidden',
          request_id: 'req_1',
          params: { contactableMembers: [{ name: 'Petr Svoboda' }] },
        },
      }),
    );
    expect(screen.getByText('Roli vám může změnit Petr Svoboda.')).toBeInTheDocument();
  });

  it('nabídne cestu zpět a drží kód v data-error-code', async () => {
    const { container } = render(
      await ForbiddenSection({
        permission: 'audit:read',
        currentRole: 'viewer',
        workspaceSlug: 'eshop',
      }),
    );
    expect(screen.getByRole('link', { name: 'Zpět na přehled projektu' })).toHaveAttribute(
      'href',
      '/w/eshop',
    );
    expect(container.querySelector('[data-error-code="forbidden"]')).not.toBeNull();
  });

  it('uvnitř obrazovky neschovává nic, jen vysvětluje', async () => {
    render(
      await ForbiddenSection({
        permission: 'audit:read',
        currentRole: 'viewer',
        workspaceSlug: 'eshop',
      }),
    );
    // ODCHYLKA OD PLÁNU: plán čekal `getByRole('alert')`. `ForbiddenState`
    // z P05 roli `alert` nemá a mít nemá: stav S11 je celá obrazovka, ne
    // krátká hláška, a `alert` by čtečce přerušil čtení celým odstavcem.
    // Kontroluje se proto prvek, který komponenta skutečně vykresluje.
    expect(screen.getByTestId('forbidden-state')).toBeInTheDocument();
  });
});
