import { describe, expect, it } from 'vitest';
import { checkDkim } from '../dns/dkim';
import { checkDmarc } from '../dns/dmarc';
import { checkMx } from '../dns/mx';
import { runDomainChecks } from '../dns/check-domain';

function res(map: Record<string, string[] | Error>) {
  return {
    resolveCname: async (h: string) => {
      const v = map[h];
      if (!v) throw Object.assign(new Error(), { code: 'ENOTFOUND' });
      if (v instanceof Error) throw v;
      return v;
    },
    resolveTxt: async (h: string) => {
      const v = map[h];
      if (!v) throw Object.assign(new Error(), { code: 'ENOTFOUND' });
      if (v instanceof Error) throw v;
      return (v as string[]).map((x) => [x]);
    },
    resolveMx: async (h: string) => {
      const v = map[h];
      if (!v) throw Object.assign(new Error(), { code: 'ENOTFOUND' });
      return (v as string[]).map((x) => ({ exchange: x, priority: 10 }));
    },
    resolveNs: async () => [],
  };
}

const tokens = ['a1', 'b2', 'c3'];
const zone = 'dkim.amazonses.com';
const all = Object.fromEntries(
  tokens.map((t) => [`${t}._domainkey.example.cz`, [`${t}.${zone}.`]]),
);

describe('DKIM', () => {
  it('vsechny tri sedi: ok true, found 3', async () => {
    const r = await checkDkim(res(all), { domain: 'example.cz', tokens, hostedZone: zone });
    expect(r).toMatchObject({ ok: true, found: 3, expected: 3 });
  });

  it('dva ze tri: ok false s poctem', async () => {
    const partial = { ...all };
    delete partial['c3._domainkey.example.cz'];
    const r = await checkDkim(res(partial), { domain: 'example.cz', tokens, hostedZone: zone });
    expect(r).toMatchObject({ ok: false, found: 2 });
    expect(r.findings[0]!.code).toBe('dkim_partial');
  });

  it('CNAME miri jinam: dkim_wrong_value s ocekavanou hodnotou', async () => {
    const wrong = { ...all, 'a1._domainkey.example.cz': ['a1.jiny.provider.com'] };
    const r = await checkDkim(res(wrong), { domain: 'example.cz', tokens, hostedZone: zone });
    expect(r.findings.some((f) => f.code === 'dkim_wrong_value')).toBe(true);
  });

  it('zdvojeny nazev se hlasi jmenovite', async () => {
    const doubled = { ...all, 'a1._domainkey.example.cz.example.cz': [`a1.${zone}`] };
    delete (doubled as Record<string, unknown>)['a1._domainkey.example.cz'];
    const r = await checkDkim(res(doubled), { domain: 'example.cz', tokens, hostedZone: zone });
    expect(r.findings.some((f) => f.code === 'dkim_name_duplicated')).toBe(true);
  });

  it('SERVFAIL vraci null a uz overena domena zustava pouzitelna', async () => {
    const err = Object.assign(new Error(), { code: 'SERVFAIL' });
    const r = await checkDkim(res({ 'a1._domainkey.example.cz': err }), {
      domain: 'example.cz',
      tokens,
      hostedZone: zone,
    });
    expect(r.ok).toBeNull();
  });
});

