// Matchery jest-dom se typují modulovou augmentací. Registruje je
// `apps/web/vitest.setup.ts`, jenže ten soubor v `tsconfig.json` není
// v `include`, takže `tsc` augmentaci nevidí. Import tady je typová oprava
// bez dopadu na chování: modul se stejně načítá v setupu.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MlainConfig } from '@mlain/core/config';
import { ConfigStatus, configStatusItems, type ConfigStatusItem } from './config-status';

/**
 * Panel je SERVEROVÁ komponenta, překlady si tedy bere přes `getTranslations`.
 * Mimo běh Nextu žádný požadavek neexistuje, náhrada proto staví skutečný
 * překladač nad skutečným českým katalogem. Test tím zároveň hlídá, že klíče
 * v katalogu opravdu jsou: chybějící klíč by se vypsal jako `auth.setup…`
 * a tvrzení na text by spadlo.
 */
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const messages = (await import('../../../../../packages/i18n/messages/cs/auth.json')).default;
  return {
    // Přetypování jmenného prostoru: `createTranslator` si ho odvozuje z tvaru
    // katalogu, kdežto komponenta ho předává jako obyčejný řetězec.
    getTranslations: async (namespace: string) =>
      createTranslator({
        locale: 'cs',
        messages: { auth: messages },
        namespace: namespace as 'auth',
      }),
  };
});

function item(overrides: Partial<ConfigStatusItem> = {}): ConfigStatusItem {
  return {
    variable: 'DATABASE_URL_MAINTENANCE',
    applies: true,
    present: false,
    impact: 'Záložní text z jádra.',
    modes: ['worker', 'all'],
    ...overrides,
  };
}

async function renderPanel(items: readonly ConfigStatusItem[] | null) {
  return render(await ConfigStatus({ items }));
}

describe('ConfigStatus', () => {
  it('u chybějící položky ukáže její název i to, co kvůli ní nepojede', async () => {
    await renderPanel([item()]);

    expect(screen.getByText('DATABASE_URL_MAINTENANCE')).toBeInTheDocument();
    expect(screen.getByText('Chybí')).toBeInTheDocument();
    expect(screen.getByText(/Naplánovaná kampaň se neodešle/)).toBeInTheDocument();
  });

  /**
   * „Nic tu není" se čte dvojznačně: jednou jako „všechno sedí", podruhé jako
   * „kontrola neproběhla". Vypsaný zelený řádek tuhle dvojznačnost odstraňuje.
   */
  it('ukáže i to, co je v pořádku, ne jen problémy', async () => {
    await renderPanel([item({ present: true })]);

    expect(screen.getByText('Nastaveno')).toBeInTheDocument();
    expect(screen.getByText('Všechno, co instalace potřebuje, je vyplněné.')).toBeInTheDocument();
    expect(screen.queryByText('Chybí')).not.toBeInTheDocument();
  });

  /**
   * PANEL SE ŘÍDÍ HODNOTOU, NE `MODE`, a je to oprava naměřená na skutečné
   * obrazovce 8. 8. 2026. Web běží s `MODE=web` a všechny tři sledované
   * proměnné patří workerovi nebo senderu, takže původní podoba panelu u všech
   * tří napsala „tady se nepoužívá" a NEZKONTROLOVALA ANI JEDNU. Průvodce tím
   * nedal odpověď na jedinou otázku, kvůli které vznikl.
   *
   * Chybějící hodnota je tedy varování bez ohledu na `MODE`. V dodávané
   * instalaci běží všechny tři procesy v jednom kontejneru se sdíleným
   * prostředím, takže co nevidí web, nevidí ani worker.
   */
  it('chybějící hodnotu hlásí i tehdy, když ji čte jiný proces', async () => {
    await renderPanel([item({ applies: false })]);

    expect(screen.getByText('Chybí')).toBeInTheDocument();
    expect(screen.getByText(/Naplánovaná kampaň se neodešle/)).toBeInTheDocument();
    expect(screen.getByText(/Potřebuje ji: fronty a naplánované úlohy\./)).toBeInTheDocument();
  });

  /**
   * U rozdělené instalace, kde worker běží na jiném stroji s vlastním
   * nastavením, tenhle panel na jeho prostředí nedosáhne. Nesmí proto tvrdit
   * víc, než ví: řekne, který proces proměnnou potřebuje, a pošle obsluhu
   * ověřit to tam.
   */
  it('u chybějící položky přizná, že jiný stroj odsud zkontrolovat nejde', async () => {
    await renderPanel([item({ applies: false })]);

    expect(
      screen.getByText(/běží na jiném stroji s vlastním nastavením, ověřte to tam/),
    ).toBeInTheDocument();
  });

  it('u vyplněné položky řekne, kdo ji používá', async () => {
    await renderPanel([item({ present: true })]);

    expect(screen.getByText('Používá ji: fronty a naplánované úlohy.')).toBeInTheDocument();
  });

  /**
   * V konfiguraci jsou hesla k databázi. Ven smí jít NÁZEV proměnné, příznak
   * chybí/je a text dopadu, nikdy hodnota. Test jde přes tutéž cestu jako
   * stránka, tedy přes `configStatusItems`, aby hlídal skutečný převod.
   */
  it('hodnotu proměnné do prohlížeče nepošle', async () => {
    const secret = 'postgres://mlain_maintenance:tajneheslo123@db:5432/mlain';
    const config = {
      MODE: 'all',
      DATABASE_URL_MAINTENANCE: secret,
      DATABASE_URL_GDPR: 'postgres://mlain_gdpr:jinetajne@db:5432/mlain',
      TRACKING_DOMAIN: 'https://mereni.example.cz',
    } as unknown as MlainConfig;

    const { container } = await renderPanel(configStatusItems(config));

    expect(container.textContent).not.toContain(secret);
    expect(container.textContent).not.toContain('tajneheslo123');
    expect(container.textContent).not.toContain('jinetajne');
    expect(container.textContent).not.toContain('mereni.example.cz');
    expect(screen.getByText('DATABASE_URL_MAINTENANCE')).toBeInTheDocument();
  });

  it('řekne, kam se chybějící položka doplňuje', async () => {
    await renderPanel([item()]);

    expect(screen.getByText(/souboru \.env vedle docker-compose\.yml/)).toBeInTheDocument();
  });

  /** Nepřečtená konfigurace se nesmí vydávat za konfiguraci v pořádku. */
  it('nepřečtenou konfiguraci přizná místo hlášení, že je vše v pořádku', async () => {
    await renderPanel(null);

    expect(screen.getByText(/kontrola tedy neproběhla/)).toBeInTheDocument();
    expect(
      screen.queryByText('Všechno, co instalace potřebuje, je vyplněné.'),
    ).not.toBeInTheDocument();
  });

  it('chybějící položky řadí nad ty vyřešené', async () => {
    const { container } = await renderPanel([
      item({ variable: 'TRACKING_DOMAIN', present: true, modes: ['sender', 'all'] }),
      item(),
    ]);

    const statuses = [...container.querySelectorAll('li')].map((li) => li.dataset['status']);
    expect(statuses).toEqual(['missing', 'present']);
  });
});
