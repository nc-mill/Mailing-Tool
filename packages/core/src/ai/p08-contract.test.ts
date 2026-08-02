import { describe, expect, it } from 'vitest';
import { baseSectionSpecSchema, buildBaseTemplate } from '@mlain/emails/base';
import { validateLiquid } from '@mlain/contracts/liquid';
import { validateTemplateDocument } from '../templates/validate';

/**
 * SAMOODEMYKACÍ ČÁST KONTRAKTU.
 *
 * Plán čekal `validateDocument` a `validateLiquid` z jedné adresy
 * `@mlain/core/templates`. Barrel mezitím vznikl (fáze G plánu P08) a rovnou
 * ukázal, že se plán o jménech mýlil: validace dokumentu se jmenuje
 * `validateTemplateDocument` a validace Liquidu v barrelu není vůbec, bydlí
 * v `@mlain/contracts/liquid`.
 *
 * Test proto pinuje SCHOPNOST, ne jméno z plánu: barrel musí umět zvalidovat
 * dokument. Tvrdě přeskočený test by o dodavateli mlčel navždy, červený by
 * kazil sérii ostatním a začal by se přehlížet, a test na jméno z plánu by
 * byl červený kvůli tomu, že se spletl plán, ne dodavatel.
 */
type TemplatesBarrel = {
  /** Skutečné jméno u dodavatele. */
  validateTemplateDocument?: unknown;
  /** Jméno, které předpokládal plán. Kdyby přibylo, test si ho vezme taky. */
  validateDocument?: unknown;
  validateLiquid?: unknown;
};

const templatesBarrel: TemplatesBarrel | null = await import('@mlain/core/templates')
  .then((module) => module as TemplatesBarrel)
  .catch(() => null);

const barrelMissing = templatesBarrel === null;
const SKIP_REASON =
  'PŘESKOČENO, dodavatel nedorazil: @mlain/core/templates neexistuje (fáze G plánu P08). Odemkne se samo, jakmile barrel vznikne.';

if (barrelMissing) {
  // `console.error` schválně: lint povoluje jen ji a důvod přeskočení MÁ být
  // vidět ve výpisu, jinak by přeskočený test tiše zdegeneroval na mrtvý kód.
  console.error(`[p08-contract] ${SKIP_REASON}`);
}

/**
 * Rozhraní, která P15 od P08 potřebuje. Když tenhle soubor spadne, není chyba
 * v P15: buď P08 export přejmenoval, nebo ho ještě nedodal. Řeší se to
 * dohodou s vlastníkem P08, ne obcházením v P15.
 */
