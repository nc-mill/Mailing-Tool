import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '../../../src/document/defaults';
import { resolveTheme } from '../../../src/theme/resolve';
import { RawSlotSink } from '../../../src/normalize/slots';
import type { EmitterState } from '../../../src/emitter/ctx';
import { assetUrl, pickVariant } from '../../../src/emitter/assets';
import { ImageBlockView } from '../../../src/emitter/blocks/image';
import type { AssetRef } from '../../../src/compile/types';
import type { ImageBlock } from '../../../src/document/types';

const photo: AssetRef = {
  id: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
  publicId: 'aB3dEfGhIjKlMnOpQrStUv',
  mimeType: 'image/jpeg',
  width: 2400,
  height: 1200,
  altText: null,
  animated: false,
  variants: [
    { variant: 'orig', width: 2400, height: 1200 },
    { variant: 'w1200', width: 1200, height: 600 },
    { variant: 'w600', width: 600, height: 300 },
    { variant: 'w300', width: 300, height: 150 },
  ],
};

const gif: AssetRef = {
  ...photo,
  id: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6072',
  publicId: 'gifgifgifgifgifgifgifg',
  mimeType: 'image/gif',
  animated: true,
  variants: [{ variant: 'orig', width: 600, height: 300 }],
};

const state = (assets: Record<string, AssetRef>): EmitterState => ({
  theme: resolveTheme(DEFAULT_THEME),
  raw: new RawSlotSink('ab12cd34ef'),
  assets,
  assetBaseUrl: 'https://assets.test',
  language: 'cs',
  skippedBlockIds: new Set<string>(),
  trackClicks: true,
  linkHref: (href: string, trackable: boolean) =>
    trackable ? 'https://track.mlain.invalid/c/2f1a9c40-0000-5000-8000-000000000001' : href,
  t: (key: string) => key,
});

const wrap = (
  make: (emitter: EmitterState) => React.ReactElement,
  assets: Record<string, AssetRef>,
) => render(make(state(assets)));

describe('asset urls', () => {
  it('builds the public url from the base, the public id and the variant', () => {
    expect(assetUrl('https://assets.test', photo, 'w600')).toBe(
      'https://assets.test/a/aB3dEfGhIjKlMnOpQrStUv/w600.jpg',
    );
  });

  it('uses png for png assets and gif for gif assets', () => {
    expect(assetUrl('https://assets.test', { ...photo, mimeType: 'image/png' }, 'orig')).toBe(
      'https://assets.test/a/aB3dEfGhIjKlMnOpQrStUv/orig.png',
    );
    expect(assetUrl('https://assets.test', gif, 'orig')).toBe(
      'https://assets.test/a/gifgifgifgifgifgifgifg/orig.gif',
    );
  });

  it('picks the smallest variant at least twice the display width', () => {
    expect(pickVariant(photo, 600)).toBe('w1200');
    expect(pickVariant(photo, 150)).toBe('w300');
    expect(pickVariant(photo, 1400)).toBe('orig');
  });

  it('keeps the original for an animated gif so the animation survives', () => {
    expect(pickVariant(gif, 300)).toBe('orig');
  });
});

describe('image block', () => {
  const block = (over: Record<string, unknown> = {}): ImageBlock =>
    ({
      id: 'b_000000000001',
      type: 'image' as const,
      props: { ...blockDefaults('image'), assetId: photo.id, alt: 'Fotka', ...over },
    }) as ImageBlock;

  it('emits width and height attributes and display block', async () => {
    const html = await wrap(
      (emitter) => <ImageBlockView block={block()} width={600} emitter={emitter} />,
      { [photo.id]: photo },
    );
    expect(html).toContain('width="600"');
    expect(html).toContain('height="300"');
    expect(html).toContain('display:block');
    expect(html).toContain('/w1200.jpg');
  });

  it('always emits an alt attribute, even empty for decorative images', async () => {
    const html = await wrap(
      (emitter) => (
        <ImageBlockView
          block={block({ decorative: true, alt: '' })}
          width={600}
          emitter={emitter}
        />
      ),
      {
        [photo.id]: photo,
      },
    );
    expect(html).toContain('alt=""');
    expect(html).toContain('role="presentation"');
  });

  it('wraps a linked image in the tracking marker', async () => {
    const html = await wrap(
      (emitter) => (
        <ImageBlockView
          block={block({ href: 'https://shop.cz/akce' })}
          width={600}
          emitter={emitter}
        />
      ),
      { [photo.id]: photo },
    );
    expect(html).toContain(
      'href="https://track.mlain.invalid/c/2f1a9c40-0000-5000-8000-000000000001"',
    );
  });

  it('emits both logo variants when a dark asset is set', async () => {
    const dark = {
      ...photo,
      id: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6073',
      publicId: 'darkdarkdarkdarkdarkda',
    };
    const html = await wrap(
      (emitter) => (
        <ImageBlockView
          block={block({ darkVariantAssetId: dark.id })}
          width={600}
          emitter={emitter}
        />
      ),
      { [photo.id]: photo, [dark.id]: dark },
    );
    expect(html).toContain('ml-logo-light');
    expect(html).toContain('ml-logo-dark');
    expect(html).toContain('mso-hide:all');
  });

  it('renders nothing when the asset is missing instead of emitting a broken img', async () => {
    const html = await wrap(
      (emitter) => <ImageBlockView block={block()} width={600} emitter={emitter} />,
      {},
    );
    expect(html).not.toContain('<img');
  });
});
