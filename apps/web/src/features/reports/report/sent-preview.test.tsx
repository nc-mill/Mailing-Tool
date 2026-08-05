// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import csReports from '../../../../../../packages/i18n/messages/cs/reports.json';
import { SentPreview, type SentPreviewPayload } from './sent-preview';

/**
 * TENHLE SOUBOR MĚŘÍ ZAPOJENÍ A BEZPEČNOST RÁMCE, NE VZHLED.
 *
 * Náhled odeslané kampaně má tři vlastnosti, na kterých stojí celý jeho smysl.
 * Za prvé kreslí VYRENDEROVANÉ tělo, takže se musí ptát na `/sent-content`
 * a vzít, co odpoví; kdyby si obsah sháněl jinudy, ukazoval by buď dnešní
 * podobu šablony, nebo zdrojovou podobu se syrovými Liquid výrazy. Za druhé
 * je to CIZÍ HTML, takže rámec nesmí dostat ani `allow-scripts`, ani
 * `allow-same-origin`. Za třetí prázdný e-mail POJMENUJE, místo aby mlčel.
 *
 * Kdyby spadl na atributu `sandbox`: neupravuj ho. Znamená to, že tělo e-mailu
 * dostalo v aplikaci práva, která mít nemá.
 */
const messages = { reports: csReports };

const payload: SentPreviewPayload = {
  html: '<p>Dobrý den, tohle odešlo.</p>',
  text: 'Dobrý den, tohle odešlo.',
  compiled_at: '2026-07-30T09:15:00.000Z',
  revision: 7,
  status: 'sent',
  subject: 'Sleva 30 %',
  content_state: 'ok',
  personalized_for: 'jana@example.cz',
};

function stubFetch(body: SentPreviewPayload | null, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body ?? { code: 'not_found' }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPreview() {
  render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <SentPreview campaignId="c1" />
    </NextIntlClientProvider>,
  );
}

describe('SentPreview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('čte vyrenderovanou podobu z /api/v1/campaigns/{id}/sent-content', async () => {
    const fetchMock = stubFetch(payload);
    renderPreview();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/v1/campaigns/c1/sent-content');
    expect(await screen.findByText('Sleva 30 %')).toBeVisible();
  });

  it('vykreslí tělo do rámce bez skriptů a bez vlastního původu', async () => {
    stubFetch(payload);
    renderPreview();

    const frame = await screen.findByTitle(csReports.report.sentPreview.frameTitle);
    expect(frame.tagName).toBe('IFRAME');
    // Bez jediné výjimky: tělo e-mailu je cizí obsah.
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('srcdoc') ?? '').toContain('Dobrý den, tohle odešlo.');
  });

  /**
   * Kdyby tenhle test spadl: rám se v prohlížeči zase nevykreslí.
   *
   * `EmailPreview` si bez předaných původů dosazuje `window.location.origin` až
   * ve vlastním efektu, tedy PŘEPÍŠE `srcdoc` hned po vložení rámu do stránky.
   * Chromium takový rám nechá prázdný, přestože obsah v DOM je; přesně tak
   * vypadal nález „sekce nic nezobrazuje". Stálá hodnota v příznaku
   * `imageOrigins` ten druhý zápis ruší, takže se rám načte jednou.
   */
  it('drží srcdoc rámu stálý, aby se rám nenačítal dvakrát', async () => {
    stubFetch(payload);
    renderPreview();

    const frame = await screen.findByTitle(csReports.report.sentPreview.frameTitle);
    const first = frame.getAttribute('srcdoc');
    // Efekty `EmailPreview` už proběhly; druhá podoba `srcdoc` by se projevila tady.
    await waitFor(() => expect(frame.getAttribute('srcdoc')).toBe(first));
    expect(first ?? '').toContain(`img-src data: ${window.location.origin}`);
  });

  it('je označený jako jen ke čtení a nenabízí úpravu', async () => {
    stubFetch(payload);
    renderPreview();

    expect(await screen.findByTestId('read-only-banner')).toHaveTextContent(
      csReports.report.sentPreview.readOnly,
    );
    // Žádná cesta k přepsání odeslané kampaně: ani tlačítko, ani odkaz.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('u nezkompilované kampaně vysvětlí prázdno místo rámce', async () => {
    stubFetch({ ...payload, html: null, text: null, compiled_at: null, content_state: 'missing' });
    renderPreview();

    expect(await screen.findByText(csReports.report.sentPreview.notCompiledTitle)).toBeVisible();
    expect(screen.queryByTitle(csReports.report.sentPreview.frameTitle)).toBeNull();
  });

  it('u e-mailu bez obsahu to řekne slovy a rám přesto ukáže', async () => {
    stubFetch({
      ...payload,
      html: '<html><body><td>Odhlásit se z odběru</td></body></html>',
      text: '\r\nOdhlásit se z odběru: #preview-disabled\r\n',
      content_state: 'empty',
    });
    renderPreview();

    expect(await screen.findByText(csReports.report.sentPreview.emptyContentTitle)).toBeVisible();
    expect(screen.getByText(csReports.report.sentPreview.emptyContentBody)).toBeVisible();
    // Rám zůstává: doklad o odeslaném e-mailu se neschovává, jen se vysvětlí.
    expect(screen.getByTitle(csReports.report.sentPreview.frameTitle)).toBeVisible();
  });

  it('u e-mailu s obsahem o prázdnu nemluví', async () => {
    stubFetch(payload);
    renderPreview();

    await screen.findByTitle(csReports.report.sentPreview.frameTitle);
    expect(screen.queryByText(csReports.report.sentPreview.emptyContentTitle)).toBeNull();
  });

  it('řekne, podle koho se dosadily osobní údaje, a že systémové odkazy nevedou nikam', async () => {
    stubFetch(payload);
    renderPreview();

    expect(await screen.findByTestId('sent-preview-personalized-for')).toHaveTextContent(
      'jana@example.cz',
    );
    expect(screen.getByText(csReports.report.sentPreview.systemLinksNote)).toBeVisible();
  });

  it('při chybě API ohlásí neúspěch, ne prázdný náhled', async () => {
    stubFetch(null, 500);
    renderPreview();

    expect(await screen.findByRole('alert')).toHaveTextContent(csReports.report.sentPreview.failed);
  });
});
