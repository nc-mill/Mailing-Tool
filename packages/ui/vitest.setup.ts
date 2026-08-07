import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * `window.matchMedia` jsdom NEMÁ a nikdy mít nebude (nepočítá rozvržení, takže
 * nemá z čeho odpovědět). Komponenta, která se ptá na šířku okna, tedy v testu
 * spadne na `matchMedia is not a function`, přestože v prohlížeči funguje.
 *
 * Výchozí odpověď je „dotaz neplatí", tedy chování širokého okna. Test, který
 * potřebuje úzké, si `matchMedia` přepíše sám (`vi.stubGlobal`); tenhle řádek
 * je jen podlaha, aby se kvůli němu nemusel měnit produkční kód. Táž podlaha
 * je v `apps/web/vitest.setup.ts` a ze stejného důvodu.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
});
