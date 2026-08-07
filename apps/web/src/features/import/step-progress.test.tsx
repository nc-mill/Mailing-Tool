import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/helpers/intl';
import { StepProgress } from './step-progress';

const IMPORT_ID = '9855e936-c11a-4b3d-b799-33a53178916c';
const WORKSPACE_ID = '019fbf52-d8b9-7b0d-b67e-528e8026a383';

/**
 * Krok 6 průvodce importem neměl do téhle chvíle žádný test, a právě proto se
 * v něm usadily dvě vady, které jednotková síť nemohla chytit ani náhodou:
 * SSE bez reference na projekt (404) a dotazování, které nikdy neskončí.
 * Obojí se ukázalo až v prohlížeči proti produkční image.
 */

/** Nejmenší náhrada za `EventSource`, která umí selhat i doručit událost. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data?: unknown): void {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(data === undefined ? {} : { data: JSON.stringify(data) });
    }
  }
}

const importRow = (status: string) => ({
  checkpoint_row: 50,
  total_rows: 50,
  status,
});

describe('StepProgress', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posílá referenci na projekt v query, protože EventSource neumí hlavičku', () => {
    renderIntl(<StepProgress importId={IMPORT_ID} workspaceId={WORKSPACE_ID} />);

    const url = FakeEventSource.instances[0]?.url ?? '';
    expect(url).toContain(`/api/v1/contacts/imports/${IMPORT_ID}/events`);
    expect(url).toContain(`workspace_id=${WORKSPACE_ID}`);
  });

  it('po přechodu na dotazování ohlásí konec importu', async () => {
    const onDone = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => importRow('completed') });
    vi.stubGlobal('fetch', fetchMock);

    renderIntl(<StepProgress importId={IMPORT_ID} workspaceId={WORKSPACE_ID} onDone={onDone} />);

    // Tři neúspěchy SSE za sebou přepnou obrazovku na dotazování.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      FakeEventSource.instances.at(-1)?.emit('error');
    }
    expect(await screen.findByText(/Živé aktualizace se nedaří/)).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(5000);

    // Tohle je jádro regrese: dřív se `onDone` volalo VÝHRADNĚ ze SSE, takže
    // uživatel zůstal na „Importujeme kontakty" i po stoprocentním průběhu.
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('completed'));
  });

  it('při dotazování nedokončeného importu se neohlašuje konec', async () => {
    const onDone = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => importRow('importing') }));

    renderIntl(<StepProgress importId={IMPORT_ID} workspaceId={WORKSPACE_ID} onDone={onDone} />);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      FakeEventSource.instances.at(-1)?.emit('error');
    }

    await vi.advanceTimersByTimeAsync(15_000);
    expect(onDone).not.toHaveBeenCalled();
  });
  /**
   * NEČITELNÝ PRŮBĚH SE PŘIZNÁ, NEZAMRZNE.
   *
   * Dokud se odpověď brala, jak přišla, dosadila cizí nebo chybová odpověď do
   * počítadla `undefined` a stav `undefined`. Navenek to vypadalo jako import,
   * který se rozjel a stojí: obrazovka ukazovala „0 z N" a k tomu větu, že
   * import běží na serveru. Konec se navíc nemohl poznat nikdy, protože se
   * porovnával stav, který v odpovědi nebyl. Nahlášeno 7. 8. 2026 jako průběh
   * zamrzlý na nule u importu, který byl dávno dokončený.
   */
  it('cizí odpověď při dotazování NEZAMRZNE na nule, ale řekne se o tom', async () => {
    const onDone = vi.fn();
    // Odpověď bez `checkpoint_row` i `status`: takhle vypadá chybové tělo API
    // nebo přihlašovací stránka po vypršení relace.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ error: 'nope' }) }));

    renderIntl(<StepProgress importId={IMPORT_ID} workspaceId={WORKSPACE_ID} onDone={onDone} />);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      FakeEventSource.instances.at(-1)?.emit('error');
    }
    await vi.advanceTimersByTimeAsync(5000);

    expect(await screen.findByText(/Průběh importu se nedaří načíst/)).toBeInTheDocument();
    // A hlavně: obrazovka přestane tvrdit, že import běží. To tvrzení v tu chvíli
    // nikdo neověřil a právě ono dělalo ze zamrzlé obrazovky přesvědčivou lež.
    expect(screen.queryByText(/běží na serveru/i)).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('po obnovení čitelné odpovědi se hlášení zase schová', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ error: 'nope' }) })
      .mockResolvedValue({ json: async () => importRow('importing') });
    vi.stubGlobal('fetch', fetchMock);

    renderIntl(<StepProgress importId={IMPORT_ID} workspaceId={WORKSPACE_ID} />);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      FakeEventSource.instances.at(-1)?.emit('error');
    }
    await vi.advanceTimersByTimeAsync(5000);
    expect(await screen.findByText(/Průběh importu se nedaří načíst/)).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(5000);
    await waitFor(() => expect(screen.queryByText(/Průběh importu se nedaří načíst/)).toBeNull());
  });
});
