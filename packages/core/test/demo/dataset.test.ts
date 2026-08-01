import { describe, expect, it } from 'vitest';
import {
  DEMO_CAMPAIGN,
  DEMO_CONTACTS,
  DEMO_LISTS,
  DEMO_SEGMENTS,
  DEMO_TAGS,
  DEMO_TEMPLATES,
  demoCampaignSentAt,
} from '../../src/demo/dataset';
import {
  DEMO_SOURCE_REF,
  DEMO_SOURCE_REF_PATTERN,
  DEMO_SOURCE_REF_PREFIX,
} from '../../src/demo/manifest';
import { resolveName } from '../../src/contacts/naming/resolve';
import { EMPTY_OVERRIDES } from '../../src/contacts/naming/types';

describe('DEMO_CONTACTS', () => {
  it('má přesně 50 kontaktů podle rozhodnutí zadavatele', () => {
    expect(DEMO_CONTACTS).toHaveLength(50);
  });

  it('všechny adresy jsou na example.com, takže se na ně nedá nic doručit', () => {
    for (const c of DEMO_CONTACTS) expect(c.email).toMatch(/@example\.com$/);
  });

  it('adresy jsou unikátní', () => {
    expect(new Set(DEMO_CONTACTS.map((c) => c.email)).size).toBe(50);
  });

  it('obsahuje jména, na kterých je vidět vokativ a rod', () => {
    const full = DEMO_CONTACTS.map((c) =>
      `${c.titlePrefix ?? ''} ${c.firstName} ${c.lastName}`.trim(),
    );
    expect(full).toContain('Jana Nováková');
    expect(full).toContain('Ondřej Dvořák');
    expect(full).toContain('Ing. Petr Svoboda');
    expect(full).toContain('Lucie Černá');
  });

  it('u každého kontaktu je oslovení předpočítané a odpovídá rodu', () => {
    const jana = DEMO_CONTACTS.find((c) => c.email === 'jana.novakova@example.com')!;
    expect(jana.gender).toBe('female');
    expect(jana.greeting).toBe('Dobrý den, Jano');
    const ondrej = DEMO_CONTACTS.find((c) => c.firstName === 'Ondřej')!;
    expect(ondrej.greeting).toBe('Dobrý den, Ondřeji');
  });

  it('obsahuje aspoň jeden kontakt s neurčeným rodem a neutrálním oslovením', () => {
    const neutral = DEMO_CONTACTS.filter((c) => c.gender === 'unknown');
    expect(neutral.length).toBeGreaterThan(0);
    for (const c of neutral) expect(c.greeting).toBe('Dobrý den');
  });

  it('obsahuje kontakt bez křestního jména, aby byl vidět fallback', () => {
    expect(DEMO_CONTACTS.some((c) => c.firstName === null)).toBe(true);
  });

  it('všechny kontakty nesou zdroj demo-data:v1', () => {
    for (const c of DEMO_CONTACTS) expect(c.sourceRef).toBe('demo-data:v1');
  });

  it('obsahuje netriviální vokativy, ne jen jména s koncovkou -e', () => {
    // Právě na těchhle jménech uživatel pozná, jestli oslovení funguje.
    // Jana → Jano, Petr → Petře, Radek → Radku, Marek → Marku, Jiří → Jiří
    // (nemění se), Lucie a Marie taky ne, Tomáš → Tomáši.
    const greetings = new Set(DEMO_CONTACTS.map((c) => c.greeting));
    for (const expected of [
      'Dobrý den, Petře',
      'Dobrý den, Radku',
      'Dobrý den, Marku',
      'Dobrý den, Jiří',
      'Dobrý den, Lucie',
      'Dobrý den, Tomáši',
      'Dobrý den, Vojtěchu',
      'Dobrý den, Danieli',
      'Dobrý den, Zdeňku',
    ]) {
      expect(greetings.has(expected), expected).toBe(true);
    }
  });
});

/**
 * Nejdůležitější blok celé sady. Ukázková data jsou to jediné místo, kde uživatel
 * na vlastní oči uvidí, jestli oslovení funguje, takže předpočítané `greeting`
 * NESMÍ být ruční text vedle algoritmu. Tenhle test pouští skutečný `resolveName`
 * z domény kontaktů (P07) nad každým jménem sady a porovnává výsledek s tím, co je
 * v souboru napsané. Když se algoritmus vokativu rozejde s daty, spadne to tady,
 * ne až u zákazníka na obrazovce.
 */
