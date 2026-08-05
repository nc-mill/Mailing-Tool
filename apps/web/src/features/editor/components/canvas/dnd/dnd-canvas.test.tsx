import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type * as EditorConfig from '../../../config';
import type { EditorDocument } from '../../../model/document-types';
import { acceptsDrop } from './accepts';
import { DndCanvas } from './dnd-canvas';

vi.mock('../../../config', async (importOriginal) => ({
  ...(await importOriginal<typeof EditorConfig>()),
  EDITOR_DND_ENABLED: false,
}));

/** Sekce se sloupci: `[0]` sekce, `[0,0]` rozvržení, `[0,0,0]` a `[0,0,1]` sloupce. */
const document = (): EditorDocument =>
  ({
    schemaVersion: 1,
    meta: { name: 'T', previewText: '', language: 'cs' },
    theme: {},
    blocks: [
      {
        id: 'b_s1',
        type: 'section',
        props: {},
        children: [
          {
            id: 'b_c1',
            type: 'columns',
            props: {},
            children: [
              { id: 'b_col1', type: 'column', props: {}, children: [] },
              {
                id: 'b_col2',
                type: 'column',
                props: {},
                children: [{ id: 'b_t1', type: 'text', props: {} }],
              },
            ],
          },
        ],
      },
    ],
  }) as unknown as EditorDocument;

describe('DndCanvas', () => {
  it('při vypnutém přetahování vykreslí obsah bez knihovny', () => {
    render(
      <DndCanvas accepts={() => true} onInsert={() => {}} onMove={() => {}}>
        <p>obsah</p>
      </DndCanvas>,
    );
    expect(screen.getByText('obsah')).toBeInTheDocument();
    expect(screen.queryByTestId('dnd-context')).toBeNull();
  });
});

/**
 * Gramatika upuštění se bere z modelu, ne z odhadu. Tenhle výčet je zároveň
 * odpověď na „proč mi to sem nejde pustit": do sloupce smí obsahový blok,
 * ne sekce ani další sloupce, a nic nesmí spadnout samo do sebe.
 */
describe('kam se smí upustit', () => {
  const doc = document();
  const novy = (blockType: string) =>
    ({ kind: 'new', blockType, preset: {}, label: blockType }) as const;

  it('do sloupce smí obsahový blok', () => {
    expect(acceptsDrop(doc, novy('text'), [0, 0, 0])).toBe(true);
    expect(acceptsDrop(doc, novy('image'), [0, 0, 0])).toBe(true);
  });

  it('do sloupce nesmí sekce ani další rozvržení', () => {
    expect(acceptsDrop(doc, novy('section'), [0, 0, 0])).toBe(false);
    expect(acceptsDrop(doc, novy('columns'), [0, 0, 0])).toBe(false);
  });

  it('do kořene smí jen sekce', () => {
    expect(acceptsDrop(doc, novy('section'), [])).toBe(true);
    expect(acceptsDrop(doc, novy('text'), [])).toBe(false);
  });

  it('do sekce smí obsah i rozvržení, ne další sekce', () => {
    expect(acceptsDrop(doc, novy('columns'), [0])).toBe(true);
    expect(acceptsDrop(doc, novy('text'), [0])).toBe(true);
    expect(acceptsDrop(doc, novy('section'), [0])).toBe(false);
  });

  it('blok nesmí spadnout sám do sebe ani do svého potomka', () => {
    const presun = { kind: 'move', id: 'b_c1', blockType: 'columns', label: 'Sloupce' } as const;
    expect(acceptsDrop(doc, presun, [0])).toBe(true);
    expect(acceptsDrop(doc, presun, [0, 0, 0])).toBe(false);
  });

  it('text ze sloupce se smí přesunout do vedlejšího sloupce i do sekce', () => {
    const presun = { kind: 'move', id: 'b_t1', blockType: 'text', label: 'Text' } as const;
    expect(acceptsDrop(doc, presun, [0, 0, 0])).toBe(true);
    expect(acceptsDrop(doc, presun, [0])).toBe(true);
  });
});
