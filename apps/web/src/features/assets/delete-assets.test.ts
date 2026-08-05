// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { deleteMany, loadUsage } from './delete-assets';
import type { AssetRow } from './types';

function asset(overrides: Partial<AssetRow> = {}): AssetRow {
  return {
    id: 'a1',
    publicId: 'pid',
    mimeType: 'image/jpeg',
    byteSize: 10,
    width: 4,
    height: 4,
    animated: false,
    altText: null,
    originalFilename: 'foto.jpg',
    source: 'upload',
    url: 'http://t/a/pid/orig.jpg',
    thumbnailUrl: 'http://t/a/pid/thumb.jpg',
    referenceCount: 0,
    hidden: false,
    usedBy: [],
    createdAt: '2026-08-04T10:00:00.000Z',
    ...overrides,
  };
}

describe('hromadné mazání', () => {
  it('204 znamená smazáno', async () => {
    const doFetch = vi.fn(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof fetch;
    const outcomes = await deleteMany({
      assets: [asset({ id: 'a1' }), asset({ id: 'a2', originalFilename: 'b.png' })],
      workspaceId: 'ws1',
      fetchImpl: doFetch,
    });
    expect(outcomes).toEqual([
      { kind: 'deleted', id: 'a1', name: 'foto.jpg' },
      { kind: 'deleted', id: 'a2', name: 'b.png' },
    ]);
  });

  it('409 je „nelze", ne „nepovedlo se"', async () => {
    // Obrázek používá odeslaná kampaň. Opakovat to nemá smysl, takže se
    // odlišuje od chyby, kterou má smysl zkusit znovu.
    const doFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'asset_referenced_by_sent_campaign' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;

    const outcomes = await deleteMany({
      assets: [asset()],
      workspaceId: 'ws1',
      fetchImpl: doFetch,
    });
    expect(outcomes[0]).toEqual({
      kind: 'blocked',
      id: 'a1',
      name: 'foto.jpg',
      code: 'asset_referenced_by_sent_campaign',
    });
  });

  it('jeden neúspěch nezastaví zbytek dávky', async () => {
    let call = 0;
    const doFetch = vi.fn(async () => {
      call += 1;
      return call === 1 ? new Response(null, { status: 500 }) : new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const outcomes = await deleteMany({
      assets: [asset({ id: 'a1' }), asset({ id: 'a2' }), asset({ id: 'a3' })],
      workspaceId: 'ws1',
      fetchImpl: doFetch,
    });
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['failed', 'deleted', 'deleted']);
  });

  it('posílá X-Workspace-Id, jinak by trasa vrátila 404 před handlerem', async () => {
    const doFetch = vi.fn(async (url: unknown, init: RequestInit) => {
      expect(String(url)).toBe('/api/v1/assets/a1');
      expect(init.method).toBe('DELETE');
      expect((init.headers as Record<string, string>)['X-Workspace-Id']).toBe('ws1');
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    await deleteMany({ assets: [asset()], workspaceId: 'ws1', fetchImpl: doFetch });
    expect(doFetch).toHaveBeenCalledOnce();
  });
});

describe('zjištění, kde se obrázek používá', () => {
  it('nepoužitý obrázek se na detail vůbec neptá', async () => {
    const doFetch = vi.fn() as unknown as typeof fetch;
    const reports = await loadUsage({
      assets: [asset({ referenceCount: 0 })],
      workspaceId: 'ws1',
      fetchImpl: doFetch,
    });
    expect(reports).toEqual([{ asset: asset({ referenceCount: 0 }), usedBy: [] }]);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('u použitého obrázku dotáhne jména míst, ne jen počet', async () => {
    // Číslo stačí na štítek v dlaždici, ale ne na větu „přijdeš o obrázek
    // v šabloně Newsletter", a tu musí uživatel vidět, než něco smaže.
    const doFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'a1',
            public_id: 'pid',
            mime_type: 'image/jpeg',
            byte_size: 10,
            width: 4,
            height: 4,
            animated: false,
            alt_text: null,
            original_filename: 'foto.jpg',
            source: 'upload',
            url: 'http://t/a/pid/orig.jpg',
            thumbnail_url: 'http://t/a/pid/thumb.jpg',
            reference_count: 2,
            hidden: false,
            used_by: [
              { type: 'template', id: 't1', name: 'Newsletter' },
              { type: 'campaign', id: 'c1', name: 'Výprodej' },
            ],
            created_at: '2026-08-04T10:00:00.000Z',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;

    const reports = await loadUsage({
      assets: [asset({ referenceCount: 2 })],
      workspaceId: 'ws1',
      fetchImpl: doFetch,
    });
    expect(reports[0]?.usedBy).toEqual([
      { type: 'template', id: 't1', name: 'Newsletter' },
      { type: 'campaign', id: 'c1', name: 'Výprodej' },
    ]);
  });

  it('nedostupný detail NEPROHLÁSÍ obrázek za nepoužitý', async () => {
    // Tiché nastavení na nulu by uživateli slíbilo bezpečné smazání, které
    // bezpečné není: `reference_count` je nenulový.
    const doFetch = vi.fn(
      async () => new Response(null, { status: 500 }),
    ) as unknown as typeof fetch;

    const reports = await loadUsage({
      assets: [asset({ referenceCount: 3 })],
      workspaceId: 'ws1',
      fetchImpl: doFetch,
    });
    expect(reports[0]?.asset.referenceCount).toBe(3);
    expect(reports[0]?.usedBy).toEqual([]);
  });
});
