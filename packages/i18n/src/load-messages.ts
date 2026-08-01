import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSupportedLocale, type Locale } from './locales';

/**
 * Registr namespace. Doménový plán sem přidá **jeden řádek** ke svému
 * souboru v `messages/{locale}/`.
 *
 * Seznam je vypsaný schválně: katalog se do aplikace dostává přes bundler,
 * který obsah adresáře za běhu nezná. Čtení adresáře v Next.js runtime
 * nefunguje a v samostatném (standalone) balíčku by soubory chyběly úplně.
 * Že se seznam shoduje s obsahem adresáře, hlídá test v `load-messages.test.ts`.
 */
export const NAMESPACES = ['auth', 'common', 'contacts', 'settings'] as const;

export type MessageTree = Record<string, unknown>;

/**
 * Vrací seřazený seznam namespace podle obsahu adresáře.
 *
 * Používají to kontroly katalogu a testy, které běží v Node. Aplikace
 * si bere `NAMESPACES`, protože v bundleru se adresář přečíst nedá.
 */
export async function listNamespaces(locale: Locale): Promise<string[]> {
  // Cesta se skládá až tady, aby ji bundler nemusel řešit při sestavení.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const entries = await readdir(path.join(here, '..', 'messages', locale));
  return entries
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
}

/**
 * Složí `messages/<locale>/<namespace>.json` do jednoho stromu,
 * který `next-intl` očekává: { common: {...}, contacts: {...} }.
 *
 * Soubory jsou rozdělené kvůli vlastnictví (uzávěr S4), tvar stromu
 * zůstává takový, jaký popisuje část 1 v 3.9.
 */
export async function loadMessages(locale: Locale): Promise<MessageTree> {
  if (!isSupportedLocale(locale)) {
    throw new Error(`Nepodporovaný jazyk: ${locale}`);
  }
  const tree: MessageTree = {};
  for (const namespace of NAMESPACES) {
    const module = (await import(`../messages/${locale}/${namespace}.json`)) as {
      default: unknown;
    };
    tree[namespace] = module.default;
  }
  return tree;
}
