import { describe, expect, it } from 'vitest';
import { BANNED_CS, BANNED_EN, findViolations } from './glossary';
import { loadMessages } from '../load-messages';

/** Dlouhá pomlčka. Zapsaná kódem, aby se samotný znak nedostal do repozitáře. */
const EM_DASH = String.fromCharCode(0x2014);

describe('slovník a zakázané znaky', () => {
  it('v žádném katalogu není dlouhá pomlčka U+2014', async () => {
    for (const locale of ['cs', 'en'] as const) {
      const raw = JSON.stringify(await loadMessages(locale));
      const index = raw.indexOf(EM_DASH);
      expect(index, `dlouhá pomlčka v ${locale} u znaku ${index}`).toBe(-1);
    }
  });

  it('český katalog neobsahuje zakázané výrazy ze slovníku 9.2', async () => {
    const violations = findViolations(await loadMessages('cs'), BANNED_CS);
    expect(violations.map((v) => `${v.key}: „${v.term}" místo „${v.use}"`)).toEqual([]);
  });

  it('anglický katalog neobsahuje zakázané výrazy', async () => {
    const violations = findViolations(await loadMessages('en'), BANNED_EN);
    expect(violations.map((v) => `${v.key}: "${v.term}" use "${v.use}"`)).toEqual([]);
  });

  it('nikde není hodnota subscribed jako stav přihlášení', async () => {
    for (const locale of ['cs', 'en'] as const) {
      const violations = findViolations(await loadMessages(locale), [
        // `exact` je tu nutné. Bez něj kontrola tolerovala koncovku (kvůli
        // českému skloňování), zkrátila term na `subscribe` a chytala ho
        // v každé větě typu „people subscribe to a list". Zakázaná je HODNOTA
        // stavu, ne sloveso.
        { term: 'subscribed', use: 'confirmed', except: [], exact: true },
      ]);
      expect(violations.map((v) => v.key)).toEqual([]);
    }
  });

  it('detektor najde zakázaný výraz i ve skloňovaném tvaru', () => {
    const violations = findViolations(
      { common: { demo: 'Nastavte pracovní prostor a přidejte odběratele.' } },
      BANNED_CS,
    );
    expect(violations).toHaveLength(2);
    expect(violations[0]?.key).toBe('common.demo');
  });

  it('výjimka podle prefixu klíče funguje', () => {
    const violations = findViolations({ common: { nav: { settingsAccount: 'Můj účet' } } }, [
      { term: 'účet', use: 'Projekt', except: ['common.nav.settingsAccount'] },
    ]);
    expect(violations).toEqual([]);
  });

  it('„Personalizace" je správný tvar a kontrola ho nehlásí', () => {
    // Rozhodnutí zadavatele 1. 8. 2026. Kdyby bylo slovo v zakázaném seznamu,
    // shodil by `i18n-check` build na katalogu `editor` plánu P12,
    // který ho používá správně.
    const violations = findViolations(
      { editor: { tokenTooltip: 'Personalizace vloží jméno kontaktu.' } },
      BANNED_CS,
    );
    expect(violations).toEqual([]);
  });

  it('staré tvary pro merge tag kontrola naopak hlásí', () => {
    const violations = findViolations(
      {
        editor: {
          a: 'Doplňovaný údaj',
          b: 'Vložte slučovací značku',
          c: 'merge tag',
          d: 'placeholder',
        },
      },
      BANNED_CS,
    );
    expect(violations.map((item) => item.key).sort()).toEqual([
      'editor.a',
      'editor.b',
      'editor.c',
      'editor.d',
    ]);
    expect(new Set(violations.map((item) => item.use))).toEqual(new Set(['Personalizace']));
  });
});
