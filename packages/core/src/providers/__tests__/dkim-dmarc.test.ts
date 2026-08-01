import { describe, expect, it } from 'vitest';
import { checkDkim } from '../dns/dkim';
import { checkDmarc } from '../dns/dmarc';
import { checkMx } from '../dns/mx';

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
});
