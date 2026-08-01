import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type * as EditorConfig from '../../../config';
import { DndCanvas, dropTargetFor } from './dnd-canvas';

vi.mock('../../../config', async (importOriginal) => ({
  ...(await importOriginal<typeof EditorConfig>()),
  EDITOR_DND_ENABLED: false,
}));

describe('DndCanvas', () => {
  it('při vypnutém přetahování vykreslí obsah bez knihovny', () => {
    render(
      <DndCanvas onMove={() => {}} items={[]}>
        <p>obsah</p>
      </DndCanvas>,
    );
    expect(screen.getByText('obsah')).toBeInTheDocument();
    expect(screen.queryByTestId('dnd-context')).toBeNull();
  });

  it('cíl upuštění spočítá rodiče a index z identity sousedů', () => {
    const items = [
      { id: 'b_h1', path: [0, 0] },
      { id: 'b_t1', path: [0, 1] },
      { id: 'b_d1', path: [0, 2] },
    ];
    expect(dropTargetFor(items, 'b_h1', 'b_d1')).toEqual({ parent: [0], index: 2 });
    expect(dropTargetFor(items, 'b_d1', 'b_h1')).toEqual({ parent: [0], index: 0 });
    expect(dropTargetFor(items, 'b_h1', 'b_h1')).toBeNull();
  });
});
