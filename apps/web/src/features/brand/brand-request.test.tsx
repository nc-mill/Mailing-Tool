import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import csAi from '@mlain/i18n/messages/cs/ai.json';
import csEditor from '@mlain/i18n/messages/cs/editor.json';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { BrandSettingsClient } from './brand-settings-client';
import type { BrandFormValues } from './brand-form';

// Obrazovka po doběhnutí extrakce volá `router.refresh()`, aby se formulář
// přenačetl se staženými hodnotami. Mimo router Nextu je `useRouter` výjimka.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

const initial: BrandFormValues = {
  name: 'Kolo shop',
  primary: '#2563eb',
  secondary: '#3b82f6',
  accent: '#1d4ed8',
  background: '#f4f5f7',
  text: '#111827',
  headingStack: 'system',
  bodyStack: 'system',
  radius: 4,
  logo: null,
};

const noopAction = async (): Promise<ActionState> => IDLE;

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider
      locale="cs"
      messages={{ ai: csAi, editor: csEditor }}
      timeZone="Europe/Prague"
    >
      {ui}
    </NextIntlClientProvider>,
  );

function renderScreen() {
  return wrap(
    <BrandSettingsClient
      workspaceId={WORKSPACE_ID}
      workspaceSlug="kolo-shop"
      history={[]}
      initial={initial}
      saveAction={noopAction}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Regrese na vadu ze 4. 8. 2026: `POST /api/v1/brand/extractions` končilo 404.
 *
 * Test tvrdí o ODESLANÉM POŽADAVKU, ne o návratové hodnotě, a je to podstatné:
 * podvržený server vrátí 202 na cokoliv, takže test postavený na výsledku
 * projde i nad tvarem, který by v provozu spadl. Autentizační middleware bere
 * projekt z hlavičky `X-Workspace-Id`; bez ní se požadavek k obsluze vůbec
 * nedostane a skončí 404 s `workspace_id: null` v logu.
 *
 * Vzor je `apps/web/src/features/contacts/actions.test.ts`.
 */
describe('žádost o stažení značky nese projekt', () => {
  it('posílá X-Workspace-Id a míří na /api/v1/brand/extractions', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ id: '22222222-2222-4222-8222-222222222222' }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    renderScreen();
    await userEvent.type(screen.getByPlaceholderText('https://kolo-shop.cz'), 'https://kolo.cz');
    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout' }));

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    const request = calls[0]!;
    expect(request.url).toBe('/api/v1/brand/extractions');
    expect(request.init?.method).toBe('POST');

    const headers = new Headers(request.init?.headers);
    expect(headers.get('x-workspace-id')).toBe(WORKSPACE_ID);
  });

  /**
   * Druhá půlka téže vady: obrazovka na 404 z NAŠEHO serveru hlásila
   * „Na adresu … jsme se nedostali. Zkontrolujte, jestli tam není překlep,
   * a jestli web funguje." Zadavatel podle toho hledal chybu na svém webu,
   * který celou dobu vracel 200.
   */
  it('chyba naší strany se nevydává za nedostupný web', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'not_found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    renderScreen();
    await userEvent.type(screen.getByPlaceholderText('https://kolo-shop.cz'), 'https://kolo.cz');
    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/404/);
    expect(alert).toHaveTextContent(/u nás/);
    expect(alert.textContent ?? '').not.toMatch(/překlep/);
  });

  it('doménový kód značky se pořád překládá na svou hlášku', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'brand_blocked_address' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    renderScreen();
    await userEvent.type(screen.getByPlaceholderText('https://kolo-shop.cz'), 'http://10.0.0.1/');
    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Tuhle adresu stahovat neumíme/);
  });
});