describe('jména sady projdou skutečným vokativem z domény kontaktů', () => {
  const ctx = {
    overrides: EMPTY_OVERRIDES,
    settings: {
      addressForm: 'formal' as const,
      salutationBy: 'first_name' as const,
      vocativePolicy: 'strict' as const,
    },
  };

  it('u každého kontaktu sedí oslovení i rod s výstupem resolveName', () => {
    const mismatches: string[] = [];
    for (const contact of DEMO_CONTACTS) {
      const result = resolveName(
        {
          firstName: contact.firstName,
          lastName: contact.lastName,
          titlePrefix: contact.titlePrefix,
          locale: 'cs',
        },
        ctx,
      );
      if (result.greeting !== contact.greeting) {
        mismatches.push(`${contact.email}: ${result.greeting} != ${contact.greeting}`);
      }
      if (result.gender !== contact.gender) {
        mismatches.push(`${contact.email}: rod ${result.gender} != ${contact.gender}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('u nejistého vokativu zůstane oslovení neutrální, i když je rod známý', () => {
    // Robin Novotný: rod se odvodí z příjmení, vokativ křestního jména ne.
    // Přísná politika radši neosloví, než aby oslovila špatně, a přesně tohle
    // má být v ukázkových datech vidět.
    const robin = DEMO_CONTACTS.find((c) => c.email === 'robin.novotny@example.com')!;
    const result = resolveName(
      { firstName: robin.firstName, lastName: robin.lastName, locale: 'cs' },
      ctx,
    );
    expect(result.gender).toBe('male');
    expect(result.vocativeConfidence).toBe('low');
    expect(result.greeting).toBe('Dobrý den');
    expect(robin.greeting).toBe('Dobrý den');
  });

  it('u ženských jmen vzniká vokativ s vysokou jistotou, ne fallback na nominativ', () => {
    const jana = DEMO_CONTACTS.find((c) => c.email === 'jana.novakova@example.com')!;
    const result = resolveName(
      { firstName: jana.firstName, lastName: jana.lastName, locale: 'cs' },
      ctx,
    );
    expect(result.firstNameVocative).toBe('Jano');
    expect(result.vocativeConfidence).toBe('high');
  });
});

describe('zbytek sady', () => {
  it('má 3 seznamy, 4 štítky, 2 segmenty, 2 šablony a 1 kampaň', () => {
    expect(DEMO_LISTS).toHaveLength(3);
    expect(DEMO_TAGS).toHaveLength(4);
    expect(DEMO_SEGMENTS).toHaveLength(2);
    expect(DEMO_TEMPLATES).toHaveLength(2);
    expect(DEMO_CAMPAIGN.subject.length).toBeGreaterThan(0);
  });

  it('kampaň má report s otevřeními, kliky, dvěma nedoručeními a jednou stížností', () => {
    // Dvě nedoručení dohromady, ale rozdělená: campaign_stats má
    // `bounced_hard` a `bounced_soft`, sloupec `bounced` neexistuje.
    // Jedno tvrdé a jedno měkké je navíc věrnější než dvě stejná.
    const { bouncedHard, bouncedSoft } = DEMO_CAMPAIGN.stats;
    expect(bouncedHard + bouncedSoft).toBe(2);
    expect(DEMO_CAMPAIGN.stats.complained).toBe(1);
    expect(DEMO_CAMPAIGN.stats.openedUnique).toBeGreaterThan(0);
    expect(DEMO_CAMPAIGN.stats.clickedUnique).toBeGreaterThan(0);
  });

  it('součty reportu nepřesahují počet příjemců', () => {
    const { sent, openedUnique, clickedUnique, bouncedHard, bouncedSoft, complained } =
      DEMO_CAMPAIGN.stats;
    expect(sent).toBeLessThanOrEqual(DEMO_CONTACTS.length);
    expect(openedUnique + bouncedHard + bouncedSoft).toBeLessThanOrEqual(sent);
    expect(clickedUnique).toBeLessThanOrEqual(openedUnique);
    expect(complained).toBeLessThanOrEqual(sent);
  });

  it('každý štítek, seznam a šablona má klíč, na který se dá odkázat', () => {
    // `key` je jen vazba uvnitř sady, do databáze nejde. Kdyby chyběl,
    // seed by nedohledal štítek kontaktu ani šablonu kampaně a vložil by NULL.
    for (const item of [...DEMO_TAGS, ...DEMO_LISTS, ...DEMO_TEMPLATES, ...DEMO_SEGMENTS]) {
      expect(item.key).toMatch(/^[a-z0-9-]+$/);
    }
    const templateKeys = DEMO_TEMPLATES.map((t) => t.key);
    expect(templateKeys).toContain(DEMO_CAMPAIGN.templateKey);
    const tagKeys = new Set(DEMO_TAGS.map((t) => t.key));
    const listKeys = new Set(DEMO_LISTS.map((l) => l.key));
    for (const contact of DEMO_CONTACTS) {
      for (const k of contact.tagKeys) expect(tagKeys.has(k)).toBe(true);
      for (const k of contact.listKeys) expect(listKeys.has(k)).toBe(true);
    }
  });

  it('štítek Ukázková data je v sadě, protože na něm stojí hromadný výběr', () => {
    expect(DEMO_TAGS.map((t) => t.name)).toContain('Ukázková data');
  });

  it('štítek Ukázková data nese úplně každý kontakt sady', () => {
    // Hromadný výběr v tabulce jede přes tenhle štítek. Kontakt bez něj by
    // se filtrem nedal vybrat a uživatel by ho v tabulce nenašel.
    for (const contact of DEMO_CONTACTS) {
      expect(contact.tagKeys, contact.email).toContain('ukazkova-data');
    }
  });
});

describe('konvence source_ref, na které stojí ochrana publika v P13', () => {
  // Tenhle blok je smlouva s P13. Vynucení ochrany „ukázkové kontakty nejdou
  // do publika kampaně" leží v materializaci publika, tedy v souborech P13,
  // ale konvenci vlastní tenhle plán. Testy se proto ptají konstant, které
  // P13 importuje, ne našeho seedu.

  it('značka i vzor stojí na jednom prefixu, ne na dvou opsaných řetězcích', () => {
    expect(DEMO_SOURCE_REF.startsWith(DEMO_SOURCE_REF_PREFIX)).toBe(true);
    expect(DEMO_SOURCE_REF_PATTERN).toBe(`${DEMO_SOURCE_REF_PREFIX}%`);
  });

  it('vzor chytí i budoucí pokolení sady, ne jen v1', () => {
    // Ochrana nesmí přestat platit tím, že se vydá demo-data:v2.
    const like = (value: string) =>
      new RegExp(`^${DEMO_SOURCE_REF_PATTERN.replace('%', '.*')}$`).test(value);
    expect(like('demo-data:v1')).toBe(true);
    expect(like('demo-data:v2')).toBe(true);
    expect(like('demo-data:v10')).toBe(true);
    // A nesmí chytit cizí značky, jinak by vyhodila skutečné kontakty z publika.
    expect(like('import:2026-07')).toBe(false);
    expect(like('demo')).toBe(false);
    expect(like('')).toBe(false);
  });

  it('seed značkuje kontakty tak, aby je ten vzor našel', () => {
    expect(DEMO_SOURCE_REF).toMatch(/^demo-data:v\d+$/);
  });
});

describe('demoCampaignSentAt', () => {
  it('běžně datuje kampaň tři dny zpět', () => {
    const now = new Date('2026-08-20T10:00:00.000Z');
    expect(demoCampaignSentAt(now).toISOString()).toBe('2026-08-17T10:00:00.000Z');
  });

  it('na začátku měsíce ořízne na první den měsíce, aby se trefil do partition', () => {
    const now = new Date('2026-08-01T10:00:00.000Z');
    expect(demoCampaignSentAt(now).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('nikdy nevrátí datum z minulého měsíce', () => {
    for (const day of [1, 2, 3, 4, 15, 28]) {
      const now = new Date(Date.UTC(2026, 7, day, 6, 0, 0));
      expect(demoCampaignSentAt(now).getUTCMonth()).toBe(7);
    }
  });
});
