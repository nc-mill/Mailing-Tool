import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import csAi from '@mlain/i18n/messages/cs/ai.json';
import { ExtractionForm, brandErrorKey } from './extraction-form';

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ ai: csAi }} timeZone="Europe/Prague">
      {ui}
    </NextIntlClientProvider>,
  );

describe('mapování chybových kódů na hlášky', () => {
  it('vnitřní adresa a zakázaný host mají tutéž hlášku, aby uživatel nepoznal proč', () => {
    expect(brandErrorKey('brand_blocked_address')).toBe('blocked');
    expect(brandErrorKey('brand_host_not_allowed')).toBe('blocked');
  });

  it('hláška o vnitřní adrese nevysvětluje ochranu proti vnitřní síti', () => {
    wrap(<ExtractionForm state={{ phase: 'error', code: 'brand_blocked_address' }} />);
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).toMatch(/Tuhle adresu stahovat neumíme/);
    expect(text).not.toMatch(/vnitřní síť|SSRF|interní/i);
  });

  it('robots vede na ruční zadání', () => {
    expect(brandErrorKey('brand_robots_disallowed')).toBe('robotsDisallowed');
    wrap(
      <ExtractionForm
        state={{ phase: 'error', code: 'brand_robots_disallowed', host: 'kolo-shop.cz' }}
      />,
    );
    expect(screen.getByText(/Zadat barvy ručně/)).toBeInTheDocument();
  });

  it('nenalezené logo nabídne ruční nahrání', () => {
    expect(brandErrorKey('logo_not_found')).toBe('logoNotFound');
    wrap(<ExtractionForm state={{ phase: 'error', code: 'logo_not_found' }} />);
    expect(screen.getByRole('button', { name: 'Nahrát logo' })).toBeInTheDocument();
  });

  it('neznámý kód spadne na obecné nedostupnosti, ne na prázdné hlášce', () => {
    expect(brandErrorKey('neznamy_kod')).toBe('unreachable');
  });

  it('vyčerpaný limit ukáže počet pokusů za hodinu', () => {
    wrap(<ExtractionForm state={{ phase: 'error', code: 'rate_limited', limit: 10 }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/10 pokusů za hodinu/);
  });
});

describe('stavy formuláře', () => {
  it('prázdný stav vyzve k zadání adresy', () => {
    wrap(<ExtractionForm state={{ phase: 'idle' }} />);
    expect(screen.getByText(/Zadejte adresu svého webu/)).toBeInTheDocument();
  });

  it('běžící extrakce hlásí průběh do aria-live', () => {
    wrap(<ExtractionForm state={{ phase: 'running', elapsedMs: 2000 }} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/Prohlížíme web/);
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('po deseti sekundách přibude poznámka, že je web pomalý', () => {
    wrap(<ExtractionForm state={{ phase: 'running', elapsedMs: 11_000 }} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Web je pomalý/);
  });

  it('hotový stav vyzve ke kontrole výsledku', () => {
    wrap(<ExtractionForm state={{ phase: 'done' }} />);
    expect(screen.getByText(/Hotovo. Zkontrolujte, jestli to sedí/)).toBeInTheDocument();
  });
});
