import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Vlastní velikosti písma z `tokens.css`.
 *
 * MUSÍ TU BÝT VYPSANÉ. `tailwind-merge` nezná naši konfiguraci, takže si
 * třídu `text-ui` přebere podle tvaru jako BARVU textu, ne jako velikost.
 * Pak ji považuje za konflikt s `text-text` a při skládání ji zahodí:
 *
 *   cn('text-ui', 'text-text')  →  'text-text'      // velikost tiše zmizí
 *
 * Nikde se to neohlásí, prvek jen dostane zděděnou velikost. Naměřeno na
 * hlášce, která místo 15 px vyšla 17 px, přestože `text-ui` v kódu bylo.
 * Přežily jen `text-sm` a `text-base`, které `tailwind-merge` zná z výchozí
 * škály Tailwindu.
 *
 * KDYŽ PŘIDÁŠ DO `tokens.css` DALŠÍ `--text-*`, PŘIDEJ HO I SEM.
 */
const FONT_SIZES = [
  'display',
  'h1',
  'h2',
  'h3',
  'callout',
  'lead',
  'body',
  'ui',
  'meta',
  'label',
  'micro',
] as const;

/**
 * Vlastní velikosti ikon z `globals.css`. Dvě velikosti ikony na jednom prvku
 * nedávají smysl, vyhrát má poslední. Bez vlastní skupiny by `cn` nechalo obě
 * a rozhodlo by pořadí v CSS, ne pořadí ve volání.
 */
const ICON_SIZES = ['icon-2xs', 'icon-xs', 'icon-sm', 'icon-md', 'icon-lg', 'icon-xl'] as const;

// Vlastní skupinu je potřeba ohlásit i typu, jinak `extendTailwindMerge`
// přijímá jen názvy skupin, které zná ze své výchozí konfigurace.
const twMerge = extendTailwindMerge<'mlain-icon-size'>({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZES] }],
      'mlain-icon-size': [...ICON_SIZES],
    },
  },
});

/** Skládá třídy a u konfliktních Tailwind utilit nechá vyhrát poslední. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
