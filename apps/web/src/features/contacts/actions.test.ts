import { beforeEach, describe, expect, it, vi } from 'vitest';
// Typ modulu se bere `import type`, ne `typeof import(...)` uvnitř anotace:
// vložené `import()` v typu zakazuje pravidlo `consistent-type-imports`.
// Skutečný modul se pořád načítá až dynamicky v testu, aby platily `vi.mock`.
import type * as ActionsModule from './actions';

/**
 * Regrese na nález I92: serverové akce kontaktů volaly API BEZ `workspaceId`.
 *
 * Požadavku pak chyběla hlavička `X-Workspace-Id`, běžel mimo kontext projektu,
 * RLS nevrátila ani řádek a uživatel dostal 404 na kontakt, který měl otevřený
 * na obrazovce. Chyba se nedala odhalit typem ani lintem: `workspaceId` je
 * v `MutateOptions` nepovinný, protože ho nemají akce přihlášení a profilu.
 *
 * Test proto kontroluje CHOVÁNÍ a hlídá VŠECHNY akce souboru naráz, ne jen ty
 * tři z nálezu: každá zavolaná akce musí do klienta poslat `workspaceId`, a když
 * někdo přidá akci sedmnáctou a zapomene na něj, spadne to tady.
 */

const mutate = vi.fn().mockResolvedValue({ ok: true, data: { id: 'x', email: 'a@b.cz' } });
const fetchApi = vi.fn().mockResolvedValue({ ok: true, data: { contacts: 0 } });

