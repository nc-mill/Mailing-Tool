import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { pgErrorCode, withWorkspace } from '../../../tx';
import { seedCampaign, withTestWorkspace, type TestWorkspace } from '../../test/harness';
import { listCampaignLinks, replaceCampaignLinks } from '../links';
import { rawSql } from '../raw-sql';

/**
 * Odkazy kampaně. Testuje se přesně to, co se rozejde tiše: identifikátory přebrané
 * z `CompileMeta` a pozice číslované od jedné (rozhodnutí D17).
 *
 * Identifikátory se losují pro každý test znovu, protože `campaign_links.id` je
 * primární klíč přes celou tabulku, ne jen přes kampaň. Skutečná kompilace odvozuje
 * UUIDv5 z kampaně a URL, takže dvě kampaně stejné ID nedostanou; pevná dvojice
 * v testu by se ale srazila sama se sebou v dalším případu.
 */
let links: Array<{ id: string; url: string; position: number; label: string }>;

describe('campaign_links', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
    links = [
      { id: randomUUID(), url: 'https://a.cz', position: 1, label: 'A' },
      { id: randomUUID(), url: 'https://b.cz', position: 2, label: 'B' },
    ];
  });

  it('id se prebira z CompileMeta doslova, nikdy se negeneruje znovu', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await replaceCampaignLinks(ctx.workspace, id, links);
    const rows = await listCampaignLinks(ctx.workspace, id);
    expect(rows.map((r) => r.id)).toEqual(links.map((l) => l.id));
  });

  it('pozice zacinaji od jedne, ne od nuly', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await replaceCampaignLinks(ctx.workspace, id, links);
    expect((await listCampaignLinks(ctx.workspace, id)).map((r) => r.position)).toEqual([1, 2]);
  });

  it('pozice nula je chyba, ne tiche prijeti', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await expect(
      replaceCampaignLinks(ctx.workspace, id, [
        { id: links[0]!.id, url: 'https://a.cz', position: 0 },
      ]),
    ).rejects.toThrowError(/pozice odkazů začínají od 1/);
  });

  it('odkaz bez id z CompileMeta se odmitne, P13 ho nedopocitava', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await expect(
      replaceCampaignLinks(ctx.workspace, id, [{ id: '', url: 'https://a.cz', position: 1 }]),
    ).rejects.toThrowError(/nemá id z CompileMeta/);
  });

  it('INSERT bez id selze, protoze DEFAULT je zruseny (R-P03.6)', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    // SQLSTATE se cte pres `pgErrorCode`, ne z textu: Drizzle chybu ovladace obali
    // vlastni hlaskou „Failed query" a `err.code` je na ni `undefined` (D19).
    // 23502 je not_null_violation, tedy presne to, co ma nastat, kdyz sloupec
    // nema DEFAULT a hodnota se neposlala.
    const err = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(
          `INSERT INTO campaign_links (workspace_id, campaign_id, url, position)
             VALUES ($1, $2, 'https://x.cz', 1)`,
          [ctx.workspaceId, id],
        ),
      ),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeNull();
    expect(pgErrorCode(err)).toBe('23502');
  });

  it('opakovana kompilace odkazy nahradi, nezdvoji', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await replaceCampaignLinks(ctx.workspace, id, links);
    await replaceCampaignLinks(ctx.workspace, id, links);
    expect(await listCampaignLinks(ctx.workspace, id)).toHaveLength(2);
  });

  it('cizi projekt odkazy nevidi', async () => {
    const other = await withTestWorkspace();
    const id = await seedCampaign(other, { status: 'draft' });
    await replaceCampaignLinks(other.workspace, id, links);
    expect(await listCampaignLinks(ctx.workspace, id)).toHaveLength(0);
  });
});
