import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csAssets from '../../../../../packages/i18n/messages/cs/assets.json';
import { AssetsLibrary } from './assets-library';
import type { AssetRow } from './types';

const messages = { assets: csAssets };
const MAX = 10 * 1024 * 1024;

function asset(overrides: Partial<AssetRow> = {}): AssetRow {
  return {
    id: 'a1',
    publicId: 'pid1',
    mimeType: 'image/jpeg',
    byteSize: 34_567,
    width: 1200,
    height: 800,
    animated: false,
    altText: 'Popis',
    originalFilename: 'foto.jpg',
    source: 'upload',
    url: 'http://t/a/pid1/orig.jpg',
    thumbnailUrl: 'http://t/a/pid1/thumb.jpg',
    referenceCount: 0,
    hidden: false,
    usedBy: [],
    createdAt: '2026-08-04T10:00:00.000Z',
    ...overrides,
  };
}

function show(props: Partial<Parameters<typeof AssetsLibrary>[0]> = {}) {
  const fetchImpl = (props.fetchImpl ?? vi.fn()) as typeof globalThis.fetch;
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <AssetsLibrary
        initialAssets={props.initialAssets ?? [asset()]}
        workspaceId="ws1"
        canWrite={props.canWrite ?? true}
        maxUploadBytes={MAX}
        locale="cs"
        fetchImpl={fetchImpl}
        {...(props.loadFailed === undefined ? {} : { loadFailed: props.loadFailed })}
      />
    </NextIntlClientProvider>,
  );
}

