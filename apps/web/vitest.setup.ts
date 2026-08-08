// Registruje matchery jest-dom (toBeInTheDocument a další) a úklid po každém
// testu. Bez cleanup() zůstává předchozí render v dokumentu a getByRole najde
// víc prvků téže role. Explicitní afterEach je zvolený schválně místo
// globals: true, aby se testy nepsaly proti implicitním globálům.
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

/*
 * `waitFor` a `findBy*` čekají ve výchozím stavu jednu vteřinu. Na runneru
 * GitHubu je to málo: běží tam tři vlákna jsdom na čtyřech jádrech a tentýž
 * soubor je tam zhruba dvanáctkrát pomalejší než na vývojářském stroji.
 * Odchytávalo se to jako „Unable to find an element with the text", tedy jako
 * chybějící prvek, přestože prvek se jen ještě nestihl vykreslit.
 *
 * Pět vteřin je strop čekání, ne délka běhu: jakmile tvrzení projde, `waitFor`
 * se vrací hned. Zelený test se tím nezpomalí.
 */
configure({ asyncUtilTimeout: 5_000 });

/**
 * `window.matchMedia` jsdom NEMÁ a nikdy mít nebude (nepočítá rozvržení, takže
 * nemá z čeho odpovědět). Komponenta, která se ptá na šířku okna, tedy v testu
 * spadne na `matchMedia is not a function`, přestože v prohlížeči funguje.
 *
 * Výchozí odpověď je „dotaz neplatí", tedy chování širokého okna. Test, který
 * potřebuje úzké, si `matchMedia` přepíše sám (`vi.stubGlobal`); tenhle řádek
 * je jen podlaha, aby se kvůli němu nemusel měnit produkční kód.
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
