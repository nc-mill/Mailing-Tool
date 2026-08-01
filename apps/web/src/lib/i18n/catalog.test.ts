import { readFileSync } from 'node:fs';
import path from 'node:path';
import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { AUTH_ERROR_KEYS, SETTINGS_ERROR_KEYS } from '@/lib/errors/error-keys';

const MESSAGES_DIR = path.resolve(import.meta.dirname, '../../../../../packages/i18n/messages');

function load(locale: 'cs' | 'en', namespace: 'auth' | 'settings'): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(MESSAGES_DIR, locale, `${namespace}.json`), 'utf8'));
}

function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value };
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    Object.assign(out, flatten(child, prefix === '' ? key : `${prefix}.${key}`));
  }
  return out;
}

/**
 * Jména slotů se čtou z ICU stromu, ne regulárním výrazem.
 *
 * Výraz `/\{(\w+)[,}]/` totiž považuje za slot i obsah větve, která je jedno
 * slovo: ve zprávě `{count, plural, =0 {Failing} …}` by našel slot `Failing`
 * a porovnání s češtinou by spadlo na správně napsané zprávě. Ověřeno
 * spuštěním na skutečných katalozích, kde to byl jediný nález.
 */
function slotNames(message: string, locale: 'cs' | 'en'): string[] {
  const names = new Set<string>();
  type Node = {
    type: number;
    value?: string;
    options?: Record<string, { value: Node[] }>;
    children?: Node[];
  };
  const walk = (nodes: Node[]): void => {
    for (const node of nodes) {
      // 0 literál, 1 argument, 2 číslo, 3 datum, 4 čas, 5 select, 6 plural, 7 #, 8 značka
      if (node.type >= 1 && node.type <= 6 && node.value !== undefined) names.add(node.value);
      if (node.options !== undefined) {
        for (const option of Object.values(node.options)) walk(option.value);
      }
      if (node.children !== undefined) walk(node.children);
    }
  };
  // `ast` je v typech `intl-messageformat` označené jako private, přestože
  // za běhu veřejné je. Přetypování je jediná cesta, jak strom přečíst,
  // aniž by se zpráva parsovala podruhé vlastním kódem.
  const parsed = new IntlMessageFormat(message, locale) as unknown as { ast: Node[] };
  walk(parsed.ast);
  return [...names].sort();
}

