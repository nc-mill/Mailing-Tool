import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * `<html lang>` MUSÍ ODPOVÍDAT JAZYKU STRÁNKY.
 *
 * Do 5. 8. 2026 měl kořenový layout `lang="cs"` natvrdo, takže anglická
 * stránka se prohlašovala za českou. Naměřeno v běžící instalaci:
 * `GET /en/login` vrátil `<html lang="cs">`.
 *
 * Není to kosmetika. Čtečka obrazovky podle `lang` přepíná hlas, takže anglický
 * text čte českou výslovností; vyhledávače z něj určují jazyk stránky;
 * a `features/reports/api-client.ts` z něj odvozuje jazyk vět, které skládá
 * server, takže by si na anglickou obrazovku vyžádal české věty.
 *
 * Test si podvrhuje `getLocale`, protože jinak by potřeboval běžící požadavek.
 * Měří jedinou věc: že se do atributu dostane to, co vrátí vyjednávání jazyka,
 * a ne pevná hodnota.
 */

const getLocale = vi.hoisted(() => vi.fn());
vi.mock('next-intl/server', () => ({ getLocale }));
vi.mock('../../src/app/globals.css', () => ({}));

const { default: RootLayout } = await import('../../src/app/layout');

async function langOf(locale: string): Promise<string | undefined> {
  getLocale.mockResolvedValue(locale);
  const markup = renderToStaticMarkup(await RootLayout({ children: null }));
  return markup.match(/<html lang="([a-z-]+)"/)?.[1];
}

describe('kořenový layout', () => {
  it('vezme jazyk z vyjednávání, ne z pevné hodnoty', async () => {
    expect(await langOf('en')).toBe('en');
    expect(await langOf('cs')).toBe('cs');
  });
});
