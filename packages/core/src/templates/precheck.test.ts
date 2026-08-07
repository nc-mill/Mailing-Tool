import { describe, expect, it } from 'vitest';
import { FINDING_CODES } from '../errors/registry';
import { assertSendable, PreSendBlockedError, preSendCheck, type PreSendInput } from './precheck';

const meta = (over: Record<string, unknown> = {}) =>
  ({
    htmlBytes: 50_000,
    links: [{ id: 'a', position: 1, url: 'https://a.cz', trackable: true, label: 'A' }],
    assetIds: [],
    warnings: [],
    hasUnsubscribeLink: true,
    clickMarkerCount: 1,
    hasOpenPixelSlot: true,
    ...over,
  }) as PreSendInput['compileMeta'];

const input = (over: Record<string, unknown> = {}) =>
  ({
    compileMeta: meta(),
    validationIssues: [],
    subject: 'Předmět',
    preheader: 'Preheader',
    appUrl: 'https://mail.example.com',
    emptyFieldRatios: [],
    ...over,
  }) as PreSendInput;

const codes = (over: Record<string, unknown> = {}) =>
  preSendCheck(input(over)).findings.map((f) => f.code);

describe('preSendCheck', () => {
  it('passes a healthy campaign', () => {
    const result = preSendCheck(input());
    expect(result.blocking).toBe(false);
    expect(result.findings).toEqual([]);
  });

  it('blocks when the template did not validate', () => {
    const result = preSendCheck(
      input({
        validationIssues: [
          { code: 'content_nested_columns', severity: 'error', pointer: '', path: '' },
        ],
      }),
    );
    expect(result.blocking).toBe(true);
    expect(result.findings.map((f) => f.code)).toContain('precheck_template_invalid');
  });

  it('blocks a missing unsubscribe link', () => {
    expect(codes({ compileMeta: meta({ hasUnsubscribeLink: false }) })).toContain(
      'precheck_missing_unsubscribe',
    );
  });

  it('warns above 80 kB and blocks above 102 kB', () => {
    expect(
      preSendCheck(input({ compileMeta: meta({ htmlBytes: 90_000 }) })).findings.find(
        (f) => f.code === 'precheck_html_large',
      )?.severity,
    ).toBe('warning');
    expect(preSendCheck(input({ compileMeta: meta({ htmlBytes: 110_000 }) })).blocking).toBe(true);
  });

  it('blocks an empty subject and only warns for an empty preheader', () => {
    expect(preSendCheck(input({ subject: '  ' })).blocking).toBe(true);
    const preheader = preSendCheck(input({ preheader: '' }));
    expect(preheader.blocking).toBe(false);
    expect(preheader.findings.map((f) => f.code)).toContain('precheck_preheader_empty');
  });

  it('warns about an insecure link', () => {
    expect(
      codes({
        compileMeta: meta({
          links: [{ id: 'a', position: 1, url: 'http://a.cz', trackable: true, label: 'A' }],
        }),
      }),
    ).toContain('precheck_insecure_link');
  });

  it('blocks a non public app url and names it in params', () => {
    for (const url of [
      'http://localhost:3000',
      'http://127.0.0.1',
      'http://192.168.1.10',
      'http://mail.local',
    ]) {
      const result = preSendCheck(input({ appUrl: url }));
      expect(result.blocking, url).toBe(true);
      expect(
        result.findings.find((f) => f.code === 'precheck_app_url_not_public')?.params?.app_url,
      ).toBe(url);
    }
  });

  it('warns with numbers when a field is empty for more than ten percent of recipients', () => {
    // ODCHYLKA OD PLÁNU v číslech, ne v chování. Plán psal 412 z 5000, což je
    // 8,24 %, tedy POD prahem, který sám implementuje (`value <= 0.1` se
    // přeskakuje). Práh 10 % je normativní, viz `docs/superpowers/specs/parts/
    // 03-obsah.md:2279` („U více než 10 % příjemců"), takže se opravila data
    // fixtury, ne mez. Ověřeno spuštěním: s původními čísly test padal na
    // `expected undefined to be "warning"`.
    const finding = preSendCheck(
      input({
        emptyFieldRatios: [
          { path: 'contact.first_name', empty: 824, total: 5000, hasDefault: false },
        ],
      }),
    ).findings.find((f) => f.code === 'precheck_empty_field_ratio');
    expect(finding?.severity).toBe('warning');
    expect(finding?.params).toEqual({
      path: 'contact.first_name',
      empty: 824,
      total: 5000,
      ratio: 0.1648,
    });
  });

  it('stays silent exactly at ten percent, the mez is "more than"', () => {
    expect(
      codes({
        emptyFieldRatios: [
          { path: 'contact.first_name', empty: 500, total: 5000, hasDefault: false },
        ],
      }),
    ).not.toContain('precheck_empty_field_ratio');
  });

  it('stays silent when the field has a fallback value', () => {
    // Čísla jsou nad prahem schválně: kdyby byla pod ním, test by procházel
    // i s rozbitým `hasDefault` a netestoval by nic.
    expect(
      codes({
        emptyFieldRatios: [
          { path: 'contact.first_name', empty: 824, total: 5000, hasDefault: true },
        ],
      }),
    ).not.toContain('precheck_empty_field_ratio');
  });

  it('forwards compile warnings as informational findings', () => {
    expect(
      codes({
        compileMeta: meta({
          warnings: [{ code: 'unknown_block_skipped', severity: 'warning', pointer: '' }],
        }),
      }),
    ).toContain('unknown_block_skipped');
  });
});

