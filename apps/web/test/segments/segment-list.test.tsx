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

const deleteSegmentAction = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('../../src/features/segments/actions', () => ({
  recountSegmentAction: (...args: unknown[]) => recountSegmentAction(...args),
  createSegmentFromPresetAction: (...args: unknown[]) => createSegmentFromPresetAction(...args),
  deleteSegmentAction: (...args: unknown[]) => deleteSegmentAction(...args),
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

/** Editor a výš. Čtenář má `write: false`, viz testy nabídky níž. */
const ALL_PERMISSIONS = { write: true, readContacts: true };

function renderList(
  current: SegmentListRow[] = rows,
  presets = [PRESET],
  permissions = ALL_PERMISSIONS,
) {
  return renderIntl(
    <ToastProvider labels={TOAST_LABELS}>
      <SegmentList
        rows={current}
        presets={presets}
        workspaceSlug="eshop"
        workspaceId="w-1"
        locale="cs"
        permissions={permissions}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  refresh.mockClear();
  push.mockClear();
  createSegmentFromPresetAction.mockClear();
  deleteSegmentAction.mockReset().mockResolvedValue({ status: 'success' });
  recountSegmentAction.mockReset().mockResolvedValue({ status: 'success' });
});

/**
 * Přepočet bydlí v nabídce „Další akce" v řádku, jak ji kreslí návrh. Test ji
 * musí nejdřív otevřít: zavřená nabídka svoje položky vůbec nevykresluje.
 */
async function openRowMenu(user: ReturnType<typeof userEvent.setup>, index: number) {
  const triggers = await screen.findAllByRole('button', { name: /Další akce se segmentem/ });
  const trigger = triggers[index];
  if (trigger === undefined) throw new Error(`Řádek ${index} nemá nabídku akcí.`);
  await user.click(trigger);
}

function itemNames() {
  return screen.getAllByRole('menuitem').map((item) => item.textContent);
}

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

    await openRowMenu(user, 1);
    await user.click(await screen.findByRole('menuitem', { name: 'Přepočítat' }));

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

    await openRowMenu(user, 0);
    await user.click(await screen.findByRole('menuitem', { name: 'Přepočítat' }));

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

/**
 * KDYBY TENHLE BLOK SPADL: ze seznamu segmentů zase nejde nic než přepočet.
 * Přesně tak vypadala nabídka do 6. 8. 2026: jediná položka, žádná cesta na
 * kontakty ani na úpravu, a smazat segment nešlo z aplikace vůbec, přestože
 * `DELETE /api/v1/segments/{id}` v jádru existuje od začátku.
 */
describe('nabídka „…" v řádku segmentu', () => {
  it('editor má přepočet, kontakty, úpravu a smazání', async () => {
    const user = userEvent.setup();
    renderList();

    await openRowMenu(user, 1);
    expect(itemNames()).toEqual(['Přepočítat', 'Zobrazit kontakty', 'Upravit', 'Smazat']);
  });

  /*
   * Přepočet si vyžádá `segments:write` (`segments.routes.ts:549`), přestože
   * se čtenáři jeví jako čtení. Do 6. 8. 2026 se nabízel všem a čtenáři skončil
   * na 403 bez vysvětlení.
   */
  it('čtenáři zbydou jen kontakty, ne přepočet ani úprava', async () => {
    const user = userEvent.setup();
    renderList(rows, [PRESET], { write: false, readContacts: true });

    await openRowMenu(user, 1);
    expect(itemNames()).toEqual(['Zobrazit kontakty']);
  });

  it('bez jediné použitelné akce se nekreslí ani spouštěč', () => {
    renderList(rows, [PRESET], { write: false, readContacts: false });
    expect(screen.queryByRole('button', { name: /Další akce se segmentem/ })).toBeNull();
  });

  it('nikdy nepočítaný segment nabízí „Spočítat", ne „Přepočítat"', async () => {
    const user = userEvent.setup();
    renderList();

    await openRowMenu(user, 0);
    expect(itemNames()).toEqual(['Spočítat', 'Zobrazit kontakty', 'Upravit', 'Smazat']);
  });

  it('„Zobrazit kontakty" vede na seznam zúžený na segment', async () => {
    const user = userEvent.setup();
    renderList();

    await openRowMenu(user, 1);
    await user.click(screen.getByRole('menuitem', { name: 'Zobrazit kontakty' }));

    expect(push).toHaveBeenCalledWith('/w/eshop/contacts?segment_id=s-2');
  });

  it('„Upravit" otevře stavitele segmentu', async () => {
    const user = userEvent.setup();
    renderList();

    await openRowMenu(user, 1);
    await user.click(screen.getByRole('menuitem', { name: 'Upravit' }));

    expect(push).toHaveBeenCalledWith('/w/eshop/segments/s-2');
  });

  /*
   * KDYBY TENHLE TEST SPADL: z okna mazání zmizela věta o kontaktech a lidé si
   * budou myslet, že smazáním segmentu mažou lidi. V řádku vidí číslo „42"
   * a pod ním červené „Smazat", takže ten závěr je přirozený.
   */
  it('okno mazání říká, že kontakty zůstávají, a že to nejde vrátit', async () => {
    const user = userEvent.setup();
    renderList();

    await openRowMenu(user, 1);
    await user.click(screen.getByRole('menuitem', { name: 'Smazat' }));

    expect(await screen.findByText(/Smazat segment Zastaralý\?/)).toBeInTheDocument();
    expect(screen.getByText(/Kontakty se nemažou/)).toBeInTheDocument();
    expect(screen.getByText(/Vrátit to nejde/)).toBeInTheDocument();
    // Dynamický segment žádný ruční soupis členů nemá, takže se ta věta neslibuje.
    expect(screen.queryByText(/Ruční soupis členů/)).toBeNull();
  });

  it('ruční segment navíc řekne, že s ním zmizí soupis členů', async () => {
    const user = userEvent.setup();
    renderList([{ ...rows[1]!, kind: 'static' }]);

    await openRowMenu(user, 0);
    await user.click(screen.getByRole('menuitem', { name: 'Smazat' }));

    expect(await screen.findByText(/Ruční soupis členů/)).toBeInTheDocument();
  });

  it('potvrzení smaže segment a obnoví seznam', async () => {
    const user = userEvent.setup();
    renderList();

    await openRowMenu(user, 1);
    await user.click(screen.getByRole('menuitem', { name: 'Smazat' }));
    await user.click(await screen.findByRole('button', { name: 'Smazat segment' }));

    expect(deleteSegmentAction).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 's-2' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  /*
   * Chyba zůstává v okně, seznam se neobnovuje: obnova by hlášku přebila novým
   * vykreslením a uživatel by se nedozvěděl, proč se nic nestalo.
   */
  it('selhání zůstane v okně a seznam se neobnoví', async () => {
    const user = userEvent.setup();
    deleteSegmentAction.mockResolvedValueOnce({ status: 'error', code: 'insufficient_scope' });
    renderList();

    await openRowMenu(user, 1);
    await user.click(screen.getByRole('menuitem', { name: 'Smazat' }));
    await user.click(await screen.findByRole('button', { name: 'Smazat segment' }));

    expect(await screen.findByTestId('delete-segment-error')).toHaveTextContent(
      'insufficient_scope',
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
