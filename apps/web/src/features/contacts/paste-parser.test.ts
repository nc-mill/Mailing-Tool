import { describe, expect, it } from 'vitest';
import { parsePastedContacts } from './paste-parser';

describe('rozbor dávky kontaktů vložené textem', () => {
  it('rozebere tvar ze zadání včetně koncového středníku na prvním řádku', () => {
    // Přesně ten text, který je v zadání: první řádek končí středníkem, druhý ne.
    const result = parsePastedContacts(
      'email@example.com; Jmeno; Prijmeni;\ndruhykontakt@example.com; Jmeno; Prijmeni',
    );

    expect(result.problems).toEqual([]);
    expect(result.duplicates).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      lineNumber: 1,
      email: 'email@example.com',
      firstName: 'Jmeno',
      lastName: 'Prijmeni',
    });
    expect(result.rows[1]).toMatchObject({
      lineNumber: 2,
      email: 'druhykontakt@example.com',
      firstName: 'Jmeno',
      lastName: 'Prijmeni',
    });
  });

  it('koncový oddělovač neudělá ze jména prázdnou hodnotu', () => {
    // `a@b.cz;` nesmí znamenat „jméno je prázdné", jinak by import u režimu
    // přepisu smazal jméno, které kontakt v projektu už má.
    const result = parsePastedContacts('a@example.com;\nb@example.com;;;');

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.firstName).toBe('');
    expect(result.rows[0]?.lastName).toBe('');
    expect(result.rows[1]?.firstName).toBe('');
  });

  it('vezme řádek, na kterém je jen adresa', () => {
    const result = parsePastedContacts('sam@example.com');

    expect(result.problems).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ email: 'sam@example.com', firstName: '', lastName: '' });
  });

  it('vezme řádek s adresou a jménem, ale bez příjmení', () => {
    const result = parsePastedContacts('jen.jmeno@example.com; Jana');

    expect(result.rows[0]).toMatchObject({ firstName: 'Jana', lastName: '' });
  });

  it('bere čárku i tabulátor jako oddělovač a odmazává mezery okolo položek', () => {
    const result = parsePastedContacts(
      'carka@example.com , Jana , Nováková\ntabulator@example.com\tPetr\tNovák',
    );

    expect(result.problems).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      email: 'carka@example.com',
      firstName: 'Jana',
      lastName: 'Nováková',
    });
    expect(result.rows[1]).toMatchObject({
      email: 'tabulator@example.com',
      firstName: 'Petr',
      lastName: 'Novák',
    });
  });

  it('čtvrtou a další položku zahodí', () => {
    const result = parsePastedContacts('kdo@example.com; Jana; Nováková; 777123456; poznámka');

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ firstName: 'Jana', lastName: 'Nováková' });
  });

  it('adresu s velkými písmeny převede na malá', () => {
    const result = parsePastedContacts('Petr.Novak@Example.COM; Petr');

    expect(result.rows[0]?.email).toBe('petr.novak@example.com');
  });

  it('velká a malá písmena nedělají dva kontakty, ale duplicitu', () => {
    // Bez převodu na malá písmena by tyhle dva řádky prošly jako dva kontakty
    // a server by z nich stejně udělal jeden. Souhrn by tím lhal o počtu.
    const result = parsePastedContacts('petr@example.com\nPETR@Example.com');

    expect(result.rows).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]).toMatchObject({
      lineNumber: 2,
      email: 'petr@example.com',
      firstSeenLine: 1,
    });
  });

  it('u duplicity vyhrává první výskyt a druhý se hlásí s číslem řádku', () => {
    const result = parsePastedContacts(
      'jana@example.com; Jana; Nováková\njana@example.com; Jana; Svobodová',
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.lastName).toBe('Nováková');
    expect(result.duplicates[0]).toMatchObject({
      lineNumber: 2,
      raw: 'jana@example.com; Jana; Svobodová',
      firstSeenLine: 1,
    });
  });

  it('neplatná adresa jde do chyb s číslem řádku i obsahem', () => {
    const result = parsePastedContacts('tohle-neni-adresa; Jana');

    expect(result.rows).toEqual([]);
    expect(result.problems).toEqual([
      { lineNumber: 1, raw: 'tohle-neni-adresa; Jana', code: 'invalid_email' },
    ]);
  });

  it('chybný řádek nezastaví ty ostatní', () => {
    // Jádro zadání: jeden zkažený řádek uprostřed nesmí shodit celou dávku.
    const result = parsePastedContacts(
      'prvni@example.com; Jana\nrozbite@\ntreti@example.com; Petr\n@example.com\npate@example.com',
    );

    expect(result.rows.map((row) => row.lineNumber)).toEqual([1, 3, 5]);
    expect(result.problems.map((problem) => problem.lineNumber)).toEqual([2, 4]);
  });

  it('řádek bez adresy na prvním místě hlásí chybějící adresu', () => {
    const result = parsePastedContacts('; Jana; Nováková');

    expect(result.problems).toEqual([
      { lineNumber: 1, raw: '; Jana; Nováková', code: 'email_missing' },
    ]);
  });

  it('příliš dlouhá adresa má vlastní kód, ne obecnou neplatnost', () => {
    const long = `${'a'.repeat(250)}@example.com`;
    const result = parsePastedContacts(long);

    expect(result.problems[0]?.code).toBe('email_too_long');
  });

  it('prázdné řádky se přeskočí bez hlášení a nepokazí číslování', () => {
    const result = parsePastedContacts('\n\nprvni@example.com\n   \n\t\ndruhy@example.com\n\n\n');

    expect(result.problems).toEqual([]);
    expect(result.duplicates).toEqual([]);
    // Čísla řádků odpovídají tomu, co uživatel vidí v textovém poli.
    expect(result.rows.map((row) => row.lineNumber)).toEqual([3, 6]);
  });

  it('zvládne konce řádků z Windows i ze starého Macu', () => {
    const result = parsePastedContacts('a@example.com\r\nb@example.com\rc@example.com');

    expect(result.rows.map((row) => row.email)).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
    ]);
  });

  it('rozbalí adresu zkopírovanou z poštovního klienta', () => {
    const result = parsePastedContacts('Jan Novák <jan@example.com>');

    expect(result.problems).toEqual([]);
    expect(result.rows[0]?.email).toBe('jan@example.com');
  });

  it('odmítne adresu s vadnou doménou', () => {
    const result = parsePastedContacts(
      'a@example\nb@.example.com\nc@example..com\nd@example.com.\n@example.com\ne@@example.com',
    );

    expect(result.rows).toEqual([]);
    expect(result.problems.map((problem) => problem.lineNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('prázdný text nedá ani řádek, ani chybu', () => {
    expect(parsePastedContacts('')).toEqual({ rows: [], problems: [], duplicates: [] });
    expect(parsePastedContacts('   \n\n  \n')).toEqual({
      rows: [],
      problems: [],
      duplicates: [],
    });
  });

  it('neviditelná značka pořadí bajtů na začátku textu nerozbije první adresu', () => {
    const result = parsePastedContacts(`${String.fromCharCode(0xfeff)}prvni@example.com; Jana`);

    expect(result.problems).toEqual([]);
    expect(result.rows[0]?.email).toBe('prvni@example.com');
  });

  it('nedělitelná mezera okolo adresy se ořízne stejně jako obyčejná', () => {
    const nbsp = String.fromCharCode(0x00a0);
    const result = parsePastedContacts(`${nbsp}mezera@example.com${nbsp}; Jana`);

    expect(result.problems).toEqual([]);
    expect(result.rows[0]?.email).toBe('mezera@example.com');
  });
});