describe('knihovna médií', () => {
  it('vypíše obrázky s rozměrem, velikostí a datem', () => {
    show({ initialAssets: [asset()] });
    const tile = screen.getByTestId('asset-tile');
    expect(within(tile).getByText('foto.jpg')).toBeInTheDocument();
    expect(within(tile).getByText(/1200 × 800 px/)).toBeInTheDocument();
    expect(within(tile).getByText(/34 kB/)).toBeInTheDocument();
    expect(within(tile).getByText(/Nahráno/)).toBeInTheDocument();
  });

  it('náhled bere z miniatury, ne z originálu', () => {
    // Mřížka s dvaceti originály po dvou megabajtech je deset megabajtů
    // stažených jen proto, aby se ukázaly čtvereční náhledy.
    show({ initialAssets: [asset()] });
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://t/a/pid1/thumb.jpg');
  });

  it('u použitého obrázku ukáže počet použití, u nepoužitého to řekne slovem', () => {
    show({
      initialAssets: [asset({ id: 'a1' }), asset({ id: 'a2', referenceCount: 2 })],
    });
    expect(screen.getByText(csAssets.usage.unused)).toBeInTheDocument();
    expect(screen.getByText('Použit 2 ×')).toBeInTheDocument();
  });

  it('obrázek bez popisu je označený, protože v e-mailu nemá alternativní text', () => {
    show({ initialAssets: [asset({ altText: null })] });
    expect(screen.getByText(csAssets.tile.noAlt)).toBeInTheDocument();
  });

  it('prázdná knihovna nabídne cestu k nahrání, ne slepou uličku', () => {
    show({ initialAssets: [] });
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'first');
    expect(within(empty).getByTestId('empty-explanation')).toHaveTextContent(
      csAssets.empty.explanation,
    );
  });

  it('bez práva zápisu se plocha pro nahrání vůbec nezobrazí', () => {
    show({ canWrite: false });
    expect(screen.queryByTestId('asset-dropzone')).not.toBeInTheDocument();
  });

  it('plocha pro nahrání má vedle přetažení i tlačítko pro klávesnici', () => {
    // WCAG 2.2, kritérium 2.5.7: co jde tažením, musí jít i bez něj.
    show();
    expect(screen.getByTestId('asset-dropzone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: csAssets.upload.chooseFiles })).toBeInTheDocument();
    expect(screen.getByLabelText(csAssets.upload.fileInput)).toHaveAttribute('multiple');
  });
});

describe('výběr a hromadné mazání', () => {
  it('zaškrtnutím se objeví lišta výběru s počtem', async () => {
    const user = userEvent.setup();
    show({ initialAssets: [asset({ id: 'a1' }), asset({ id: 'a2', originalFilename: 'b.png' })] });

    await user.click(screen.getByLabelText('Vybrat obrázek foto.jpg'));
    const bar = screen.getByTestId('selection-bar');
    expect(within(bar).getByText('Vybrán 1 obrázek')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Vybrat obrázek b.png'));
    expect(
      within(screen.getByTestId('selection-bar')).getByText('Vybrány 2 obrázky'),
    ).toBeInTheDocument();
  });

  it('u nepoužitého obrázku potvrzení nechce nic navíc a smaže', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { next_cursor: null, has_more: false, limit: 200 },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as unknown as typeof globalThis.fetch;

    show({ initialAssets: [asset()], fetchImpl });

    await user.click(screen.getByLabelText('Vybrat obrázek foto.jpg'));
    await user.click(screen.getByRole('button', { name: csAssets.selection.delete }));

    expect(await screen.findByText(csAssets.delete.safeLead)).toBeInTheDocument();
    // Bez použití se nezaškrtává nic navíc: potvrzení je jedno kliknutí.
    expect(screen.queryByText(csAssets.delete.confirmUnderstood)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: csAssets.delete.confirm }));

    await waitFor(() => expect(calls).toContain('DELETE /api/v1/assets/a1'));
  });

  it('POUŽITÝ obrázek nesmaže bez výslovného potvrzení a ukáže KDE se používá', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (String(url) === '/api/v1/assets/a1') {
        return new Response(
          JSON.stringify({
            id: 'a1',
            public_id: 'pid1',
            mime_type: 'image/jpeg',
            byte_size: 10,
            width: 4,
            height: 4,
            animated: false,
            alt_text: null,
            original_filename: 'foto.jpg',
            source: 'upload',
            url: 'http://t/a/pid1/orig.jpg',
            thumbnail_url: 'http://t/a/pid1/thumb.jpg',
            reference_count: 1,
            hidden: false,
            used_by: [{ type: 'template', id: 't1', name: 'Newsletter' }],
            created_at: '2026-08-04T10:00:00.000Z',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { next_cursor: null, has_more: false, limit: 200 },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as unknown as typeof globalThis.fetch;

    show({ initialAssets: [asset({ referenceCount: 1 })], fetchImpl });

    await user.click(screen.getByLabelText('Vybrat obrázek foto.jpg'));
    await user.click(screen.getByRole('button', { name: csAssets.selection.delete }));

    // Uživatel musí vidět místo, ne jen počet.
    expect(await screen.findByText(/Šablona Newsletter/)).toBeInTheDocument();
    expect(screen.getByText(csAssets.delete.usedLead)).toBeInTheDocument();

    // Kliknutí bez zaškrtnutí NESMÍ nic smazat.
    await user.click(screen.getByRole('button', { name: csAssets.delete.confirm }));
    expect(calls.filter((call) => call.startsWith('DELETE'))).toEqual([]);

    await user.click(screen.getByRole('checkbox', { name: csAssets.delete.confirmUnderstood }));
    await user.click(screen.getByRole('button', { name: csAssets.delete.confirm }));
    await waitFor(() => expect(calls).toContain('DELETE /api/v1/assets/a1'));
  });

  it('obrázek v ODESLANÉ kampani se ke smazání vůbec nenabídne', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (String(url) === '/api/v1/assets/a1') {
        return new Response(
          JSON.stringify({
            id: 'a1',
            public_id: 'pid1',
            mime_type: 'image/jpeg',
            byte_size: 10,
            width: 4,
            height: 4,
            animated: false,
            alt_text: null,
            original_filename: 'foto.jpg',
            source: 'upload',
            url: 'http://t/a/pid1/orig.jpg',
            thumbnail_url: 'http://t/a/pid1/thumb.jpg',
            reference_count: 1,
            hidden: false,
            used_by: [{ type: 'campaign', id: 'c1', name: 'Výprodej' }],
            created_at: '2026-08-04T10:00:00.000Z',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof globalThis.fetch;

    show({ initialAssets: [asset({ referenceCount: 1 })], fetchImpl });

    await user.click(screen.getByLabelText('Vybrat obrázek foto.jpg'));
    await user.click(screen.getByRole('button', { name: csAssets.selection.delete }));

    const blocked = await screen.findByTestId('delete-blocked');
    expect(within(blocked).getByText('foto.jpg')).toBeInTheDocument();
    expect(screen.getByText(csAssets.delete.blockedLead)).toBeInTheDocument();

    // Nic ke smazání nezbylo, takže se ani po kliknutí nic nesmaže.
    await user.click(screen.getByRole('button', { name: csAssets.delete.confirm }));
    expect(calls.filter((call) => call.startsWith('DELETE'))).toEqual([]);
  });
});

describe('hledání', () => {
  it('po odmlce pošle JEDEN dotaz s parametrem q, ne dotaz na každý stisk', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: unknown) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { next_cursor: null, has_more: false, limit: 200 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof globalThis.fetch;

    show({ fetchImpl });
    const input = screen.getByLabelText(csAssets.search.label);

    // `fireEvent.change`, ne `userEvent.type`: psaní znak po znaku je tady
    // podstata věci a musí se odehrát v jednom tiku, aby šlo změřit, kolik
    // dotazů z něj vzniklo. Se skutečnou klávesnicí by mezi znaky uběhl čas
    // a odmlka by se spustila vícekrát právem.
    fireEvent.change(input, { target: { value: 'l' } });
    fireEvent.change(input, { target: { value: 'lo' } });
    fireEvent.change(input, { target: { value: 'log' } });
    fireEvent.change(input, { target: { value: 'logo' } });

    // Bez odmlky by tu už byly čtyři dotazy a odpovědi by se předbíhaly.
    expect(urls).toEqual([]);

    await waitFor(() => expect(urls).toEqual(['/api/v1/assets?limit=200&q=logo']));
  });
});
