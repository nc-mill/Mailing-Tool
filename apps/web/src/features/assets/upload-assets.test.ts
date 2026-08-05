// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { UPLOAD_ACCEPT_ATTRIBUTE, UPLOAD_ACCEPT_MIME_TYPES } from '@mlain/core/assets';
import {
  ACCEPT_ATTRIBUTE,
  ACCEPT_MIME_TYPES,
  localRejection,
  uploadMany,
  uploadOne,
} from './upload-assets';

const MAX = 10 * 1024 * 1024;

function file(name: string, type: string, size = 100): File {
  return new File([new Uint8Array(size)], name, { type });
}

function respond(status: number, body: unknown): typeof globalThis.fetch {
  return vi.fn(
    async () =>
      new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof globalThis.fetch;
}

const ASSET = {
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
  reference_count: 0,
  hidden: false,
  created_at: '2026-08-04T10:00:00.000Z',
};

/**
 * Seznam přijímaných formátů je v knihovně OPSANÝ z registru jádra, protože
 * `@mlain/core/assets` táhne `sharp` a `pg`, a ani jedno nesmí do klientského
 * bundlu. Tenhle test běží v Node, importovat jádro tedy smí, a jeho jediný
 * úkol je nedovolit, aby se ty dva seznamy rozešly. Kdyby se rozešly, projevilo
 * by se to tím, že dialog nabídne formát, který server odmítne, nebo naopak
 * schová formát, který by prošel.
 */
describe('vstupní seznam se drží registru jádra', () => {
  it('nabízené typy jsou přesně ty z registru', () => {
    expect(ACCEPT_MIME_TYPES).toEqual([...UPLOAD_ACCEPT_MIME_TYPES]);
    expect(ACCEPT_ATTRIBUTE).toBe(UPLOAD_ACCEPT_ATTRIBUTE);
  });

  it('nenabízí formát, který se do e-mailu nesmí dostat ani po převodu', () => {
    // WebP a AVIF se přijímají a PŘEVEDOU, takže v seznamu být smějí.
    // HEIC ne: `sharp` ho bez libheif nepřečte a odmítnutí by přišlo až po
    // nahrání celého souboru.
    expect(ACCEPT_ATTRIBUTE).not.toContain('heic');
    expect(ACCEPT_ATTRIBUTE).not.toContain('image/*');
  });
});

describe('odmítnutí ještě před odesláním', () => {
  it('příliš velký soubor se na server neposílá', () => {
    expect(localRejection(file('velky.jpg', 'image/jpeg', MAX + 1), MAX)).toBe('tooLargeLocal');
  });

  it('cizí typ souboru se na server neposílá', () => {
    expect(localRejection(file('smlouva.pdf', 'application/pdf'), MAX)).toBe('wrongTypeLocal');
  });

  it('prázdný typ z Windows zachrání přípona', () => {
    // Windows u části souborů posílá prázdný `type`. Kontrola jen podle typu
    // by odmítla běžný PNG, se kterým uživatel přijde.
    expect(localRejection(file('logo.png', ''), MAX)).toBeNull();
    expect(localRejection(file('foto.JPEG', ''), MAX)).toBeNull();
  });

  it('WebP a AVIF projdou, protože je server převede', () => {
    expect(localRejection(file('a.webp', 'image/webp'), MAX)).toBeNull();
    expect(localRejection(file('b.avif', 'image/avif'), MAX)).toBeNull();
  });

  it('odmítnutý soubor skončí jako neúspěch, ne jako tichý přeskok', async () => {
    const doFetch = respond(201, ASSET);
    const outcome = await uploadOne({
      file: file('smlouva.pdf', 'application/pdf'),
      workspaceId: 'ws1',
      maxBytes: MAX,
      fetchImpl: doFetch,
    });
    expect(outcome).toEqual({ kind: 'failed', file: 'smlouva.pdf', code: 'wrongTypeLocal' });
    expect(doFetch).not.toHaveBeenCalled();
  });
});

describe('nahrání jednoho souboru', () => {
  it('201 znamená novou položku knihovny', async () => {
    const outcome = await uploadOne({
      file: file('foto.jpg', 'image/jpeg'),
      workspaceId: 'ws1',
      maxBytes: MAX,
      fetchImpl: respond(201, ASSET),
    });
    expect(outcome.kind).toBe('created');
    expect(outcome.kind === 'created' ? outcome.asset.originalFilename : null).toBe('foto.jpg');
  });

  it('200 znamená deduplikaci, ne chybu', async () => {
    // Rozlišení proti 201 není kosmetika: klient podle něj pozná, že mu
    // v knihovně nepřibyla položka, a nemá ji tam přidávat podruhé.
    const outcome = await uploadOne({
      file: file('foto.jpg', 'image/jpeg'),
      workspaceId: 'ws1',
      maxBytes: MAX,
      fetchImpl: respond(200, ASSET),
    });
    expect(outcome.kind).toBe('duplicate');
  });

  it('posílá X-Workspace-Id a NENASTAVUJE Content-Type', async () => {
    const doFetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      // Bez `X-Workspace-Id` nemá middleware z čeho vzít projekt a vrátí 404
      // ještě před handlerem.
      expect(headers['X-Workspace-Id']).toBe('ws1');
      // Nastavený `Content-Type` by prohlížeči sebral `boundary=` a server by
      // multipart nerozebral.
      expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain('content-type');
      return new Response(JSON.stringify(ASSET), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch;

    await uploadOne({
      file: file('foto.jpg', 'image/jpeg'),
      workspaceId: 'ws1',
      maxBytes: MAX,
      fetchImpl: doFetch,
    });
    expect(doFetch).toHaveBeenCalledOnce();
  });

  it('kód chyby z obálky RFC 9457 se propíše až na obrazovku', async () => {
    const outcome = await uploadOne({
      file: file('foto.jpg', 'image/jpeg'),
      workspaceId: 'ws1',
      maxBytes: MAX,
      fetchImpl: respond(415, { code: 'asset_unsupported_format', status: 415 }),
    });
    expect(outcome).toEqual({
      kind: 'failed',
      file: 'foto.jpg',
      code: 'asset_unsupported_format',
    });
  });

  it('413 bez těla je pořád srozumitelná odpověď', async () => {
    // Požadavek může utnout proxy dřív, než dojde k aplikaci, a ta obálku
    // RFC 9457 nedodá.
    const outcome = await uploadOne({
      file: file('foto.jpg', 'image/jpeg'),
      workspaceId: 'ws1',
      maxBytes: MAX,
      fetchImpl: respond(413, null),
    });
    expect(outcome).toEqual({ kind: 'failed', file: 'foto.jpg', code: 'payload_too_large' });
  });

  it('spadlé spojení nekončí neodchycenou výjimkou', async () => {
    const doFetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof globalThis.fetch;
    const outcome = await uploadOne({
      file: file('foto.jpg', 'image/jpeg'),
      workspaceId: 'ws1',
      maxBytes: MAX,
      fetchImpl: doFetch,
    });
    expect(outcome).toEqual({ kind: 'failed', file: 'foto.jpg', code: 'unknown' });
  });
});

describe('nahrání dávky', () => {
  it('jeden nepovedený soubor nezastaví zbytek dávky', async () => {
    let call = 0;
    const doFetch = vi.fn(async () => {
      call += 1;
      if (call === 2) {
        return new Response(JSON.stringify({ code: 'asset_corrupt' }), {
          status: 422,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(ASSET), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch;

    const outcomes = await uploadMany({
      files: [
        file('a.jpg', 'image/jpeg'),
        file('b.jpg', 'image/jpeg'),
        file('c.jpg', 'image/jpeg'),
      ],
      workspaceId: 'ws1',
      maxBytes: MAX,
      fetchImpl: doFetch,
    });

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['created', 'failed', 'created']);
    expect(outcomes[1]).toMatchObject({ file: 'b.jpg', code: 'asset_corrupt' });
  });

  it('hlásí průběh a skončí na plném počtu', async () => {
    const seen: Array<[number, number]> = [];
    await uploadMany({
      files: [file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg')],
      workspaceId: 'ws1',
      maxBytes: MAX,
      onProgress: (done, total) => seen.push([done, total]),
      fetchImpl: respond(201, ASSET),
    });
    expect(seen).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  it('posílá po jednom, ne souběžně', async () => {
    // Deset souběžných nahrání znamená deset souběžných dekodérů `sharp`
    // v procesu, který zároveň obsluhuje aplikaci.
    let running = 0;
    let peak = 0;
    const doFetch = vi.fn(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return new Response(JSON.stringify(ASSET), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch;

    await uploadMany({
      files: [
        file('a.jpg', 'image/jpeg'),
        file('b.jpg', 'image/jpeg'),
        file('c.jpg', 'image/jpeg'),
      ],
      workspaceId: 'ws1',
      maxBytes: MAX,
      fetchImpl: doFetch,
    });
    expect(peak).toBe(1);
  });
});
