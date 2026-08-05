import { describe, expect, it } from 'vitest';
import { checkSpf } from '../dns/spf';

const resolver = (records: string[][] | Error) => ({
  resolveTxt: async () => {
    if (records instanceof Error) throw records;
    return records;
  },
  resolveCname: async () => [],
  resolveMx: async () => [],
  resolveNs: async () => [],
});

describe('kontrola SPF', () => {
  it('chybejici zaznam je spf_ok false s nalezem spf_missing', async () => {
    const r = await checkSpf(resolver([]), 'example.cz');
    expect(r.ok).toBe(false);
    expect(r.findings[0]!.code).toBe('spf_missing');
  });

  it('dva zaznamy jsou spf_multiple_records', async () => {
    const r = await checkSpf(
      resolver([['v=spf1 include:a ~all'], ['v=spf1 include:b ~all']]),
      'example.cz',
    );
    expect(r.ok).toBe(false);
    expect(r.findings[0]!.code).toBe('spf_multiple_records');
  });

  it('casti zaznamu se spojuji bez oddelovace', async () => {
    const r = await checkSpf(resolver([['v=spf1 include:amaz', 'onses.com ~all']]), 'example.cz');
    expect(r.ok).toBe(true);
  });

  it('zaznam bez amazonses je spf_no_amazon', async () => {
    const r = await checkSpf(resolver([['v=spf1 include:_spf.google.com ~all']]), 'example.cz');
    expect(r.ok).toBe(false);
    expect(r.findings[0]!.code).toBe('spf_no_amazon');
  });

  it('+all je varovani, ne chyba', async () => {
    const r = await checkSpf(resolver([['v=spf1 include:amazonses.com +all']]), 'example.cz');
    expect(r.ok).toBe(true);
    expect(
      r.findings.some((f) => f.code === 'spf_permissive_all' && f.severity === 'warning'),
    ).toBe(true);
  });

  it('vic nez 10 lookupu je varovani', async () => {
    const many = `v=spf1 ${'include:x.cz '.repeat(11)}include:amazonses.com ~all`;
    const r = await checkSpf(resolver([[many]]), 'example.cz');
    expect(r.findings.some((f) => f.code === 'spf_too_many_lookups')).toBe(true);
  });

  /*
   * Jadro nalezu: SPF se posuzuje podle OBSAHU, ne podle shody s nasim doporucenim.
   * Domena smi mit jediny SPF zaznam a musi se do nej vejit i ostatni odesilatele,
   * takze presna shoda s `v=spf1 include:amazonses.com ~all` by odmitla kazdou firmu,
   * ktera posila i pres Google, Microsoft nebo fakturacni system.
   */
  describe('dalsi odesilatele v tomtez zaznamu', () => {
    it.each([
      'v=spf1 include:_spf.google.com include:amazonses.com ~all',
      'v=spf1 include:amazonses.com include:_spf.google.com ~all',
      'v=spf1 include:spf.protection.outlook.com include:amazonses.com include:mailgun.org -all',
      'v=spf1 mx a:mail.example.cz include:amazonses.com ~all',
      'v=spf1 include:amazonses.com -all',
      'v=spf1 include:AmazonSES.com ~all',
    ])('%s projde', async (record) => {
      const r = await checkSpf(resolver([[record]]), 'example.cz');
      expect(r.ok).toBe(true);
      expect(r.findings.filter((f) => f.severity === 'error')).toEqual([]);
    });

    it('presna shoda s doporucenim NENI podminka: rozhoduje include:amazonses.com', async () => {
      const doporuceni = 'v=spf1 include:amazonses.com ~all';
      const skutecnost = 'v=spf1 include:_spf.google.com include:amazonses.com ~all';
      expect(skutecnost).not.toBe(doporuceni);
      expect((await checkSpf(resolver([[skutecnost]]), 'example.cz')).ok).toBe(true);
    });

    it('zivy zaznam brevio.cz z dig +short TXT brevio.cz projde', async () => {
      const r = await checkSpf(resolver([['v=spf1 include:amazonses.com ~all']]), 'brevio.cz');
      expect(r).toMatchObject({ ok: true, record: 'v=spf1 include:amazonses.com ~all' });
      expect(r.findings).toEqual([]);
    });
  });

  it('nalez bez amazonu nese ocekavanou i nalezenou hodnotu, aby slo poznat co opravit', async () => {
    const r = await checkSpf(resolver([['v=spf1 include:_spf.google.com ~all']]), 'example.cz');
    expect(r.findings[0]).toMatchObject({
      code: 'spf_no_amazon',
      params: { expected: 'include:amazonses.com', actual: 'v=spf1 include:_spf.google.com ~all' },
    });
  });

  it('SERVFAIL vraci null, ne false, protoze nevime', async () => {
    const err = Object.assign(new Error('servfail'), { code: 'SERVFAIL' });
    const r = await checkSpf(resolver(err), 'example.cz');
    expect(r.ok).toBeNull();
  });
});
