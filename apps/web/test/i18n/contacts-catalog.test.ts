import { readFileSync } from 'node:fs';
import path from 'node:path';
import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';

// Odchylka od plánu: plán měl pět úrovní `..`, jenže tenhle soubor leží
// v `apps/web/test/i18n`, takže do kořene repozitáře vedou tři.
const MESSAGES_DIR = path.resolve(import.meta.dirname, '../../../../packages/i18n/messages');

function load(locale: 'cs' | 'en'): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(MESSAGES_DIR, locale, 'contacts.json'), 'utf8'),
  ) as Record<string, unknown>;
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

/** Dlouhá pomlčka. Zapsaná kódem, aby se samotný znak nedostal do repozitáře. */
const EM_DASH = String.fromCharCode(0x2014);

const cs = flatten(load('cs'));
const en = flatten(load('en'));

/**
 * Kategorie pluralu a selectu. Jejich obsah není slot, i když vypadá jako {jedno slovo}:
 * „=0 {dnů}" je text pro nulu, ne argument. Bez tohohle odstranění by test hlásil rozdíl
 * mezi jazyky pokaždé, když se česká a anglická nulová varianta liší jedním slovem.
 */
const ICU_CATEGORY = /(=\d+|zero|one|two|few|many|other|male|female)\s*\{[^{}]*\}/g;

/** Sloty ve zprávě, tedy {name}, {count, plural, ...} a {gender, select, ...}. */
function slots(message: string): string[] {
  let previous = message;
  let stripped = message.replace(ICU_CATEGORY, '');
  while (stripped !== previous) {
    previous = stripped;
    stripped = stripped.replace(ICU_CATEGORY, '');
  }
  // Množina, ne pole: {limit} uvnitř pěti větví pluralu je pořád jeden slot a čeština
  // s angličtinou ho mají v jiném počtu větví.
  return [...new Set([...stripped.matchAll(/\{(\w+)[,}]/g)].map((match) => match[1]!))].sort();
}

