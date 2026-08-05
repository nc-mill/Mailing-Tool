import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import csAi from '@mlain/i18n/messages/cs/ai.json';
import { AssistantPanelView, ERROR_KEYS } from './assistant-panel';

/**
 * TESTY CELÉ CESTY OD PANELU K ROUTĚ, ne komponenty s ručně dodanými propsy.
 *
 * Vada, kvůli které tenhle soubor vznikl, byla přesně mezi nimi: panel odesílal
 * požadavek bez hlavičky `X-Workspace-Id`, `authenticate()` ho na
 * `/api/internal/**` odmítl s 404 (cesta nemá segment `/w/{slug}`, ze kterého
 * by šlo projekt odvodit) a klient si kód `not_found` přeložil na „Služba
 * OpenAI má výpadek". Klíč i model přitom fungovaly.
 *
 * Testy s ručně dodaným `chat` objektem tuhle třídu vady odhalit NEMOHOU:
 * nikdy nespustí `fetch` a nikdy neuvidí odpověď serveru. Proto se tady
 * `useAiChat` nemockuje, mockuje se až `fetch`.
 */

const replaceDocument = vi.fn();
const editorState = { document: { schemaVersion: 1, blocks: [] }, designHash: 'h' };

vi.mock('@/features/editor/state/use-editor', () => ({
  useEditorStore: () => ({ getState: () => editorState, replaceDocument }),
}));

const { AiAssistantPanel } = await import('./assistant-panel');

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ ai: csAi }} timeZone="Europe/Prague">
      {ui}
    </NextIntlClientProvider>,
  );

const problem = (status: number, code: string) =>
  new Response(JSON.stringify({ status, code, title: code }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  replaceDocument.mockClear();
  fetchMock = vi.fn(async () => problem(404, 'not_found'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const submit = () => screen.getByRole('button', { name: csAi.panel.submit }).click();

describe('cesta z panelu na /api/internal/ai/chat', () => {
  it('odeslání formuláře opravdu pošle požadavek na routu', async () => {
    wrap(<AiAssistantPanel templateId="t1" workspaceId="w1" hasCredential brandName={null} />);
    submit();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/internal/ai/chat');
  });

  it('požadavek nese X-Workspace-Id, jinak ho autentizace odmítne 404', async () => {
    wrap(<AiAssistantPanel templateId="t1" workspaceId="w-42" hasCredential brandName={null} />);
    submit();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    const header = Object.entries(init.headers).find(
      ([name]) => name.toLowerCase() === 'x-workspace-id',
    );
    expect(header?.[1]).toBe('w-42');
  });

  it('v těle jde identifikátor šablony, ne prázdný řetězec', async () => {
    wrap(<AiAssistantPanel templateId="tpl-9" workspaceId="w1" hasCredential brandName={null} />);
    submit();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const init = fetchMock.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(init.body)).toMatchObject({ templateId: 'tpl-9' });
  });

  it('odpověď 404 se NEZOBRAZÍ jako výpadek poskytovatele', async () => {
    wrap(
      <AiAssistantPanel
        templateId="t1"
        workspaceId="w1"
        hasCredential
        brandName={null}
        providerLabel="OpenAI"
      />,
    );
    submit();

    const alert = await screen.findByText(/not_found/);
    expect(alert.textContent).not.toContain('výpadek');
  });

  it('odpověď, která není JSON, ukáže aspoň stavový kód', async () => {
    fetchMock.mockResolvedValue(new Response('404 Not Found', { status: 404 }));
    wrap(<AiAssistantPanel templateId="t1" workspaceId="w1" hasCredential brandName={null} />);
    submit();

    const alert = await screen.findByText(/http_404/);
    expect(alert.textContent).not.toContain('výpadek');
  });
});

describe('neznámý kód chyby se nikdy nevydává za výpadek', () => {
  const unknownCodes = [
    'not_found',
    'forbidden',
    'unauthenticated',
    'validation_failed',
    'internal_error',
    'ai_unknown',
    'http_500',
  ];

  it.each(unknownCodes)('kód %s se pojmenuje, ne přeloží na výpadek', (code) => {
    wrap(
      <AssistantPanelView
        state={{ phase: 'error', code, provider: 'OpenAI' }}
        hasCredential
        brandName={null}
      />,
    );

    const alert = screen.getByText(new RegExp(code));
    expect(alert.textContent).not.toContain('výpadek');
  });

  it('o výpadku se mluví jen u kódu, který výpadek opravdu znamená', () => {
    wrap(
      <AssistantPanelView
        state={{ phase: 'error', code: 'ai_provider_unavailable', provider: 'OpenAI' }}
        hasCredential
        brandName={null}
      />,
    );
    expect(screen.getByText(/výpadek/)).toBeInTheDocument();
  });

  /*
   * Naměřeno klikáním 3. 8. 2026: požadavek prošel (200), model si ale vymyslel
   * `brandProfileId`, nástroj `composeTemplate` spadl a asistent odpověděl jen
   * větou. Panel se beze slova vrátil na prázdný formulář, takže to na uživatele
   * působilo jako nefunkční tlačítko.
   */
  it('doběhnutí bez návrhu se uživateli řekne, panel nemlčí', () => {
    wrap(
      <AssistantPanelView
        state={{ phase: 'noDraft', text: 'Potřebuji nejprve značku projektu.' }}
        hasCredential
        brandName={null}
      />,
    );

    expect(screen.getByText(/návrh e-mailu nevytvořil/)).toBeInTheDocument();
    expect(screen.getByText('Potřebuji nejprve značku projektu.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: csAi.errors.retry })).toBeInTheDocument();
  });

  it('jediný kód mapovaný na hlášku o výpadku je ai_provider_unavailable', () => {
    const mapped = Object.entries(ERROR_KEYS)
      .filter(([, key]) => key === 'providerDown')
      .map(([code]) => code);
    expect(mapped).toEqual(['ai_provider_unavailable']);
  });
});
