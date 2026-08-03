import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Zapojení, ne chování extrakce. Chování měří `brand-extract.test.ts`.
 *
 * Tenhle soubor odpovídá na otázku, na kterou byla obsluha fronty dřív špatně:
 * DÁ SE VŮBEC ZAVOLAT TAK, JAK JI VOLÁ PG-BOSS? Předchozí `handler` měl podpis
 * `(job: { data, deps })` a čekal, že mu `deps` někdo podstrčí zvenčí. Worker
 * takový parametr nemá čím naplnit, takže se fronta nedala zaregistrovat
 * a extrakce zůstávala navždy v `pending`, aniž by cokoliv spadlo.
 */
const runBrandExtraction = vi.fn(
  async (_job: { extractionId: string }, _deps: unknown): Promise<void> => undefined,
);
const createBrandExtractDeps = vi.fn((ctx: { workspaceId: string }) => ({
  marker: ctx.workspaceId,
}));

vi.mock('./brand-extract', () => ({ runBrandExtraction }));
vi.mock('./brand-extract-deps', () => ({ createBrandExtractDeps }));

const { brandExtractHandler } = await import('./brand-extract-handler');
const { missingDependenciesOf } = await import('../../queues');

beforeEach(() => {
  runBrandExtraction.mockClear();
  createBrandExtractDeps.mockClear();
});

/** Projekty musí být UUID: `createSystemContext` si to ověřuje. */
const W1 = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
const W2 = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6072';

const job = (id: string, workspaceId = W1) => ({
  id: `job-${id}`,
  name: 'content.brand_extract',
  data: { workspaceId, extractionId: id },
});

describe('obsluha fronty content.brand_extract', () => {
  /**
   * Prázdná dávka je nejlevnější důkaz, že obsluha DÁVKU vůbec čeká. Neobalená
   * funkce by na ní sáhla na `.data` a spadla; obal ji přijme a neudělá nic.
   */
  it('bere dávku úloh, ne jednu úlohu', async () => {
    await expect(brandExtractHandler([])).resolves.toBeUndefined();
    expect(runBrandExtraction).not.toHaveBeenCalled();
  });

  it('každou úlohu z dávky spustí zvlášť a závislosti složí pro její projekt', async () => {
    await brandExtractHandler([job('e1', W1), job('e2', W2)]);

    expect(runBrandExtraction).toHaveBeenCalledTimes(2);
    expect(runBrandExtraction.mock.calls[0]![0]).toEqual({ extractionId: 'e1' });
    expect(runBrandExtraction.mock.calls[1]![0]).toEqual({ extractionId: 'e2' });

    // Závislosti se skládají PER ÚLOHA a pro projekt z nákladu. Jedna sada na
    // celý proces by pod RLS četla cizí projekt, respektive žádný.
    //
    // Předává se OVĚŘENÝ KONTEXT, ne holé id: kompoziční kořen otevírá
    // transakce, takže by podle řetězce rozhodoval o izolaci sám. Aktér je
    // systémový a nese jméno úlohy, protože `audit_log.actor_label` se plní
    // právě z něj.
    expect(createBrandExtractDeps.mock.calls[0]![0]).toEqual({
      workspaceId: W1,
      actor: { type: 'system', job: 'content.brand_extract' },
    });
    expect(createBrandExtractDeps.mock.calls[1]![0]).toEqual({
      workspaceId: W2,
      actor: { type: 'system', job: 'content.brand_extract' },
    });
    expect(runBrandExtraction.mock.calls[0]![1]).toEqual({ marker: W1 });
    expect(runBrandExtraction.mock.calls[1]![1]).toEqual({ marker: W2 });
  });

  /**
   * Důkaz o rozsahu není jen jméno typu. `createSystemContext` je jediná
   * legitimní továrna kontextu a sama odmítne id, které není UUID, takže
   * podvržený náklad se nedostane ani k první transakci.
   */
  it('projekt, který není UUID, neprojde přes továrnu kontextu', async () => {
    await expect(brandExtractHandler([job('e1', 'w1')])).rejects.toThrow();
    expect(createBrandExtractDeps).not.toHaveBeenCalled();
    expect(runBrandExtraction).not.toHaveBeenCalled();
  });

  /**
   * REGRESE, kterou tenhle test chytá: náklad bez projektu. Bez `workspaceId`
   * nemá obsluha pod čím otevřít transakci, RLS by nepustila ani řádek
   * a `loadExtraction` by hlásil neexistující extrakci. Úloha musí skončit
   * nahlas, ne tichým úspěchem nad prázdným výsledkem.
   */
  it('náklad bez projektu skončí výjimkou, ne tichým úspěchem', async () => {
    await expect(
      brandExtractHandler([
        { id: 'job-x', name: 'content.brand_extract', data: { extractionId: 'e1' } },
      ]),
    ).rejects.toThrow(/workspaceId/);
    expect(runBrandExtraction).not.toHaveBeenCalled();
  });

  it('náklad bez extrakce skončí výjimkou', async () => {
    await expect(
      brandExtractHandler([
        { id: 'job-x', name: 'content.brand_extract', data: { workspaceId: W1 } },
      ]),
    ).rejects.toThrow(/extractionId/);
  });

  /**
   * Obsluha je SLOŽENÁ, ne zástupka `needsDependencies`. Ta se od skutečné
   * obsluhy nepozná typem (obojí je `function`), jen značkou, kterou nese.
   */
  it('není zástupka za nedodané závislosti', () => {
    expect(missingDependenciesOf(brandExtractHandler)).toBeUndefined();
  });
});
