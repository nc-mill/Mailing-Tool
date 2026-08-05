import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@mlain/db/schema';
import type { MlainConfig } from '../config';
import { seedWorkspaceForCoreTests, type SeededWorkspace } from '../identity/test-helpers';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, withoutContext, withWorkspace } from '../tx';
import { resolvePublicAsset } from './public';
import {
  findAssetById,
  listAssets,
  listPurgeCandidates,
  listVariants,
  refcountMismatches,
  workspaceUsageBytes,
} from './repository';
import {
  AssetQuotaExceeded,
  AssetTooLarge,
  deleteAsset,
  processAsset,
  purgeAsset,
  uploadAsset,
  type AssetServiceContext,
} from './service';
import { createFileAssetStorage } from './storage';

let harness: PgHarness;
let uploads: string;

beforeAll(async () => {
  harness = await startPgHarness();
  uploads = await mkdtemp(join(tmpdir(), 'mlain-assets-db-'));
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
  await rm(uploads, { recursive: true, force: true });
}, 120_000);

/**
 * Konfigurace se službě předává, ne čte z prostředí: test si tím řídí kvótu
 * i limit velikosti, aniž by musel sahat na proměnné procesu, které sdílí
 * s ostatními soubory běhu.
 */
function service(
  seeded: SeededWorkspace,
  overrides: { quotaMb?: number; maxUploadMb?: number } = {},
): AssetServiceContext {
  return {
    ctx: seeded.ctx,
    userId: seeded.userId,
    storage: createFileAssetStorage(uploads),
    config: {
      UPLOADS_DIR: uploads,
      ASSET_QUOTA_MB: overrides.quotaMb ?? 2048,
      ASSET_MAX_UPLOAD_MB: overrides.maxUploadMb ?? 10,
    } as unknown as MlainConfig,
  };
}

async function jpeg(width: number, height: number, tint = 40): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: tint, g: 90, b: 160 } },
  })
    .jpeg()
    .toBuffer();
}

/**
 * Posune `hidden_at` do minulosti HODINAMI DATABÁZE.
 *
 * Testy úklidu původně skrývaly asset „teď" a ptaly se na kandidáty se lhůtou
 * NULA dní, tedy na podmínku `hidden_at < now()`. Vypadalo to nevinně a bylo
 * to rozbité: mezi „projde" a „neprojde" byla rezerva POD 10 ms (naměřeno
 * posouváním `hidden_at` po milisekundách proti sdílenému harnessu), takže
 * o výsledku rozhodovala shoda hodin dvou strojů a pořadí transakcí. U autora
 * prošlo, u vedoucího padalo, a to je nejhorší druh testu, jaký může existovat.
 *
 * Nově se čas nastaví JEDNOU HODNOTOU DALEKO V MINULOSTI a ptáme se SKUTEČNOU
 * lhůtou 30 dní z produkce, ne degenerovanou nulou. Rezerva je tím den, ne
 * milisekunda, a test navíc ověřuje ten parametr, který doopravdy platí.
 */
async function skryjPredDny(seeded: SeededWorkspace, assetId: string, dnu: number): Promise<void> {
  await withWorkspace(seeded.ctx, (tx) =>
    tx
      .update(schema.assets)
      .set({ hiddenAt: sql`now() - make_interval(days => ${dnu})` })
      .where(eq(schema.assets.id, assetId)),
  );
}

