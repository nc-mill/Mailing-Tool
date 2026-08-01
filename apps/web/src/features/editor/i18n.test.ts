import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import cs from '@mlain/i18n/messages/cs/editor.json';
import en from '@mlain/i18n/messages/en/editor.json';
import { ISSUE_CODES } from './model/issue-codes';

const flatten = (value: unknown, prefix = ''): string[] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, child]) =>
        flatten(child, prefix ? `${prefix}.${key}` : key),
      )
    : [prefix];

const values = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : typeof value === 'object' && value !== null
      ? Object.values(value).flatMap(values)
      : [];

/** Dvojice klíč a hodnota. Klíč je v hlášce testu, jinak se hledá jehla v kupce sena. */
const pairs = (value: unknown, prefix = ''): Array<[string, string]> =>
  typeof value === 'string'
    ? [[prefix, value]]
    : typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, child]) =>
          pairs(child, prefix ? `${prefix}.${key}` : key),
        )
      : [];

describe('katalog editor', () => {
  it('má v obou jazycích tytéž klíče, kritérium 70 části 6', () => {
    expect(flatten(cs).sort()).toEqual(flatten(en).sort());
  });

  it('neobsahuje dlouhou pomlčku, kritérium 68 části 6', () => {
    for (const text of [...values(cs), ...values(en)]) expect(text).not.toContain('—');
  });

  it('pro merge tag používá slovo Personalizace, ne zakázané varianty, rozhodnutí R10', () => {
    const czech = values(cs).join(' ').toLowerCase();
    expect(czech).toContain('personalizace');
    for (const forbidden of [
      'doplňovaný údaj',
      'slučovací značk',
      'merge tag',
      'placeholder',
      'proměnná',
    ]) {
      expect(czech, forbidden).not.toContain(forbidden);
    }
  });

  it('nepoužívá zakázané tvary tlačítek ze slovníku 9.3 části 6', () => {
    const czech = values(cs);
    for (const forbidden of [
      'OK',
      'Potvrdit',
      'Odeslat formulář',
      'Submit',
      'Done',
      'Next',
      'Finish',
    ]) {
      expect(czech, forbidden).not.toContain(forbidden);
    }
  });

  it('počty používají ICU plural včetně kategorie =0, kritérium 72 části 6', () => {
    for (const key of ['issues.errorCount', 'issues.warningCount', 'block.socialCount']) {
      const message = key
        .split('.')
        .reduce<never>((value, part) => (value as never)[part], cs as never) as unknown as string;
      expect(message, key).toMatch(/plural/);
      expect(message, key).toMatch(/=0/);
    }
  });

  it('každý český plural má i kategorii many, jinak spadne i18n-check', () => {
    // Kritérium 72 mluví o `=0`, ale to nestačí. V češtině je `many` kategorie
    // pro desetinná čísla (1,5 chyby) a kontrola `icu-validity.test.ts` z P05 ji
    // vyžaduje u každého plurálu. Bez ní spadne job `i18n-check` a s ním build,
    // a to až v CI, ne tady. Tenhle případ ho chytí v jednotkovém běhu plánu.
    const missing: string[] = [];
    for (const [key, value] of pairs(cs)) {
      if (!value.includes(', plural,')) continue;
      for (const category of ['=0 {', 'one {', 'few {', 'many {', 'other {']) {
        if (!value.includes(category)) missing.push(`${key} postrádá ${category.trim()}`);
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('anglický plural má =0, one i other', () => {
    const missing: string[] = [];
    for (const [key, value] of pairs(en)) {
      if (!value.includes(', plural,')) continue;
      for (const category of ['=0 {', 'one {', 'other {']) {
        if (!value.includes(category)) missing.push(`${key} postrádá ${category.trim()}`);
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('desetinné číslo v češtině dá tvar many, ne tvar pro pět a víc', () => {
    // Ostrá kontrola, ne jen přítomnost kategorie: `many {# chyb}` by testem
    // výš prošlo a přitom je špatně česky.
    const format = new IntlMessageFormat(cs.issues.errorCount, 'cs');
    expect(format.format({ count: 1 })).toBe('1 chyba');
    expect(format.format({ count: 2 })).toBe('2 chyby');
    expect(format.format({ count: 5 })).toBe('5 chyb');
    expect(format.format({ count: 1.5 })).toBe('1,5 chyby');
  });

  it('každá zpráva se dá zkompilovat jako ICU', () => {
    const broken: string[] = [];
    for (const [locale, tree] of [
      ['cs', cs],
      ['en', en],
    ] as const) {
      for (const [key, value] of pairs(tree)) {
        try {
          new IntlMessageFormat(value, locale);
        } catch (error) {
          broken.push(`${locale} ${key}: ${(error as Error).message}`);
        }
      }
    }
    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('neporuší slovník 9.2, který hlídá brána P05', () => {
    // Zkrácený seznam `BANNED_CS` z `packages/i18n/src/checks/glossary.ts`.
    // Kopie je vědomá: kontrola P05 běží nad složeným stromem až v CI, tenhle
    // případ chytí porušení při psaní katalogu. Slovo „personalizace" v seznamu
    // **není a být nesmí**, je to závazný český název (rozhodnutí R10 a R17).
    //
    // Porovnává se proti celé zprávě včetně jmen ICU slotů, protože přesně tak
    // to `findViolations` dnes dělá. Slot pojmenovaný `{workspace}` by tedy
    // shodil bránu na jinak správně napsaném textu; tenhle plán žádný takový nemá.
    const banned = [
      'pracovní prostor',
      'workspace',
      'odběratel',
      'blacklist',
      'černá listina',
      'pískoviště',
      'kvóta',
      'placeholder',
      'slučovací značka',
      'doplňovaný údaj',
      'merge tag',
      'preference centrum',
      'dvojité přihlášení',
      'unikátní otevření',
      'trackování',
      'prokliková míra',
      'odregistrovat',
      'zaregistrovat',
      'joba',
      'háček',
      'administrátor',
      'majitel',
    ];
    const violations: string[] = [];
    for (const [key, value] of pairs(cs)) {
      for (const term of banned) {
        if (value.toLocaleLowerCase('cs').includes(term)) violations.push(`${key}: ${term}`);
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('má text ke každému kódu nálezu, který klientská validace umí vyrobit', () => {
    // Bez toho by pruh nálezů ukazoval holý kód typu `content_low_contrast`.
    for (const code of ISSUE_CODES) {
      expect(cs.issue, code).toHaveProperty(code);
    }
  });
});