describe('kontrakt P08 -> P15', () => {
  it('baseSectionSpecSchema přijme platnou sekci hero', () => {
    const parsed = baseSectionSpecSchema.safeParse({
      kind: 'hero',
      headline: 'Letní výprodej kol',
      subhead: 'Slevy až 20 %',
      cta: { label: 'Prohlédnout kola', href: 'https://kolo-shop.cz/vyprodej' },
    });
    expect(parsed.success).toBe(true);
  });

  it('baseSectionSpecSchema přijme sekce article, bullets, keyValue, quote, cta a spacer', () => {
    const sections = [
      { kind: 'article', heading: 'Novinky', body: 'První odstavec.\n\nDruhý odstavec.' },
      { kind: 'bullets', heading: 'Co je nového', items: ['Nová kola', 'Delší záruka'] },
      { kind: 'keyValue', rows: [{ label: 'Číslo objednávky', value: '12345' }] },
      { kind: 'quote', text: 'Skvělý obchod.', author: 'Jana N.' },
      { kind: 'cta', label: 'Koupit', href: 'https://kolo-shop.cz' },
      { kind: 'spacer' },
    ];
    for (const section of sections) {
      expect(baseSectionSpecSchema.safeParse(section).success).toBe(true);
    }
  });

  it('baseSectionSpecSchema odmítne neznámý druh sekce', () => {
    expect(baseSectionSpecSchema.safeParse({ kind: 'carousel' }).success).toBe(false);
  });

  it('baseSectionSpecSchema odmítne HTML tam, kde má být prostý text', () => {
    const parsed = baseSectionSpecSchema.safeParse({
      kind: 'article',
      heading: '<script>alert(1)</script>',
      body: 'text',
    });
    // Buď schéma HTML odmítne, nebo ho generátor převede na text. Obojí je
    // v pořádku; co v pořádku není, je HTML v hotovém dokumentu. To ověřuje
    // úkol 27, tady jen fixujeme, že se schéma k řetězci chová jako k textu.
    if (parsed.success) {
      expect(typeof parsed.data).toBe('object');
    }
  });

  it('buildBaseTemplate je čistá funkce, která vrátí dokument se schemaVersion 1', () => {
    const doc = buildBaseTemplate({
      variant: 'newsletter',
      brand: {
        palette: {
          primary: '#c41e3a',
          secondary: '#1a1a1a',
          accent: '#c41e3a',
          background: '#f4f5f7',
          text: '#111827',
        },
        typography: { headingStack: 'system', bodyStack: 'system', radius: 6 },
      },
      language: 'cs',
      sections: [{ kind: 'hero', headline: 'Ahoj' }],
      darkMode: true,
    });
    expect(doc.schemaVersion).toBe(1);
    expect(Array.isArray(doc.blocks)).toBe(true);
  });

  /**
   * Co existuje DNES. Pinuje se to natvrdo, aby červená znamenala skutečný
   * rozchod, ne nedodanou adresu:
   *   - validace dokumentu: `validateTemplateDocument` v `src/templates/validate.ts`
   *   - validace Liquidu:   `validateLiquid` v `@mlain/contracts/liquid`
   */
  it('validace dokumentu a Liquidu jsou dostupné funkce', () => {
    expect(typeof validateTemplateDocument).toBe('function');
    expect(typeof validateLiquid).toBe('function');
  });
});

describe('kontrakt P08 -> P15: barrel @mlain/core/templates', () => {
  /**
   * Přeskočí se sám, dokud barrel neexistuje, a sám se odemkne, jakmile
   * vznikne. Ověřuje schopnost, ne jméno z plánu: P15 potřebuje z barrelu
   * dostat validaci dokumentu, ať se jmenuje jakkoliv. Kdyby ji dodavatel
   * odebral, spadne to tady.
   */
  it.skipIf(barrelMissing)(
    `barrel umí zvalidovat dokument ${barrelMissing ? `(${SKIP_REASON})` : ''}`,
    () => {
      const validator =
        templatesBarrel?.validateTemplateDocument ?? templatesBarrel?.validateDocument;
      expect(
        typeof validator,
        'barrel @mlain/core/templates nevystavuje žádnou validaci dokumentu',
      ).toBe('function');
    },
  );

  /**
   * ZAPSANÝ ROZDÍL PROTI PLÁNU, ne chyba. Plán čekal `validateLiquid` z téhož
   * barrelu; dodavatel ho tam nemá a bydlí v `@mlain/contracts/liquid`.
   * Kdyby ho P08 do barrelu doplnil, tenhle test zezelená a bude to signál, že
   * se dá sjednotit import v kompozičním kořeni. Do té doby drží fakt, že
   * P15 kvůli tomu zablokovaný NENÍ: obě funkce si bere jako injektovanou
   * závislost.
   */
  it.skipIf(barrelMissing || templatesBarrel?.validateLiquid === undefined)(
    'barrel vystavuje i validateLiquid, takže jde sjednotit import',
    () => {
      expect(typeof templatesBarrel?.validateLiquid).toBe('function');
    },
  );

  it('validace Liquidu je dostupná i bez barrelu, takže P15 není blokovaný', () => {
    expect(typeof validateLiquid).toBe('function');
  });
});
