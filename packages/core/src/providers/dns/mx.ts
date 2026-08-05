import type { DnsResolver, Finding } from './resolver';

/**
 * Kdyz MX chybi a BehaviorOnMxFailure je USE_DEFAULT_VALUE, hlasi se VAROVANI, ne chyba,
 * protoze SES v tom pripade pouzije vlastni domenu a maily odejdou.
 *
 * Volat se smi JEN pro vlastni MAIL FROM subdomenu (`mail.example.cz`), nikdy pro apex.
 * Na apexu ma domena MX vlastni postovni schranky a porovnavat ho s `feedback-smtp...`
 * je nesmysl: hlasilo by to neshodu, kterou uzivatel nesmi opravit, protoze by si
 * tim odstrihl prichozi postu. Rozhoduje o tom `checkDomainNow`, ktera tuhle funkci
 * bez vlastni zpatecni adresy vubec nezavola.
 *
 * Nalez nese `expected` I `actual`. Bez `actual` se na obrazovce objevila veta
 * „zaznam ma jinou hodnotu" bez toho, co se vlastne naslo, a nedalo se to opravit.
 */
export async function checkMx(
  resolver: DnsResolver,
  input: { mailFromDomain: string; region: string },
): Promise<{ ok: boolean | null; records: string[]; findings: Finding[] }> {
  const expected = `feedback-smtp.${input.region}.amazonses.com`;
  try {
    const mx = await resolver.resolveMx(input.mailFromDomain);
    const records = mx.map((m) => m.exchange.toLowerCase().replace(/\.$/, ''));
    if (records.includes(expected)) return { ok: true, records, findings: [] };
    return {
      ok: false,
      records,
      findings: [
        {
          code: 'mail_from_mx_wrong',
          severity: 'warning',
          params: { expected, actual: records.join(', '), host: input.mailFromDomain },
        },
      ],
    };
  } catch {
    return {
      ok: false,
      records: [],
      findings: [
        {
          code: 'mail_from_mx_missing',
          severity: 'warning',
          params: { expected, host: input.mailFromDomain },
        },
      ],
    };
  }
}