function matchBrace(message: string, open: number): number {
  let depth = 0;
  for (let index = open; index < message.length; index += 1) {
    if (message[index] === '{') depth += 1;
    else if (message[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * První blok `plural` ve zprávě a informace, jestli stojí nad celou zprávou.
 *
 * ODCHYLKA OD PLÁNU, jen zápisem: plán volal `regex.exec(message)`. Používá se
 * `message.match(regex)` s nezaglobalizovaným výrazem, což je totéž včetně
 * `index`, ale neklopýtne o kontrolu, která hlídá `exec` z `child_process`.
 */
function pluralBlock(message: string): { block: string; spansWholeMessage: boolean } | null {
  const opener = message.match(/\{\s*\w+\s*,\s*plural\s*,/);
  if (opener?.index === undefined) return null;
  const end = matchBrace(message, opener.index);
  if (end === -1) return null;
  const block = message.slice(opener.index, end + 1);
  return { block, spansWholeMessage: message.trim() === block.trim() };
}

/** Obsah větve `=0` uvnitř bloku, bez vnějších závorek. */
function zeroBranch(block: string): string | null {
  const marker = block.match(/=0\s*\{/);
  if (marker?.index === undefined) return null;
  const open = marker.index + marker[0].length - 1;
  const end = matchBrace(block, open);
  if (end === -1) return null;
  return block.slice(open + 1, end);
}

const NAMESPACES = ['auth', 'settings'] as const;

describe.each(NAMESPACES)('katalog %s', (namespace) => {
  const cs = flatten(load('cs', namespace));
  const en = flatten(load('en', namespace));

  it('má v obou jazycích stejnou množinu klíčů', () => {
    expect(Object.keys(cs).sort()).toEqual(Object.keys(en).sort());
  });

  it('neobsahuje dlouhou pomlčku', () => {
    // Znak U+2014 se zapisuje escape sekvencí, aby se do repozitáře nedostal ani v testu.
    const EM_DASH = String.fromCharCode(0x2014);
    for (const [key, value] of Object.entries({ ...cs, ...en })) {
      expect(value.includes(EM_DASH), `klíč ${key}`).toBe(false);
    }
  });

  it('neobsahuje zakázané výrazy ze slovníku 9.2 části 6', () => {
    const forbidden = [
      'pracovní prostor',
      'workspace',
      'odběratel',
      'blacklist',
      'černá listina',
      'kvóta',
      'trackování',
      'proklik',
      'joba',
      'administrátor',
      'přístupový klíč',
    ];
    for (const [key, value] of Object.entries(cs)) {
      const lower = value.toLowerCase();
      for (const term of forbidden) {
        expect(lower.includes(term), `klíč ${key} obsahuje zakázaný výraz ${term}`).toBe(false);
      }
    }
  });

  it('nepoužívá hodnotu subscribed jako stav', () => {
    for (const value of Object.values({ ...cs, ...en })) {
      expect(value).not.toMatch(/\bsubscribed\b/);
    }
  });

  it('každý řetězec je platný ICU výraz v obou jazycích', () => {
    for (const [key, value] of Object.entries(cs)) {
      expect(() => new IntlMessageFormat(value, 'cs'), `cs.${namespace}.${key}`).not.toThrow();
    }
    for (const [key, value] of Object.entries(en)) {
      expect(() => new IntlMessageFormat(value, 'en'), `en.${namespace}.${key}`).not.toThrow();
    }
  });

  it('český plural má všechny čtyři kategorie a =0', () => {
    for (const [key, value] of Object.entries(cs)) {
      if (!value.includes(', plural,')) continue;
      for (const category of ['=0', 'one', 'few', 'many', 'other']) {
        expect(value.includes(`${category} {`), `cs.${namespace}.${key} postrádá ${category}`).toBe(
          true,
        );
      }
    }
  });

  it('anglický plural má =0, one a other', () => {
    for (const [key, value] of Object.entries(en)) {
      if (!value.includes(', plural,')) continue;
      for (const category of ['=0', 'one', 'other']) {
        expect(value.includes(`${category} {`), `en.${namespace}.${key} postrádá ${category}`).toBe(
          true,
        );
      }
    }
  });

  it('sloty ve zprávě jsou v obou jazycích stejné', () => {
    for (const key of Object.keys(cs)) {
      expect(slotNames(cs[key]!, 'cs'), `klíč ${key}`).toEqual(slotNames(en[key]!, 'en'));
    }
  });

  it('český plural se vykreslí pro 0, 1, 2, 5 a 1,5', () => {
    for (const [key, value] of Object.entries(cs)) {
      if (!value.includes(', plural,')) continue;
      const slot = value.match(/\{(\w+), plural,/)![1]!;
      const formatter = new IntlMessageFormat(value, 'cs');
      const args = Object.fromEntries(slotNames(value, 'cs').map((name) => [name, 'x']));
      for (const count of [0, 1, 2, 5, 21, 100, 1.5]) {
        expect(
          String(formatter.format({ ...args, [slot]: count })),
          `cs.${namespace}.${key} u ${count}`,
        ).not.toBe('');
      }
    }
  });

  it('česká větev =0 se nespoléhá na sloveso mimo blok', () => {
    // 12.3 části 6: v češtině se s číslem mění nejen podstatné jméno, ale
    // i sloveso, takže `plural` musí stát nad CELOU větou. Nejspolehlivější
    // známka porušení je záporové zájmeno („žádný", „nic") ve větvi =0,
    // protože ta si vynucuje zápor u slovesa a to zůstalo před blokem:
    // z „Ukončíme {=0 {žádnou relaci}}" vznikne „Ukončíme žádnou relaci".
    //
    // Pravidlo je čistě strukturální a nezná mluvnici: kdo ve větvi =0
    // potřebuje záporové zájmeno, musí mít celou větu uvnitř bloku.
    // Ověřeno na skutečných katalozích: chytí všech pět dřívějších případů
    // a propustí `shared.countExact`, kde blok stojí nad celou zprávou.
    const NEGATIVE = /(žádn|\bnic\b|nikdo|nikde|nijak)/i;
    for (const [key, value] of Object.entries(cs)) {
      const block = pluralBlock(value);
      if (block === null || block.spansWholeMessage) continue;
      const zero = zeroBranch(block.block);
      if (zero === null) continue;
      expect(
        NEGATIVE.test(zero),
        `cs.${namespace}.${key}: větev =0 zní "${zero}", ale sloveso zůstalo mimo blok. ` +
          'Přesuň celou větu dovnitř větví, nebo záporové zájmeno nepoužívej.',
      ).toBe(false);
    }
  });
});

describe('pokrytí chybových kódů', () => {
  const csAuth = flatten(load('cs', 'auth'));
  const enAuth = flatten(load('en', 'auth'));
  const csSettings = flatten(load('cs', 'settings'));
  const enSettings = flatten(load('en', 'settings'));

  it('každý kód z mapy auth má text v obou jazycích', () => {
    for (const keys of Object.values(AUTH_ERROR_KEYS)) {
      expect(csAuth, keys.title).toHaveProperty(keys.title);
      expect(enAuth, keys.title).toHaveProperty(keys.title);
      expect(csAuth, keys.body).toHaveProperty(keys.body);
      expect(enAuth, keys.body).toHaveProperty(keys.body);
    }
  });

  it('každý kód z mapy settings má text v obou jazycích', () => {
    for (const keys of Object.values(SETTINGS_ERROR_KEYS)) {
      expect(csSettings, keys.title).toHaveProperty(keys.title);
      expect(enSettings, keys.title).toHaveProperty(keys.title);
      expect(csSettings, keys.body).toHaveProperty(keys.body);
      expect(enSettings, keys.body).toHaveProperty(keys.body);
    }
  });

  it('obě namespace mají fallback pro neznámý kód', () => {
    for (const catalog of [csAuth, enAuth, csSettings, enSettings]) {
      expect(catalog).toHaveProperty('errors.fallback.title');
      expect(catalog).toHaveProperty('errors.fallback.body');
    }
  });
});