describe('DMARC', () => {
  it('chybejici zaznam je false a cervena', async () => {
    const r = await checkDmarc(res({}), 'example.cz');
    expect(r).toMatchObject({ ok: false, policy: null });
  });

  it('p=none je ok true, ale zluta', async () => {
    const r = await checkDmarc(res({ '_dmarc.example.cz': ['v=DMARC1; p=none'] }), 'example.cz');
    expect(r).toMatchObject({ ok: true, policy: 'none', color: 'yellow' });
  });

  it('p=quarantine je zelena', async () => {
    const r = await checkDmarc(
      res({ '_dmarc.example.cz': ['v=DMARC1; p=quarantine'] }),
      'example.cz',
    );
    expect(r.color).toBe('green');
  });

  it('pct pod 100 je zluta', async () => {
    const r = await checkDmarc(
      res({ '_dmarc.example.cz': ['v=DMARC1; p=reject; pct=50'] }),
      'example.cz',
    );
    expect(r).toMatchObject({ pct: 50, color: 'yellow' });
  });

  it('dva zaznamy jsou chyba', async () => {
    const r = await checkDmarc(
      res({ '_dmarc.example.cz': ['v=DMARC1; p=none', 'v=DMARC1; p=reject'] }),
      'example.cz',
    );
    expect(r.findings[0]!.code).toBe('dmarc_multiple_records');
  });

  it('organizational domain se urcuje pres psl', async () => {
    const r = await checkDmarc(
      res({ '_dmarc.example.cz': ['v=DMARC1; p=none'] }),
      'mail.example.cz',
    );
    expect(r.ok).toBe(true);
  });

  /*
   * Nas text v tabulce je DOPORUCENI, ne predpis. Kazda platna politika musi projit,
   * at uz ma jine `rua`, jine `pct`, jina zarovnani nebo tagy navic. Presna shoda
   * s doporucenym retezcem se nikde nevyzaduje a vyzadovat nesmi.
   */
  describe('jina platna politika nez nase doporuceni', () => {
    const doporuceni = 'v=DMARC1; p=none; rua=mailto:dmarc@example.cz; pct=100; adkim=r; aspf=r';

    it.each([
      'v=DMARC1; p=reject; rua=mailto:postmaster@jinam.cz; adkim=s; aspf=s',
      'v=DMARC1; p=quarantine; sp=none; fo=1; ri=86400; rf=afrf',
      'v=DMARC1;p=reject;rua=mailto:a@b.cz,mailto:c@d.cz;ruf=mailto:f@b.cz',
      'v=DMARC1; p=quarantine',
      'v=dmarc1; p=REJECT',
    ])('%s projde', async (record) => {
      const r = await checkDmarc(res({ '_dmarc.example.cz': [record] }), 'example.cz');
      expect(r.ok).toBe(true);
      expect(r.findings.filter((f) => f.severity === 'error')).toEqual([]);
      expect(record).not.toBe(doporuceni);
    });

    it('pct pod 100 je jen rada, zaznam zustava platny', async () => {
      const r = await checkDmarc(
        res({ '_dmarc.example.cz': ['v=DMARC1; p=reject; pct=20; adkim=s'] }),
        'example.cz',
      );
      expect(r.ok).toBe(true);
      expect(r.findings.every((f) => f.severity === 'warning')).toBe(true);
    });

    it('zivy zaznam brevio.cz z dig +short TXT _dmarc.brevio.cz je platny', async () => {
      const live = 'v=DMARC1; p=none; rua=mailto:dmarc@brevio.cz; pct=100; adkim=r; aspf=r';
      const r = await checkDmarc(res({ '_dmarc.brevio.cz': [live] }), 'brevio.cz');
      expect(r).toMatchObject({ ok: true, policy: 'none', pct: 100 });
      // Jediny nalez je rada k p=none a nese nalezenou hodnotu, aby ji obrazovka
      // mohla ukazat. Neni to „zaznam ma jinou hodnotu".
      expect(r.findings).toEqual([
        { code: 'dmarc_policy_none', severity: 'warning', params: { actual: live } },
      ]);
    });
  });

  it('aspf=s bez vlastni MAIL FROM hlasi alignment', async () => {
    const r = await checkDmarc(
      res({ '_dmarc.example.cz': ['v=DMARC1; p=none; aspf=s'] }),
      'example.cz',
      { hasCustomMailFrom: false },
    );
    expect(r.findings.some((f) => f.code === 'dmarc_spf_alignment_strict')).toBe(true);
  });
});

describe('MX pro vlastni MAIL FROM', () => {
  it('chybejici MX je varovani, ne chyba', async () => {
    const r = await checkMx(res({}), { mailFromDomain: 'mail.example.cz', region: 'eu-central-1' });
    expect(r.findings[0]!.severity).toBe('warning');
  });

  it('spravny MX je ok', async () => {
    const r = await checkMx(
      res({ 'mail.example.cz': ['feedback-smtp.eu-central-1.amazonses.com'] }),
      {
        mailFromDomain: 'mail.example.cz',
        region: 'eu-central-1',
      },
    );
    expect(r.ok).toBe(true);
  });

  it('neshoda nese ocekavanou i NALEZENOU hodnotu a jmeno hostitele', async () => {
    const r = await checkMx(res({ 'mail.example.cz': ['mail.example.cz'] }), {
      mailFromDomain: 'mail.example.cz',
      region: 'eu-central-1',
    });
    expect(r.findings[0]).toMatchObject({
      code: 'mail_from_mx_wrong',
      params: {
        expected: 'feedback-smtp.eu-central-1.amazonses.com',
        actual: 'mail.example.cz',
        host: 'mail.example.cz',
      },
    });
  });
});

/**
 * Nalez z ostreho provozu: doména brevio.cz nemá vlastní zpáteční adresu
 * (`mail_from_subdomain` je NULL), přesto se MX kontrolovalo proti apexu a hlásilo
 * neshodu s `mail.brevio.cz`, tedy s poštovní schránkou majitele domény. Uživateli
 * se tak vyžadoval záznam, který v tabulce k opsání vůbec nebyl.
 */
describe('MX se bez vlastni zpatecni adresy vubec nekontroluje', () => {
  const spolecne = {
    spf: async () => ({
      ok: true as const,
      record: 'v=spf1 include:amazonses.com ~all',
      findings: [],
    }),
    dkim: async () => ({ ok: true as const, found: 3, expected: 3, findings: [] }),
    dmarc: async () => ({
      ok: true as const,
      record: 'v=DMARC1; p=none',
      policy: 'none' as const,
      pct: 100,
      findings: [],
    }),
    overallTimeoutMs: 1000,
  };

  it('bez MAIL FROM je mx null, tedy „neni co resit", ne false', async () => {
    const checks = await runDomainChecks({ ...spolecne, mx: null });
    expect(checks.mx).toBeNull();
  });

  it('s MAIL FROM se kontrola opravdu spusti', async () => {
    const resolver = res({ 'mail.example.cz': ['feedback-smtp.eu-central-1.amazonses.com'] });
    const checks = await runDomainChecks({
      ...spolecne,
      mx: () => checkMx(resolver, { mailFromDomain: 'mail.example.cz', region: 'eu-central-1' }),
    });
    expect(checks.mx).toMatchObject({ ok: true });
  });
});