vi.mock('@/lib/api-client/mutate', () => ({ apiMutate: (...args: unknown[]) => mutate(...args) }));
vi.mock('@/lib/api-client/fetch', () => ({ apiFetch: (...args: unknown[]) => fetchApi(...args) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const WORKSPACE = 'ws-1';

/** Každá exportovaná akce se zavolá právě jednou, s minimem povinných hodnot. */
const CALLS: Record<string, (module: typeof ActionsModule) => Promise<unknown>> = {
  bulkDeleteContactsAction: (m) =>
    m.bulkDeleteContactsAction({ workspaceId: WORKSPACE, scope: { mode: 'ids', ids: ['c-1'] } }),
  exportContactsAction: (m) =>
    m.exportContactsAction({ workspaceId: WORKSPACE, scope: { mode: 'ids', ids: ['c-1'] } }),
  bulkTagContactsAction: (m) =>
    m.bulkTagContactsAction({
      workspaceId: WORKSPACE,
      scope: { mode: 'ids', ids: ['c-1'] },
      add: ['t-1'],
    }),
  deleteContactAction: (m) => m.deleteContactAction({ workspaceId: WORKSPACE, id: 'c-1' }),
  unsubscribeContactAction: (m) =>
    m.unsubscribeContactAction({ workspaceId: WORKSPACE, email: 'a@b.cz', listIds: ['l-1'] }),
  exportContactAction: (m) => m.exportContactAction({ workspaceId: WORKSPACE, id: 'c-1' }),
  vocativeReviewAction: (m) => m.vocativeReviewAction({ workspaceId: WORKSPACE, groups: [] }),
  vocativeNeutralAllAction: (m) => m.vocativeNeutralAllAction({ workspaceId: WORKSPACE }),
  addSuppressionAction: (m) =>
    m.addSuppressionAction({ workspaceId: WORKSPACE, email: 'spam@firma.cz' }),
  removeSuppressionAction: (m) =>
    m.removeSuppressionAction({ workspaceId: WORKSPACE, id: 's-1', note: 'omyl v importu' }),
  archiveFieldAction: (m) => m.archiveFieldAction({ workspaceId: WORKSPACE, id: 'f-1' }),
  loadFieldImpactAction: (m) => m.loadFieldImpactAction({ workspaceId: WORKSPACE, id: 'f-1' }),
  deleteFieldAction: (m) => m.deleteFieldAction({ workspaceId: WORKSPACE, id: 'f-1' }),
  deleteTagAction: (m) => m.deleteTagAction({ workspaceId: WORKSPACE, id: 't-1' }),
  setConfirmationModeAction: (m) =>
    m.setConfirmationModeAction({ workspaceId: WORKSPACE, id: 'l-1', mode: 'two_step' }),
  setOptInAction: (m) => m.setOptInAction({ workspaceId: WORKSPACE, id: 'l-1', optIn: 'single' }),
  confirmPendingAction: (m) => m.confirmPendingAction({ workspaceId: WORKSPACE, id: 'l-1' }),
  archiveListAction: (m) => m.archiveListAction({ workspaceId: WORKSPACE, id: 'l-1' }),
  setListPublicVisibilityAction: (m) =>
    m.setListPublicVisibilityAction({
      workspaceId: WORKSPACE,
      id: 'l-1',
      publicVisible: true,
      publicName: 'Novinky',
      publicDescription: '',
    }),
};

beforeEach(() => {
  mutate.mockClear();
  fetchApi.mockClear();
});

describe('serverové akce kontaktů posílají projekt', () => {
  it('výčet v testu pokrývá všechny exportované akce souboru', async () => {
    const module = await import('./actions');
    const exported = Object.entries(module)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();
    expect(exported).toEqual(Object.keys(CALLS).sort());
  });

  /**
   * Regrese na vadu, kvůli které hromadné štítkování NIKDY nefungovalo.
   *
   * Akce skládala tělo funkcí `scopeToBody`, tedy `{ ids }`, kdežto endpoint
   * štítků chce `filter.contact_ids` a jeho schéma je `.strict()`. Uživatel
   * proto na každé kliknutí dostal jen „Štítek se nepodařilo změnit. Technický
   * detail: validation_failed".
   *
   * Test schválně tvrdí o TĚLE POŽADAVKU, ne o návratové hodnotě: server je
   * v testu podvržený, takže vrátí úspěch i na tvar, který by v provozu odmítl.
   * Přesně proto tuhle třídu vad testy dosud míjely.
   */
  it('hromadné štítkování posílá tvar, který endpoint přijímá', async () => {
    const module = await import('./actions');
    await module.bulkTagContactsAction({
      workspaceId: WORKSPACE,
      scope: { mode: 'ids', ids: ['c-1', 'c-2'] },
      add: ['t-1'],
    });

    const [path, options] = mutate.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(path).toBe('/api/v1/contacts/tags:bulk');
    expect(options.body).toEqual({
      filter: { contact_ids: ['c-1', 'c-2'] },
      add: ['t-1'],
      remove: [],
    });
    expect(options.body, 'klíč `ids` schéma neprojde, je `.strict()`').not.toHaveProperty('ids');
  });

  it('hromadné štítkování nad „vše odpovídající filtru" se neposílá na server', async () => {
    const module = await import('./actions');
    const result = await module.bulkTagContactsAction({
      workspaceId: WORKSPACE,
      scope: { mode: 'filter', filters: {} },
      add: ['t-1'],
    });

    // Endpoint filtr NEPODPORUJE, viz komentář u `BulkTagBody`. Odeslat ho
    // znamená jistou 422, takže se to zastaví dřív a s vlastním kódem.
    expect(mutate).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'error', code: 'bulk_tag_needs_selection' });
  });

  for (const [name, call] of Object.entries(CALLS)) {
    it(`${name} předá workspaceId klientovi API`, async () => {
      const module = await import('./actions');
      await call(module);

      const calls = [...mutate.mock.calls, ...fetchApi.mock.calls];
      expect(calls, `${name} nezavolala žádný klient API`).not.toHaveLength(0);
      for (const [path, options] of calls) {
        expect(
          (options as { workspaceId?: string } | undefined)?.workspaceId,
          `${name} volá ${String(path)} bez workspaceId, takže požadavku chybí X-Workspace-Id`,
        ).toBe(WORKSPACE);
      }
    });
  }
});