/** Argumenty pro vykreslení: číslo do slotu pluralu, řetězec všude jinde. */
function args(message: string, count: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const slot of slots(message)) out[slot] = 'x';
  const pluralSlot = message.match(/\{(\w+), plural,/)?.[1];
  if (pluralSlot) out[pluralSlot] = count;
  const selectSlot = message.match(/\{(\w+), select,/)?.[1];
  if (selectSlot) out[selectSlot] = 'other';
  return out;
}

describe('katalog contacts, zdroj pravdy je en', () => {
  it('má v obou jazycích stejnou množinu klíčů', () => {
    expect(Object.keys(cs).sort()).toEqual(Object.keys(en).sort());
  });

  it('žádný klíč není prázdný', () => {
    for (const [key, value] of Object.entries({ ...cs, ...en })) {
      expect(value.trim().length, `klíč ${key}`).toBeGreaterThan(0);
    }
  });

  it('neobsahuje dlouhou pomlčku', () => {
    for (const [key, value] of Object.entries({ ...cs, ...en })) {
      // U+2014 se zapisuje escapem, ne znakem: soubor s katalogem i tenhle test
      // procházejí kontrolou, která dlouhou pomlčku hledá v celém repozitáři.
      expect(value.includes(EM_DASH), `klíč ${key}`).toBe(false);
    }
  });

  it('nepoužívá hodnotu subscribed jako stav', () => {
    for (const [key, value] of Object.entries({ ...cs, ...en })) {
      expect(value, `klíč ${key}`).not.toMatch(/\bsubscribed\b/);
    }
  });

  it('český text neobsahuje zakázané výrazy ze slovníku 9.2 části 6', () => {
    // Jednoznačné výrazy. Nejednoznačná slova ("adresa" u kontaktu, "filtr" u segmentu,
    // "proklik" uvnitř slova "prokliku") sem nepatří: substringový test by je odmítl
    // i tam, kde jsou správně. Ty hlídá skript z 9.6 s kontextem a code review.
    const forbidden = [
      'pracovní prostor',
      'workspace',
      'blacklist',
      'černá listina',
      'seznam vyloučených',
      'double opt-in',
      'dvojité přihlášení',
      'odraz',
      'vokativ',
      'trackování',
      'administrátor',
      'přístupový klíč',
      'preference centrum',
      'merge tag',
      'placeholder',
    ];
    for (const [key, value] of Object.entries(cs)) {
      const lower = value.toLowerCase();
      for (const term of forbidden) {
        expect(lower.includes(term), `klíč ${key} obsahuje zakázaný výraz ${term}`).toBe(false);
      }
    }
  });

  it('každý řetězec je platný ICU výraz ve svém jazyce', () => {
    for (const [key, value] of Object.entries(cs)) {
      expect(() => new IntlMessageFormat(value, 'cs'), `cs ${key}`).not.toThrow();
    }
    for (const [key, value] of Object.entries(en)) {
      expect(() => new IntlMessageFormat(value, 'en'), `en ${key}`).not.toThrow();
    }
  });

  it('český plurál má =0, one, few, many i other', () => {
    for (const [key, value] of Object.entries(cs)) {
      if (!value.includes(', plural,')) continue;
      for (const category of ['=0', 'one', 'few', 'many', 'other']) {
        expect(value.includes(`${category} {`), `cs ${key} postrádá ${category}`).toBe(true);
      }
    }
  });

  it('anglický plurál má =0, one i other', () => {
    for (const [key, value] of Object.entries(en)) {
      if (!value.includes(', plural,')) continue;
      for (const category of ['=0', 'one', 'other']) {
        expect(value.includes(`${category} {`), `en ${key} postrádá ${category}`).toBe(true);
      }
    }
  });

  it('sloty jsou v obou jazycích stejné', () => {
    for (const key of Object.keys(cs)) {
      expect(slots(cs[key]!), `klíč ${key}`).toEqual(slots(en[key]!));
    }
  });

  it('český plurál se vykreslí pro 0, 1, 2, 5, 21, 100 a 1,5', () => {
    for (const [key, value] of Object.entries(cs)) {
      if (!value.includes(', plural,')) continue;
      const formatter = new IntlMessageFormat(value, 'cs');
      for (const count of [0, 1, 2, 5, 21, 100, 1.5]) {
        const rendered = String(formatter.format(args(value, count)));
        expect(rendered.trim(), `cs ${key} u ${count}`).not.toBe('');
        expect(rendered, `cs ${key} u ${count} nechal nevykreslený plurál`).not.toContain(
          'plural,',
        );
      }
    }
  });

  it('desetinné číslo spadne do kategorie many, ne do other', () => {
    const message = cs['selection.pageOnly']!;
    const formatter = new IntlMessageFormat(message, 'cs');
    expect(String(formatter.format({ count: 1.5 }))).toContain('kontaktu');
  });

  it('obsahuje klíče vyjmenované v kapitole 6.3 části 2', () => {
    for (const key of [
      'list.empty',
      'import.detected',
      'import.estimate',
      'import.doneWithErrors',
      'vocative.reviewBanner',
      'vocative.groupHint',
      'vocative.savedOverride',
      'suppressions.complaintLocked',
      'suppressions.bounceTooRecent',
      'public.unsubscribe.listScope',
      'public.unsubscribe.global',
      'public.unsubscribe.done',
      'public.preferences.masked',
      'privacy.gdpr.exportReady',
      'privacy.gdpr.eraseConfirm',
    ]) {
      expect(cs, `chybí ${key}`).toHaveProperty(key);
      expect(en, `chybí ${key}`).toHaveProperty(key);
    }
  });

  it('má text pro všech šest hodnot contacts.status a pro tři samostatné příznaky', () => {
    for (const status of [
      'active',
      'unconfirmed',
      'unsubscribed',
      'bounced',
      'complained',
      'deleted',
    ]) {
      expect(cs, status).toHaveProperty(`status.${status}`);
    }
    for (const flag of ['processingRestricted', 'snoozed', 'anonymized']) {
      expect(cs, flag).toHaveProperty(`flag.${flag}`);
    }
  });

  it('každý prázdný stav má nadpis, aspoň dvě věty vysvětlení a akci', () => {
    const emptyStates = [
      'list.empty',
      'suppressions.empty',
      'fields.empty',
      'tags.empty',
      'lists.empty',
      'forms.empty',
      'inbound.empty',
      'privacy.requests.empty',
      'vocative.empty',
    ];
    for (const base of emptyStates) {
      const title = cs[`${base}Title`];
      const body = cs[`${base}Body`];
      const action = cs[`${base}Action`];
      expect(title, `${base}Title`).toBeDefined();
      expect(body, `${base}Body`).toBeDefined();
      expect(action, `${base}Action`).toBeDefined();
      // Dvě věty poznáme podle dvou koncovek věty. Je to strukturální kontrola,
      // ne kontrola znění: přeformulování textu ji neshodí.
      expect(
        (body!.match(/[.!?]/g) ?? []).length,
        `${base}Body má míň než dvě věty`,
      ).toBeGreaterThanOrEqual(2);
    }
  });
});