/**
 * BRÁNA: kód, který kontrola vydá, musí být v registru.
 *
 * Devět kódů `precheck_*` v registru dlouho chybělo, a nespadlo kvůli tomu nic:
 * kontrola je vydávala, API je posílalo v poli `findings` a editor je zobrazoval.
 * Uzavřený počet v `test/errors/registry.test.ts` proto hlídal jen část
 * skutečnosti. Tenhle test tu díru zavírá z druhé strany: nekontroluje počet,
 * kontroluje, že každý SKUTEČNĚ VYDANÝ kód registr zná.
 *
 * Vstup je schválně nejhorší možný, aby se vydaly všechny najednou. Kdyby někdo
 * přidal desátý kód a na registr zapomněl, spadne to tady.
 */
describe('registrace nálezů předodesílací kontroly', () => {
  it('vydá jen kódy, které jsou v registru vedené jako finding', () => {
    const worst = preSendCheck(
      input({
        compileMeta: meta({
          hasUnsubscribeLink: false,
          htmlBytes: 200_000,
          links: [{ id: 'a', position: 1, url: 'http://a.cz', trackable: true, label: 'A' }],
        }),
        validationIssues: [
          { code: 'content_nested_columns', severity: 'error', pointer: '', path: '' },
        ],
        subject: '  ',
        preheader: '',
        appUrl: 'http://localhost:3000',
        emptyFieldRatios: [{ path: 'attributes.city', empty: 9, total: 10, hasDefault: false }],
      }),
    );
    const emitted = worst.findings.map((finding) => finding.code);
    // Pojistka proti testu, který by prošel s prázdným seznamem.
    expect(emitted.length).toBeGreaterThan(5);
    const registered = new Set(FINDING_CODES.map((entry) => entry.code));
    expect(emitted.filter((code) => !registered.has(code))).toEqual([]);
  });

  it('má u každého kódu tutéž závažnost, jakou hlásí kontrola', () => {
    const bySeverity = new Map(FINDING_CODES.map((entry) => [entry.code, entry.severity]));
    const warnOnly = preSendCheck(
      input({ preheader: '', compileMeta: meta({ htmlBytes: 90_000 }) }),
    ).findings.filter((finding) => finding.code.startsWith('precheck_'));
    expect(warnOnly.length).toBeGreaterThan(0);
    for (const finding of warnOnly) {
      expect(bySeverity.get(finding.code), finding.code).toBe(finding.severity);
    }
  });
});

describe('assertSendable', () => {
  it('lets a healthy campaign through and hands back the findings', () => {
    expect(assertSendable(input()).blocking).toBe(false);
  });

  it('nechá projít kampaň, která má jen varování', () => {
    const result = assertSendable(input({ preheader: '' }));
    expect(result.findings.map((f) => f.code)).toContain('precheck_preheader_empty');
  });

  it('rozbitou šablonu NEPUSTÍ, i když se volající na blocking nepodívá', () => {
    // Tohle je celý smysl brány. `preSendCheck` sám vrací jen seznam, a seznam
    // se dá ignorovat. Odesílací cesta volá `assertSendable`, kde třetí možnost
    // než „projde" a „vyhodí" neexistuje.
    let caught: unknown;
    try {
      assertSendable(input({ compileMeta: meta({ hasUnsubscribeLink: false }) }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PreSendBlockedError);
    expect((caught as PreSendBlockedError).blockers.map((f) => f.code)).toEqual([
      'precheck_missing_unsubscribe',
    ]);
    // Nálezy putují s chybou, aby API mohlo vrátit, co se má opravit.
    expect((caught as PreSendBlockedError).result.findings.length).toBeGreaterThan(0);
  });
});
