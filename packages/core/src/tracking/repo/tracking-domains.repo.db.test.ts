import { beforeAll, describe, expect, it } from 'vitest';
import { asMigrator, seedWorkspace } from '../test/support/db';
import { markTrackingDomainVerified } from './tracking-domains.repo';

/**
 * OVĚŘENÍ MĚŘICÍ DOMÉNY SE MUSÍ ZAPSAT.
 *
 * Sloupec `tracking_domains.verified_at` neměl do téhle opravy v produktu
 * žádného zapisovatele, takže v rozhraní u KAŽDÉ domény trvale svítilo
 * „Zatím neověřeno. Ověří se samo při prvním úspěšném běhu skriptu."
 * Byl to slib, který produkt neplnil.
 */
describe('ověření měřicí domény', () => {
  let workspaceId: string;

  beforeAll(async () => {
    workspaceId = await seedWorkspace();
    await asMigrator().query(
      `INSERT INTO tracking_domains (workspace_id, host, include_subdomains)
       VALUES ($1, 'shop.cz', false), ($1, 'example.cz', true), ($1, 'jiny.cz', false)`,
      [workspaceId],
    );
  }, 300_000);

  const verifiedAt = async (host: string): Promise<Date | null> => {
    const { rows } = await asMigrator().query<{ verified_at: Date | null }>(
      `SELECT verified_at FROM tracking_domains WHERE workspace_id = $1 AND host = $2`,
      [workspaceId, host],
    );
    return rows[0]?.verified_at ?? null;
  };

  it('shoda na celý host doménu ověří', async () => {
    expect(await verifiedAt('shop.cz')).toBeNull();
    expect(await markTrackingDomainVerified({ workspaceId, host: 'shop.cz' })).toBe(1);
    expect(await verifiedAt('shop.cz')).toBeInstanceOf(Date);
  });

  it('druhý průchod nic nemění, čas prvního ověření se nepřepíše', async () => {
    const first = await verifiedAt('shop.cz');
    expect(await markTrackingDomainVerified({ workspaceId, host: 'shop.cz' })).toBe(0);
    expect((await verifiedAt('shop.cz'))?.getTime()).toBe(first?.getTime());
  });

  /**
   * Kdyby se porovnávalo jen `host = $2`, projekt s pravidlem `example.cz`
   * a subdoménami by po návštěvě `blog.example.cz` zůstal navždy neověřený:
   * požadavek by prošel a řádek by se nenašel.
   */
  it('návštěva subdomény ověří pravidlo se subdoménami', async () => {
    expect(await markTrackingDomainVerified({ workspaceId, host: 'blog.example.cz' })).toBe(1);
    expect(await verifiedAt('example.cz')).toBeInstanceOf(Date);
  });

  it('cizí host neověří nic a nesáhne na ostatní řádky', async () => {
    expect(await markTrackingDomainVerified({ workspaceId, host: 'zlyexample.cz' })).toBe(0);
    expect(await verifiedAt('jiny.cz')).toBeNull();
  });

  it('host s procentem se nebere jako zástupný znak', async () => {
    expect(await markTrackingDomainVerified({ workspaceId, host: '%' })).toBe(0);
    expect(await verifiedAt('jiny.cz')).toBeNull();
  });
});
