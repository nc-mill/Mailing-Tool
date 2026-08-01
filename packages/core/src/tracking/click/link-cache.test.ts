import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { LinkCache } from './link-cache';
import type { CampaignLinkRow } from '../repo/messages.repo';

type LoadLinks = (workspaceId: string, linkId: string) => Promise<CampaignLinkRow[]>;

const CAMPAIGN = '0192f3a0-1c2d-7e44-9e5f-60718293a4b5';
const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
const OTHER_WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6072';
const LINK_A = '0192f3a0-1c2d-7e42-9c3d-4e5f60718293';
const LINK_B = '0192f3a0-1c2d-7e42-9c3d-4e5f60718294';

const rows: CampaignLinkRow[] = [
  {
    id: LINK_A,
    url: 'https://shop.cz/vyprodej',
    campaignId: CAMPAIGN,
    workspaceId: WS,
    position: 1,
  },
  {
    id: LINK_B,
    url: 'https://shop.cz/novinky',
    campaignId: CAMPAIGN,
    workspaceId: WS,
    position: 2,
  },
];

describe('LinkCache', () => {
  let load: Mock<LoadLinks>;
  let cache: LinkCache;

  beforeEach(() => {
    load = vi.fn<LoadLinks>(async () => rows);
    cache = new LinkCache({ capacity: 100, ttlMs: 900_000, load });
  });

  it('první klik načte celou kampaň a naplní všechny její odkazy', async () => {
    expect(await cache.get(WS, LINK_A)).toEqual(rows[0]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await cache.get(WS, LINK_B)).toEqual(rows[1]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('souběžné kliky na tutéž kampaň udělají jedno naplnění', async () => {
    await Promise.all([cache.get(WS, LINK_A), cache.get(WS, LINK_A), cache.get(WS, LINK_A)]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('neexistující odkaz vrátí null a nezacachuje se jako platný', async () => {
    load.mockResolvedValue([]);
    expect(await cache.get(WS, '0192f3a0-1c2d-7e42-9c3d-000000000000')).toBeNull();
  });

  it('nese pozici odkazu, protože se sleduje, na který odkaz v mailu se kliklo', async () => {
    const link = await cache.get(WS, LINK_B);
    expect(link!.position).toBe(2);
  });

  it('klíčem je dvojice projekt a odkaz, takže cizí projekt cache nesdílí', async () => {
    await cache.get(WS, LINK_A);
    load.mockResolvedValue([]);
    expect(await cache.get(OTHER_WS, LINK_A)).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
