import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPILED_ONLY_ROOTS } from '@mlain/contracts/liquid/grammar';
import { createHtmlEngine } from '@mlain/contracts/liquid/engine';
import { prepareRenderData } from '@mlain/contracts/liquid/prepare-render-data';
import type { FieldCatalog } from '../../src/external/field-catalog';
import { compileDocument } from '../../src/compile/compile';
import type { AssetRef, CompileContext } from '../../src/compile/types';
import type { Document } from '../../src/document/types';
import { toPreparedSchema } from '../../src/paths';

const DOCUMENTS = join(import.meta.dirname, '../__fixtures__/documents');

const catalog: FieldCatalog = {
  version: 'golden',
  fields: [
    {
      path: 'first_name',
      type: 'string',
      label: { en: 'First name' },
      group: 'name',
      deleted: false,
    },
    {
      path: 'greeting',
      type: 'string',
      label: { en: 'Greeting' },
      group: 'salutation',
      deleted: false,
    },
    {
      path: 'created_at',
      type: 'datetime',
      label: { en: 'Created' },
      group: 'meta',
      deleted: false,
    },
    { path: 'attr.city', type: 'string', label: { en: 'City' }, group: 'custom', deleted: false },
    { path: 'attr.is_vip', type: 'boolean', label: { en: 'VIP' }, group: 'custom', deleted: false },
  ],
};

const asset: AssetRef = {
  id: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
  publicId: 'aB3dEfGhIjKlMnOpQrStUv',
  mimeType: 'image/png',
  width: 1200,
  height: 600,
  altText: null,
  animated: false,
  variants: [
    { variant: 'orig', width: 1200, height: 600 },
    { variant: 'w1200', width: 1200, height: 600 },
    { variant: 'w600', width: 600, height: 300 },
    { variant: 'w300', width: 300, height: 150 },
  ],
};

const darkAsset: AssetRef = {
  ...asset,
  id: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6072',
  publicId: 'darkdarkdarkdarkdarkda',
};

const context: CompileContext = {
  workspaceId: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6000',
  campaignId: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
  templateKind: 'campaign',
  fields: catalog,
  language: 'cs',
  assetBaseUrl: 'https://assets.example.test',
  assets: { [asset.id]: asset, [darkAsset.id]: darkAsset },
  purpose: 'send',
  trackOpens: true,
  trackClicks: true,
  currentYear: 2026,
  rawNonce: 'goldennonce',
};

const files = readdirSync(DOCUMENTS)
  .filter((name) => name.endsWith('.json'))
  .sort();

describe('golden render snapshots', () => {
  it('has at least sixteen documents', () => {
    expect(files.length).toBeGreaterThanOrEqual(16);
  });

  it.each(files)('%s renders to the stored html and text', async (file) => {
    const doc = JSON.parse(readFileSync(join(DOCUMENTS, file), 'utf8')) as Document;
    const result = await compileDocument(doc, context);
    if (!result.ok) throw new Error(`${file}: ${JSON.stringify(result.issues)}`);
    await expect(result.html).toMatchFileSnapshot(
      `../__fixtures__/expected/${file.replace('.json', '.html')}`,
    );
    await expect(result.text).toMatchFileSnapshot(
      `../__fixtures__/expected/${file.replace('.json', '.txt')}`,
    );
  });

  it('renders every fixture twice to the same bytes', async () => {
    for (const file of files) {
      const doc = JSON.parse(readFileSync(join(DOCUMENTS, file), 'utf8')) as Document;
      const a = await compileDocument(doc, context);
      const b = await compileDocument(doc, context);
      if (!a.ok || !b.ok) throw new Error(file);
      expect(a.html, file).toBe(b.html);
    }
  });

  it('keeps every fixture under one hundred kilobytes', async () => {
    for (const file of files) {
      const doc = JSON.parse(readFileSync(join(DOCUMENTS, file), 'utf8')) as Document;
      const result = await compileDocument(doc, context);
      if (!result.ok) throw new Error(file);
      expect(result.meta.htmlBytes, file).toBeLessThan(100_000);
    }
  });

  it('proves that the mobile heading size follows the theme, not a constant', async () => {
    const read = async (file: string) => {
      const doc = JSON.parse(readFileSync(join(DOCUMENTS, file), 'utf8')) as Document;
      const result = await compileDocument(doc, context);
      if (!result.ok) throw new Error(file);
      return result.html;
    };
    const base = await read('01-minimal.json');
    const big = await read('11-typography-20.json');
    const sizeOf = (html: string) => html.match(/\.ml-h1\{font-size:(\d+)px/)?.[1];
    expect(sizeOf(base)).not.toBe(sizeOf(big));
  });

  it('proves that the dark palette comes from the theme', async () => {
    const doc = JSON.parse(
      readFileSync(join(DOCUMENTS, '10-dark-custom.json'), 'utf8'),
    ) as Document;
    const result = await compileDocument(doc, context);
    if (!result.ok) throw new Error('10-dark-custom');
    expect(result.html).not.toContain('.ml-content{background-color:#111827!important}');
  });

  /**
   * Celý řetěz podmíněného bloku: model, kompilace, příprava dat a interpolace.
   * Kapitola 0.6 vysvětluje, proč tenhle test existuje: každý článek zvlášť je
   * v pořádku a rozejít se dokážou tak, že se to pozná až na odeslaném mailu,
   * kde chybí celá sekce a nikde přitom nic nespadlo.
   *
   * Test se schválně neptá konstant tohohle balíčku: jméno kořene bere
   * z `COMPILED_ONLY_ROOTS`, mapu plní kontraktní `prepareRenderData`
   * a interpoluje instancemi z kontraktů, tedy týmiž, jaké má náhled i sender.
   */
  it('presence map survives the whole chain, for both branches', async () => {
    const doc = JSON.parse(
      readFileSync(join(DOCUMENTS, '16-presence-chain.json'), 'utf8'),
    ) as Document;
    const result = await compileDocument(doc, context);
    if (!result.ok) throw new Error(`16-presence-chain: ${JSON.stringify(result.issues)}`);

    expect(COMPILED_ONLY_ROOTS).toContain('_present');
    expect(result.html).toContain('{% if _present.contact__attr__city %}');
    expect(result.meta.renderSchema.presence).toContain('contact.attr.city');

    const engine = createHtmlEngine();
    const render = async (city: unknown) => {
      const data = prepareRenderData(
        { contact: { attr: { city } } },
        toPreparedSchema(result.meta.renderSchema),
      );
      // Kdyby `prepareRenderData` nikdo nezavolal, `_present` v datech nebude,
      // podmínka vyjde nepravdivě a blok zmizí VŽDY. Proto je volání téhle
      // funkce při materializaci zapsané jako požadavek R11 na P13.
      expect(data._present).toHaveProperty('contact__attr__city');
      return engine.parseAndRender(result.html, data) as Promise<string>;
    };

    expect(await render('Brno')).toContain('Jsme i u vás');
    expect(await render('')).not.toContain('Jsme i u vás');
    // Past prázdného řetězce: samé mezery nejsou vyplněná hodnota.
    expect(await render('   ')).not.toContain('Jsme i u vás');
    expect(await render(null)).not.toContain('Jsme i u vás');
  });
});
