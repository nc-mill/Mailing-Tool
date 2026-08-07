import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SegmentAst } from '@mlain/ui/patterns/query-builder';
import { LiveCount } from '../../src/features/segments/live-count';
import { renderIntl } from '../helpers/intl';

/**
 * TŘI TLAČÍTKA ŽIVÉHO POČTU BYLA MRTVÁ: „Spočítat" volalo `setState` s kopií
 * téhož stavu, „Zkusit znovu" a „Přepočítat" neměly `onClick` vůbec. Dotaz na
 * počet byl zamčený v `useEffect`, takže neexistovalo nic, co by šlo zavolat.
 *
 * Testy kontrolují jedinou věc, na které uživateli záleží: že kliknutí pošle
 * na server nový dotaz. Kdyby se tlačítka odpojila, projde jich právě nula.
 */
const ast: SegmentAst = {
  version: 1,
  root: {
    type: 'group',
    op: 'and',
    children: [
      {
        type: 'condition',
        field: { kind: 'attribute', key: 'city' },
        operator: 'eq',
        value: 'Brno',
      },
    ],
  },
};

/** Deset hodin je nad hranicí `STALE_HOURS`, takže se ukáže „Přepočítat". */
const TEN_HOURS_AGO = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();

const fetchMock = vi.fn();

function okResponse(count: number) {
  return {
    ok: true,
    json: async () => ({ count, exact: true, warnings: [], sample: [] }),
  } as unknown as Response;
}

function failedResponse() {
  return {
    ok: false,
    json: async () => ({ detail: 'Server je zaneprázdněný.' }),
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('tlačítka živého počtu', () => {
  it('„Zkusit znovu" po chybě pošle nový dotaz a číslo se objeví', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(failedResponse());
    renderIntl(
      <LiveCount
        definition={ast}
        workspaceId="w-1"
        initial={{ count: 42, cachedAt: TEN_HOURS_AGO }}
      />,
    );

    // Automatický dotaz po odklepnutí selže, takže se ukáže chybová hláška.
    expect(await screen.findByRole('alert')).toHaveTextContent('Server je zaneprázdněný.');
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(okResponse(7));

    await user.click(screen.getByTestId('live-count-retry'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/segments/preview');
    // Číslo je na obrazovce dvakrát: viditelně a v `aria-live` pro odečítač.
    expect(await screen.findAllByText('7')).not.toHaveLength(0);
  });

  it('„Přepočítat" u zastaralého čísla pošle nový dotaz', async () => {
    const user = userEvent.setup();
    // Neúspěch drží původní razítko, takže „Přepočítat" zůstane na obrazovce.
    fetchMock.mockResolvedValue(failedResponse());
    renderIntl(
      <LiveCount
        definition={ast}
        workspaceId="w-1"
        initial={{ count: 42, cachedAt: TEN_HOURS_AGO }}
      />,
    );

    await screen.findByRole('alert');
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(okResponse(9));

    await user.click(screen.getByTestId('live-count-recount'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(await screen.findAllByText('9')).not.toHaveLength(0);
  });

  it('„Spočítat" u nikdy nepočítaného segmentu pošle dotaz hned, ne až po odklepnutí', async () => {
    fetchMock.mockResolvedValue(okResponse(3));
    renderIntl(<LiveCount definition={ast} workspaceId="w-1" />);

    // Klikne se DŘÍV, než uplyne odklepnutí (500 ms), takže jediný dotaz, který
    // v tu chvíli může existovat, je ten z tlačítka. Bez `onClick` je jich nula.
    await act(async () => {
      fireEvent.click(screen.getByTestId('live-count-run'));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/segments/preview');
  });
});

/**
 * ČTVRTÉ MRTVÉ TLAČÍTKO, „Spočítat přesně", SE NEVRACÍ.
 *
 * Odstraněno 7. 8. 2026, ne zapojeno, a tenhle test hlídá obě půlky toho
 * rozhodnutí: že u odhadu nestojí tlačítko bez obsluhy a že místo něj stojí
 * věta, proč je číslo přibližné.
 *
 * Zapojit ho nešlo: `POST /segments/preview` nemá čím vyžádat delší strop, ten
 * je nastavením instalace (`SEGMENT_PREVIEW_TIMEOUT_MS`). A i kdyby přijímal,
 * slib „přesně" by neplatil, protože s delším stropem může počítání dopadnout
 * stejně a uživatel by dostal podruhé odhad od tlačítka, které slíbilo přesné
 * číslo. Prvek, který dělá něco jiného, než slibuje, je horší než chybějící.
 */
describe('odhad počtu se přizná a nenabízí mrtvé tlačítko', () => {
  /** Odpověď, kterou server vrátí, když přesné počítání zabije časový strop. */
  function estimateResponse(count: number) {
    return {
      ok: true,
      json: async () => ({
        count,
        exact: false,
        warnings: ['segment_count_estimated'],
        sample: [],
      }),
    } as unknown as Response;
  }

  it('u odhadu vysvětlí, proč je číslo přibližné, a nenabízí „Spočítat přesně"', async () => {
    fetchMock.mockResolvedValue(estimateResponse(12000));
    renderIntl(<LiveCount definition={ast} workspaceId="w-1" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('live-count-run'));
    });

    // Odhad se přizná celou větou, ne jen číslem.
    expect(await screen.findByText(/Přibližně/)).toBeInTheDocument();
    // Věta říká, proč je přibližný, a kudy vede cesta k přesnému číslu.
    expect(screen.getByText(/přepočítá na pozadí s delším limitem/)).toBeInTheDocument();
    // Mrtvé tlačítko se nevrátilo.
    expect(screen.queryByRole('button', { name: /Spočítat přesně/ })).toBeNull();
  });
});
