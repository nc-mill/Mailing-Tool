import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import type { EditorDocument } from '../../model/document-types';
import { createFakePorts } from '../../ports/fake-ports';
import type { EditorPorts, Finding } from '../../ports/types';
import { createEditorStore } from '../../state/editor-store';
import { useValidation } from './use-validation';

/**
 * Kdo v editoru vlastní seznam nálezů.
 *
 * Jsou dva zdroje: klientská validace, která běží na každou změnu dokumentu,
 * a jednorázová odpověď `POST /validate`, která umí navíc předodesílací
 * kontrolu (kódy `precheck_*`). Soubor vznikl kvůli vadě, kdy si ty dva
 * zdroje šlapaly po sobě a serverové nálezy z obrazovky mizely dřív, než je
 * kdo stačil přečíst.
 */
const document = (): EditorDocument =>
  ({
    schemaVersion: 1,
    meta: { name: 'T', previewText: '', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [
      {
        id: 'b_000000000001',
        type: 'section',
        props: blockDefaults('section'),
        children: [{ id: 'b_000000000099', type: 'footer', props: blockDefaults('footer') }],
      },
    ],
  }) as unknown as EditorDocument;

const catalog = { version: 'v1', fields: [] };

/** Dvě patičky v jedné sekci: chyba, kterou klientská validace pozná sama. */
const seDvemaPatickami = (): EditorDocument =>
  ({
    ...document(),
    blocks: [
      {
        id: 'b_000000000001',
        type: 'section',
        props: blockDefaults('section'),
        children: [
          { id: 'b_000000000099', type: 'footer', props: blockDefaults('footer') },
          { id: 'b_000000000098', type: 'footer', props: blockDefaults('footer') },
        ],
      },
    ],
  }) as unknown as EditorDocument;

function mount(
  findings: Finding[],
  store = createEditorStore({ document: document(), designHash: 'h1' }),
) {
  const ports: EditorPorts = createFakePorts({
    validate: () => Promise.resolve({ findings }),
  });
  function Probe() {
    useValidation({
      store,
      ports,
      templateId: 't1',
      fieldCatalog: catalog as never,
      templateKind: 'campaign',
    });
    return null;
  }
  render(<Probe />);
  return store;
}

/** Odpověď `/validate` z vývojové instalace: dvě varování a JEDNA skutečná chyba. */
const serverovaOdpoved: Finding[] = [
  { code: 'precheck_preheader_empty', severity: 'warning', message: 'Chybí úvodní řádek.' },
  {
    code: 'precheck_app_url_not_public',
    severity: 'error',
    message: 'Adresa aplikace není veřejná.',
    params: { app_url: 'http://localhost:3200' },
  },
  {
    code: 'link_ids_not_campaign_scoped',
    severity: 'warning',
    message: 'Odkazy nejsou v kampani.',
  },
];

describe('nálezy v editoru', () => {
  it('chybu ze serveru si editor nechá, varování ze stejné odpovědi zahodí', async () => {
    const store = mount(serverovaOdpoved);
    await act(async () => {
      await Promise.resolve();
    });

    const issues = store.getState().issues;
    expect(issues.map((issue) => issue.code)).toEqual(['precheck_app_url_not_public']);
    // Závažnost se cestou nikde neztrácí ani nepřepisuje. Panel dřív hlásil
    // „žádná chyba, 3 varování", jenže ne proto, že by chybu započítal špatně:
    // serverovou odpověď mu z ruky vyrazila klientská validace, viz test níž.
    expect(issues[0]?.severity).toBe('error');
  });

  it('serverový nález přežije změnu stavu, která se dokumentu netýká', async () => {
    const store = mount(serverovaOdpoved);
    await act(async () => {
      await Promise.resolve();
    });

    // Ukládání mění `status`, ne dokument. Dřív tahle jediná změna spustila
    // odběr, ten přepočítal klientskou validaci a serverové nálezy přepsal,
    // takže předodesílací chyba z obrazovky zmizela dřív, než ji šlo přečíst.
    act(() => {
      store.setStatus('saving');
      store.markSaved('h2', Date.now());
    });

    expect(store.getState().issues.map((issue) => issue.code)).toEqual([
      'precheck_app_url_not_public',
    ]);
  });

  it('po úpravě dokumentu chyba ze serveru ZŮSTÁVÁ, jen označená za zastaralou', async () => {
    const store = mount(serverovaOdpoved);
    await act(async () => {
      await Promise.resolve();
    });

    // Druhá patička je chyba, kterou klient pozná sám.
    act(() => {
      store.replaceDocument(seDvemaPatickami(), 'h3');
    });

    const issues = store.getState().issues;
    expect(issues.map((issue) => issue.code)).toContain('content_duplicate_footer');
    // Tohle je celý smysl slučování: chyba ze serveru se nesmí ztratit jen
    // proto, že uživatel napsal písmeno. Serverová validace běží jednorázově,
    // takže by ji každá úprava jinak umlčela až do dalšího otevření editoru.
    const ze_serveru = issues.find((issue) => issue.code === 'precheck_app_url_not_public');
    expect(ze_serveru).toBeDefined();
    // Netváří se ale jako čerstvá: mluví o verzi před úpravou.
    expect(ze_serveru?.stale).toBe(true);
  });

  it('dokud se dokument nezmění, není serverový nález zastaralý', async () => {
    const store = mount(serverovaOdpoved);
    await act(async () => {
      await Promise.resolve();
    });

    expect(store.getState().issues[0]?.stale).toBeUndefined();
  });

  it('uložení pustí serverovou validaci znovu a zastaralost tím zmizí', async () => {
    let odpoved = serverovaOdpoved;
    const store = createEditorStore({ document: document(), designHash: 'h1' });
    const ports: EditorPorts = createFakePorts({
      validate: () => Promise.resolve({ findings: odpoved }),
    });
    function Probe() {
      useValidation({
        store,
        ports,
        templateId: 't1',
        fieldCatalog: catalog as never,
        templateKind: 'campaign',
      });
      return null;
    }
    render(<Probe />);
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      store.replaceDocument(seDvemaPatickami(), 'h3');
    });
    expect(
      store.getState().issues.find((i) => i.code === 'precheck_app_url_not_public')?.stale,
    ).toBe(true);

    // Uživatel mezitím chybu opravil a editor uložil. Server odpoví o nové
    // verzi, takže starý nález nemá proč zůstat zastaralý viset.
    odpoved = [];
    await act(async () => {
      store.markSaved('h4', Date.now());
      await Promise.resolve();
    });

    expect(store.getState().issues.map((i) => i.code)).not.toContain('precheck_app_url_not_public');
  });

  it('klientská varování se do stavu nedostanou vůbec', async () => {
    const store = createEditorStore({ document: document(), designHash: 'h1' });
    mount([], store);
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      // Obrázek bez popisu je varování (`content_image_missing_alt`).
      store.replaceDocument(
        {
          ...document(),
          blocks: [
            {
              id: 'b_000000000001',
              type: 'section',
              props: blockDefaults('section'),
              children: [
                {
                  id: 'b_000000000097',
                  type: 'image',
                  props: { ...blockDefaults('image'), assetId: 'a', alt: '' },
                },
                { id: 'b_000000000099', type: 'footer', props: blockDefaults('footer') },
              ],
            },
          ],
        } as unknown as EditorDocument,
        'h4',
      );
    });

    expect(store.getState().issues.every((issue) => issue.severity === 'error')).toBe(true);
    expect(store.getState().issues.map((issue) => issue.code)).not.toContain(
      'content_image_missing_alt',
    );
  });
});