describe('nahrání obrázku', () => {
  it('uloží řádek, varianty i soubory na disk', async () => {
    const a = await seedWorkspaceForCoreTests();
    const result = await uploadAsset(service(a), {
      content: await jpeg(1600, 800),
      filename: 'banner.jpg',
    });

    expect(result.deduplicated).toBe(false);
    expect(result.asset.publicId).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(result.asset.mimeType).toBe('image/jpeg');
    expect(result.asset.width).toBe(1600);
    expect(result.variants.map((v) => v.variant).sort()).toEqual([
      'thumb',
      'w1200',
      'w300',
      'w600',
    ]);

    const storage = createFileAssetStorage(uploads);
    expect(await storage.size(result.asset.storageKey)).toBe(result.asset.byteSize);
    for (const variant of result.variants) {
      expect(await storage.size(variant.storageKey)).toBe(variant.byteSize);
    }
  });

  it('DEDUPLIKUJE: tentýž obsah podruhé nezaloží druhý řádek ani druhý soubor', async () => {
    const a = await seedWorkspaceForCoreTests();
    const content = await jpeg(900, 600, 11);

    const first = await uploadAsset(service(a), { content, filename: 'prvni.jpg' });
    const usageAfterFirst = await withWorkspace(a.ctx, (tx) => workspaceUsageBytes(tx, a.ctx));

    // Jiné jméno souboru, týž obsah. Rozhoduje hash obsahu, ne jméno.
    const second = await uploadAsset(service(a), { content, filename: 'uplne-jiny-nazev.jpg' });

    expect(second.deduplicated).toBe(true);
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.asset.publicId).toBe(first.asset.publicId);

    const page = await withWorkspace(a.ctx, (tx) => listAssets(tx, a.ctx, { limit: 50 }));
    expect(page.items).toHaveLength(1);

    // Kvóta se druhým nahráním nezvedla, protože nic nepřibylo.
    const usageAfterSecond = await withWorkspace(a.ctx, (tx) => workspaceUsageBytes(tx, a.ctx));
    expect(usageAfterSecond).toBe(usageAfterFirst);
  });

  it('deduplikuje podle NORMALIZOVANÝCH bajtů, ne podle nahraného souboru', async () => {
    const a = await seedWorkspaceForCoreTests();
    const pixels = {
      width: 320,
      height: 240,
      channels: 3 as const,
      background: { r: 7, g: 8, b: 9 },
    };
    const plain = await sharp({ create: pixels }).jpeg().toBuffer();
    // Týž obrázek, jen s EXIF metadaty navíc. Jako soubor je to něco jiného
    // (jiná délka, jiný hash), jako obrázek totéž.
    const withExif = await sharp({ create: pixels })
      .withExif({ IFD0: { Copyright: 'Novak', Software: 'Telefon' } })
      .jpeg()
      .toBuffer();
    expect(plain.equals(withExif)).toBe(false);

    const first = await uploadAsset(service(a), { content: plain, filename: 'bez-exif.jpg' });
    const second = await uploadAsset(service(a), { content: withExif, filename: 's-exif.jpg' });

    // Kdyby se hash počítal ze vstupu, vznikly by dva assety s naprosto
    // identickým obsahem a deduplikace by v praxi nefungovala skoro nikdy:
    // každá fotka z telefonu nese EXIF.
    expect(second.deduplicated).toBe(true);
    expect(second.asset.id).toBe(first.asset.id);
  });

  it('deduplikace NEPŘESAHUJE HRANICI PROJEKTU', async () => {
    const a = await seedWorkspaceForCoreTests();
    const b = await seedWorkspaceForCoreTests();
    const content = await jpeg(300, 300, 77);

    const inA = await uploadAsset(service(a), { content, filename: 'x.jpg' });
    const inB = await uploadAsset(service(b), { content, filename: 'x.jpg' });

    expect(inB.deduplicated).toBe(false);
    expect(inB.asset.id).not.toBe(inA.asset.id);
    // Různé cesty, tedy dvě kopie na disku. Je to záměr: sdílený soubor by
    // znamenal, že smazání projektu A odnese obrázky projektu B.
    expect(inB.asset.storageKey).not.toBe(inA.asset.storageKey);
  });

  it('odmítne soubor nad limit dřív, než ho pustí do dekodéru', async () => {
    const a = await seedWorkspaceForCoreTests();
    // 1 MiB limit a obrázek, který je větší.
    const big = await sharp({
      create: { width: 3000, height: 3000, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    await expect(
      uploadAsset(service(a, { maxUploadMb: 1 }), { content: big, filename: 'velky.png' }),
    ).rejects.toBeInstanceOf(AssetTooLarge);
  });

  it('odmítne nahrání přes kvótu projektu', async () => {
    const a = await seedWorkspaceForCoreTests();
    // Kvóta 100 MiB je minimum schématu konfigurace; obrázek se do ní vejde.
    await uploadAsset(service(a, { quotaMb: 100 }), {
      content: await jpeg(200, 200, 5),
      filename: 'a.jpg',
    });
    // Druhý obrázek musí mít JINÝ OBSAH, jinak by ho zachytila deduplikace
    // a ke kontrole kvóty by se vůbec nedošlo. Rozdíl je v rozměrech, ne
    // v odstínu: dva jednobarevné JPEGy lišící se o jedničku v kanálu R se po
    // kvantizaci zakódují na tytéž bajty a test by byl falešně zelený.
    await expect(
      uploadAsset(
        {
          ...service(a),
          config: { ...service(a).config, ASSET_QUOTA_MB: 0 } as unknown as MlainConfig,
        },
        {
          content: await jpeg(640, 480, 200),
          filename: 'b.jpg',
        },
      ),
    ).rejects.toBeInstanceOf(AssetQuotaExceeded);
  });

  it('jméno souboru z požadavku se NIKDY nedostane do cesty na disku', async () => {
    const a = await seedWorkspaceForCoreTests();
    const result = await uploadAsset(service(a), {
      content: await jpeg(120, 120, 33),
      filename: '../../../../etc/passwd.jpg',
    });
    expect(result.asset.storageKey).not.toContain('..');
    expect(result.asset.storageKey).not.toContain('passwd');
    expect(result.asset.storageKey.startsWith(`assets/${a.workspaceId}/`)).toBe(true);
    // Do sloupce se uloží očištěná podoba, oddělovače cest jsou pryč.
    expect(result.asset.originalFilename).not.toContain('/');
  });
});

describe('izolace projektů', () => {
  it('cizí asset nevrátí ani repository, ani přímý dotaz pod RLS', async () => {
    const a = await seedWorkspaceForCoreTests();
    const b = await seedWorkspaceForCoreTests();
    const created = await uploadAsset(service(a), {
      content: await jpeg(400, 200, 61),
      filename: 'a.jpg',
    });

    const foreign = await withWorkspace(b.ctx, (tx) => findAssetById(tx, b.ctx, created.asset.id));
    expect(foreign).toBeNull();

    // Dvě nezávislé vrstvy naráz: kdyby tu byl řádek, drží izolaci jen podmínka
    // ve WHERE a RLS nedělá nic.
    const raw = await withWorkspace(b.ctx, (tx) =>
      tx.select().from(schema.assets).where(eq(schema.assets.id, created.asset.id)),
    );
    expect(raw).toEqual([]);

    const foreignVariants = await withWorkspace(b.ctx, (tx) =>
      tx
        .select()
        .from(schema.assetVariants)
        .where(eq(schema.assetVariants.assetId, created.asset.id)),
    );
    expect(foreignVariants).toEqual([]);
  });
});

describe('veřejný výdej', () => {
  it('najde asset podle public_id BEZ jakéhokoli kontextu projektu', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await uploadAsset(service(a), {
      content: await jpeg(1000, 500, 91),
      filename: 'verejny.jpg',
    });

    const orig = await resolvePublicAsset(created.asset.publicId, 'orig.jpg');
    expect(orig).not.toBeNull();
    expect(orig?.workspaceId).toBe(a.workspaceId);
    expect(orig?.storageKey).toBe(created.asset.storageKey);
    expect(orig?.mimeType).toBe('image/jpeg');

    const w600 = await resolvePublicAsset(created.asset.publicId, 'w600.jpg');
    expect(w600?.storageKey).toBe(created.variants.find((v) => v.variant === 'w600')?.storageKey);
  });

  it('neznámý identifikátor, špatná přípona i neexistující varianta dají shodně null', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await uploadAsset(service(a), {
      content: await jpeg(300, 150, 12),
      filename: 'x.jpg',
    });
    expect(await resolvePublicAsset('Z'.repeat(22), 'orig.jpg')).toBeNull();
    // Přípona neodpovídá uloženému typu: adresa by lhala o obsahu.
    expect(await resolvePublicAsset(created.asset.publicId, 'orig.png')).toBeNull();
    expect(await resolvePublicAsset(created.asset.publicId, 'w9999.jpg')).toBeNull();
    // Tvar identifikátoru se kontroluje dřív, než se sáhne do databáze.
    expect(await resolvePublicAsset('kratky', 'orig.jpg')).toBeNull();
  });

  /**
   * TŘI MĚŘENÍ, NE ÚVAHA.
   *
   * Politika `asset_public_lookup` z migrace 0011 je výjimka z izolace projektů
   * a věta „vyjmenovat se přes ni nedá nic" je tvrzení, dokud ho nepotvrdí
   * spuštění. Testuje se proto přímo pod rolí `mlain_app` (tou jede aplikace
   * a RLS na ni dopadá), bez kontextu projektu, tedy přesně v situaci, ve které
   * běží veřejná trasa výdeje obrázku.
   *
   * `count(*)` je tu schválně místo `SELECT id`: agregace projde i tehdy, když
   * politika nepustí ani řádek, takže rozlišuje „nula řádků" od „dotaz spadl".
   * Kdyby vrátila nenulu, znamenalo by to, že si kdokoli z internetu umí
   * spočítat, kolik obrázků má instalace, a odtud vyjmenovat cizí projekty.
   */
  it('výjimka z izolace NEUMÍ VYJMENOVAT: bez public_id vrátí count(*) nulu', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await uploadAsset(service(a), {
      content: await jpeg(200, 100, 44),
      filename: 'x.jpg',
    });

    // Kontrolní měření: řádky v tabulce SKUTEČNĚ JSOU. Bez něj by test byl
    // zelený i nad prázdnou tabulkou, tedy by nedokazoval vůbec nic.
    const skutecne = await withWorkspace(a.ctx, async (tx) => {
      const { rows } = await tx.execute<{ count: string }>(
        sql`SELECT count(*) AS count FROM assets`,
      );
      return Number(rows[0]?.count ?? -1);
    });
    expect(skutecne).toBeGreaterThan(0);

    // 1) Bez nastavené proměnné `mlain.asset_public_id`.
    const bezPromenne = await withoutContext(async (tx) => {
      const { rows } = await tx.execute<{ count: string }>(
        sql`SELECT count(*) AS count FROM assets`,
      );
      return Number(rows[0]?.count ?? -1);
    });
    expect(bezPromenne).toBe(0);

    // 2) Se ŠPATNÝM `public_id`. Tvarem platný, existencí ne.
    const spatnePublicId = await withoutContext(async (tx) => {
      await tx.execute(sql`SELECT set_config('mlain.asset_public_id', ${'Z'.repeat(22)}, true)`);
      const { rows } = await tx.execute<{ count: string }>(
        sql`SELECT count(*) AS count FROM assets`,
      );
      return Number(rows[0]?.count ?? -1);
    });
    expect(spatnePublicId).toBe(0);

    // 3) A pro kontrast se SPRÁVNÝM `public_id` právě jeden řádek, ne víc.
    // Bez téhle třetí větve by test prošel i nad politikou, která nepouští nic,
    // a veřejný výdej obrázku by nefungoval vůbec.
    const spravnePublicId = await withoutContext(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('mlain.asset_public_id', ${created.asset.publicId}, true)`,
      );
      const { rows } = await tx.execute<{ count: string }>(
        sql`SELECT count(*) AS count FROM assets`,
      );
      return Number(rows[0]?.count ?? -1);
    });
    expect(spravnePublicId).toBe(1);
  });
});

describe('mazání a úklid', () => {
  it('smazání SKRYJE a soubor nechá, aby obrázek nezmizel z odeslaných e-mailů', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await uploadAsset(service(a), {
      content: await jpeg(500, 250, 21),
      filename: 'skryty.jpg',
    });

    await deleteAsset(service(a), created.asset.id);

    const visible = await withWorkspace(a.ctx, (tx) => listAssets(tx, a.ctx, { limit: 50 }));
    expect(visible.items.map((i) => i.id)).not.toContain(created.asset.id);
    const hidden = await withWorkspace(a.ctx, (tx) =>
      listAssets(tx, a.ctx, { limit: 50, hidden: true }),
    );
    expect(hidden.items.map((i) => i.id)).toContain(created.asset.id);

    // Soubor je pořád na disku a veřejná adresa funguje.
    const storage = createFileAssetStorage(uploads);
    expect(await storage.size(created.asset.storageKey)).toBeGreaterThan(0);
    expect(await resolvePublicAsset(created.asset.publicId, 'orig.jpg')).not.toBeNull();
  });

  it('kandidáti úklidu jsou jen skryté, bez referencí a po lhůtě', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await uploadAsset(service(a), {
      content: await jpeg(240, 120, 88),
      filename: 'k-uklidu.jpg',
    });
    await deleteAsset(service(a), created.asset.id);

    // Skrytý právě teď: po třicetidenní lhůtě ještě není na řadě.
    expect(await withWorkspace(a.ctx, (tx) => listPurgeCandidates(tx, a.ctx, 30, 10))).toHaveLength(
      0,
    );
    // Po uplynutí lhůty se objeví. Čas se posouvá o den za hranici, ne o
    // milisekundu, takže výsledek nezávisí na shodě hodin ani na pořadí.
    await skryjPredDny(a, created.asset.id, 31);
    const due = await withWorkspace(a.ctx, (tx) => listPurgeCandidates(tx, a.ctx, 30, 10));
    expect(due.map((row) => row.id)).toContain(created.asset.id);
  });

  /**
   * DÍRA V POKRYTÍ, kterou odhalilo až zavedení vady.
   *
   * Když jsem z `listPurgeCandidates` odstranil podmínku `reference_count = 0`,
   * celá sada zůstala ZELENÁ. Úklid by tedy směl smazat soubor, na který někdo
   * odkazuje, a nikdo by si toho nevšiml, dokud by lidem ve schránkách nezmizely
   * obrázky. Podmínka je v dotazu zdvojená schválně (skrýt jde i asset, který se
   * používá), takže test musí hlídat právě ten druhý průchod.
   */
  it('odkazovaný asset NENÍ kandidát úklidu, ani když je skrytý dost dlouho', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await uploadAsset(service(a), {
      content: await jpeg(280, 140, 66),
      filename: 'pouzivany.jpg',
    });
    await deleteAsset(service(a), created.asset.id);
    await skryjPredDny(a, created.asset.id, 31);

    // Mezitím na něj někdo v šabloně odkázal, takže `reference_count` stoupl.
    await withWorkspace(a.ctx, (tx) =>
      tx
        .update(schema.assets)
        .set({ referenceCount: 1 })
        .where(eq(schema.assets.id, created.asset.id)),
    );

    const due = await withWorkspace(a.ctx, (tx) => listPurgeCandidates(tx, a.ctx, 30, 10));
    expect(
      due.map((row) => row.id),
      'úklid by smazal soubor, na který se pořád odkazuje',
    ).not.toContain(created.asset.id);

    // A jakmile reference zmizí, kandidátem se stane. Bez téhle druhé půlky by
    // test prošel i nad dotazem, který nevrací nikdy nic.
    await withWorkspace(a.ctx, (tx) =>
      tx
        .update(schema.assets)
        .set({ referenceCount: 0 })
        .where(eq(schema.assets.id, created.asset.id)),
    );
    const potom = await withWorkspace(a.ctx, (tx) => listPurgeCandidates(tx, a.ctx, 30, 10));
    expect(potom.map((row) => row.id)).toContain(created.asset.id);
  });

  it('úklid smaže soubory, označí purged_at a veřejná adresa přestane platit', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await uploadAsset(service(a), {
      content: await jpeg(260, 130, 99),
      filename: 'pryc.jpg',
    });
    await deleteAsset(service(a), created.asset.id);
    await skryjPredDny(a, created.asset.id, 31);
    const [candidate] = await withWorkspace(a.ctx, (tx) => listPurgeCandidates(tx, a.ctx, 30, 10));
    expect(candidate, 'asset skrytý před 31 dny musí být kandidátem úklidu').toBeDefined();

    await purgeAsset(service(a), candidate!);

    const storage = createFileAssetStorage(uploads);
    expect(await storage.size(created.asset.storageKey)).toBeNull();
    for (const variant of created.variants) {
      expect(await storage.size(variant.storageKey)).toBeNull();
    }
    expect(await resolvePublicAsset(created.asset.publicId, 'orig.jpg')).toBeNull();

    const row = await withWorkspace(a.ctx, (tx) =>
      tx.select().from(schema.assets).where(eq(schema.assets.id, created.asset.id)),
    );
    expect(row[0]?.purgedAt).not.toBeNull();
  });

  it('DEDUPLIKACE VERSUS MAZÁNÍ: úklid nesmí sebrat soubor živému řádku', async () => {
    const a = await seedWorkspaceForCoreTests();
    const content = await jpeg(340, 170, 55);
    const first = await uploadAsset(service(a), { content, filename: 'p.jpg' });

    // Skrytí a uklizení prvního řádku uvolní unikátní index (platí jen
    // `WHERE purged_at IS NULL`), takže druhé nahrání téhož obsahu založí NOVÝ
    // řádek se STEJNOU obsahově adresovanou cestou.
    await deleteAsset(service(a), first.asset.id);
    await skryjPredDny(a, first.asset.id, 31);
    const [due] = await withWorkspace(a.ctx, (tx) => listPurgeCandidates(tx, a.ctx, 30, 10));
    expect(due, 'asset skrytý před 31 dny musí být kandidátem úklidu').toBeDefined();
    await purgeAsset(service(a), due!);

    const second = await uploadAsset(service(a), { content, filename: 'p.jpg' });
    expect(second.asset.id).not.toBe(first.asset.id);
    expect(second.asset.storageKey).toBe(first.asset.storageKey);

    // A teď to podstatné: uklidíme původní řádek JEŠTĚ JEDNOU. Kdyby `purgeAsset`
    // mazal soubor bez kontroly, sebral by ho živému druhému řádku a obrázek
    // v odeslané kampani by zmizel.
    await purgeAsset(service(a), first.asset);

    const storage = createFileAssetStorage(uploads);
    expect(await storage.size(second.asset.storageKey)).toBeGreaterThan(0);
    expect(await resolvePublicAsset(second.asset.publicId, 'orig.jpg')).not.toBeNull();
  });
});

describe('kontrola počtu referencí', () => {
  it('najde rozpor mezi reference_count a asset_references', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await uploadAsset(service(a), {
      content: await jpeg(210, 105, 3),
      filename: 'ref.jpg',
    });
    expect(await withWorkspace(a.ctx, (tx) => refcountMismatches(tx, a.ctx))).toEqual([]);

    // Rozpad denormalizace nasimulovaný ručně, přesně tak, jak by ho způsobil
    // pád mezi zápisem dokumentu a srovnáním referencí.
    await withWorkspace(a.ctx, (tx) =>
      tx
        .update(schema.assets)
        .set({ referenceCount: 3 })
        .where(and(eq(schema.assets.id, created.asset.id))),
    );

    const found = await withWorkspace(a.ctx, (tx) => refcountMismatches(tx, a.ctx));
    expect(found).toEqual([{ assetId: created.asset.id, stored: 3, actual: 0 }]);
  });
});

describe('přegenerování variant', () => {
  it('je idempotentní a doplní variantu, která chybí', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await uploadAsset(service(a), {
      content: await jpeg(1400, 700, 17),
      filename: 'znovu.jpg',
    });

    // Varianta smazaná z databáze i z disku, jako by ji nikdo nikdy nevyrobil.
    const removed = created.variants.find((v) => v.variant === 'w600')!;
    await createFileAssetStorage(uploads).remove(removed.storageKey);
    await withWorkspace(a.ctx, (tx) =>
      tx
        .delete(schema.assetVariants)
        .where(
          and(
            eq(schema.assetVariants.assetId, created.asset.id),
            eq(schema.assetVariants.variant, 'w600'),
          ),
        ),
    );

    const first = await processAsset(service(a), created.asset.id);
    expect(first.variants).toBe(4);
    // Druhý běh nad týmž assetem nesmí spadnout na porušení primárního klíče.
    const second = await processAsset(service(a), created.asset.id);
    expect(second.variants).toBe(4);

    const variants = await withWorkspace(a.ctx, (tx) =>
      listVariants(tx, a.ctx, [created.asset.id]),
    );
    expect(variants.map((v) => v.variant).sort()).toEqual(['thumb', 'w1200', 'w300', 'w600']);
    expect(await createFileAssetStorage(uploads).size(removed.storageKey)).toBeGreaterThan(0);
  });

  it('smazaný asset není chyba, jen nula variant', async () => {
    const a = await seedWorkspaceForCoreTests();
    const result = await processAsset(service(a), '11111111-1111-1111-1111-111111111111');
    expect(result.variants).toBe(0);
  });
});
