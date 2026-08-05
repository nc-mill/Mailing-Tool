import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@mlain/ui/patterns/toast';
import { SegmentList, type SegmentListRow } from '../../src/features/segments/segment-list';
import { renderIntl } from '../helpers/intl';

/**
 * Karta segmentu měla „Spočítat" i „Přepočítat" BEZ obsluhy, tedy dvě mrtvá
 * tlačítka. „Přepočítat" se navíc ukazuje právě tehdy, když je uložený počet
 * starší než šest hodin, tedy ve chvíli, kdy ho člověk potřebuje nejvíc.
 */

const refresh = vi.fn();
const push = vi.fn();
const recountSegmentAction = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push, refresh, replace: vi.fn(), back: vi.fn() }),
}));

const createSegmentFromPresetAction = vi.fn().mockResolvedValue({ status: 'success', id: 'new-1' });

vi.mock('../../src/features/segments/actions', () => ({
  recountSegmentAction: (...args: unknown[]) => recountSegmentAction(...args),
  createSegmentFromPresetAction: (...args: unknown[]) => createSegmentFromPresetAction(...args),
}));

const TOAST_LABELS = {
  undo: 'Vrátit zpět',
  close: 'Zavřít',
  notifications: 'Oznámení',
  countdown: (seconds: number) => `Zbývá ${seconds} s`,
  repeated: (message: string, count: number) => `${message} (${count})`,
};

/** Starší než šest hodin, takže se počet tváří zastarale a nabídne se přepočet. */
const STALE_AT = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();

const rows: SegmentListRow[] = [
  { id: 's-1', name: 'Nikdy nespočítaný', kind: 'dynamic', cachedCount: null, cachedAt: null },
  { id: 's-2', name: 'Zastaralý', kind: 'dynamic', cachedCount: 42, cachedAt: STALE_AT },
];

/** Číslo bez času poslední aktualizace. Takové řádky v databázi opravdu jsou. */
const withoutTimestamp: SegmentListRow[] = [
  { id: 's-3', name: 'Číslo bez data', kind: 'dynamic', cachedCount: 7, cachedAt: null },
];

const PRESET = {
  key: 'never_opened',
  labelKey: 'presets.neverOpened.title',
  explanationKey: 'presets.neverOpened.explanation',
  cachedCount: null,
  cachedAt: null,
};

function renderList(current: SegmentListRow[] = rows, presets = [PRESET]) {
  return renderIntl(
    <ToastProvider labels={TOAST_LABELS}>
      <SegmentList
        rows={current}
        presets={presets}
        workspaceSlug="eshop"
        workspaceId="w-1"
        locale="cs"
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  refresh.mockClear();
  push.mockClear();
  createSegmentFromPresetAction.mockClear();
  recountSegmentAction.mockReset().mockResolvedValue({ status: 'success' });
});

describe('SegmentList', () => {
  it('„Spočítat" opravdu spustí přepočet a načte nové číslo', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole('button', { name: 'Spočítat' }));

    expect(recountSegmentAction).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 's-1' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('„Přepočítat" u zastaralého počtu volá tentýž přepočet', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: 'Přepočítat' }));

    expect(recountSegmentAction).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 's-2' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('chyba se ohlásí, ne spolkne', async () => {
    const user = userEvent.setup();
    recountSegmentAction.mockResolvedValue({ status: 'error', code: 'segment_timeout' });
    renderList();

    await user.click(screen.getByRole('button', { name: 'Spočítat' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('segment_timeout');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('číslo bez času poslední aktualizace jde taky přepočítat', async () => {
    const user = userEvent.setup();
    renderList(withoutTimestamp);

    await user.click(await screen.findByRole('button', { name: 'Přepočítat' }));

    expect(recountSegmentAction).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 's-3' });
  });

  /*
   * „Použít" na kartě hotového segmentu volalo nepovinnou propu `onUse`, kterou
   * mu seznam nikdy nepředal, takže hlavní akce celé sekce „Začněte hotovým"
   * nedělala nic.
   */
  it('„Použít" založí segment z presetu a otevře ho', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole('button', { name: 'Použít' }));
    const field = await screen.findByLabelText('Název segmentu');
    expect(field).toHaveValue('Nikdy neotevřel');

    await user.click(screen.getByRole('button', { name: 'Založit segment' }));

    expect(createSegmentFromPresetAction).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      key: 'never_opened',
      name: 'Nikdy neotevřel',
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/w/eshop/segments/new-1'));
  });
});
