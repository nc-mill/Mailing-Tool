import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useColumnPreferences } from './use-column-preferences';

const columns = ['email', 'name', 'status', 'lists', 'tags', 'createdAt', 'lastActive'];

describe('useColumnPreferences', () => {
  beforeEach(() => window.localStorage.clear());

  it('výchozí sada je šest sloupců', () => {
    const { result } = renderHook(() =>
      useColumnPreferences({ tableId: 'contacts', allColumns: columns, defaultVisible: 6 }),
    );
    expect(result.current.visible).toHaveLength(6);
  });

  it('uloží viditelnost a přečte ji po novém připojení', () => {
    const first = renderHook(() =>
      useColumnPreferences({ tableId: 'contacts', allColumns: columns, defaultVisible: 6 }),
    );
    act(() => first.result.current.toggleColumn('tags'));
    first.unmount();

    const second = renderHook(() =>
      useColumnPreferences({ tableId: 'contacts', allColumns: columns, defaultVisible: 6 }),
    );
    expect(second.result.current.visible).not.toContain('tags');
  });

  it('zobrazení všech sloupců přežije nové připojení', () => {
    const first = renderHook(() =>
      useColumnPreferences({ tableId: 'contacts', allColumns: columns, defaultVisible: 6 }),
    );
    act(() => first.result.current.toggleColumn('lastActive'));
    first.unmount();

    const second = renderHook(() =>
      useColumnPreferences({ tableId: 'contacts', allColumns: columns, defaultVisible: 6 }),
    );
    expect(second.result.current.visible).toEqual(columns);
  });

  it('nastavení je vázané na tabulku, ne globálně', () => {
    const contacts = renderHook(() =>
      useColumnPreferences({ tableId: 'contacts', allColumns: columns, defaultVisible: 6 }),
    );
    act(() => contacts.result.current.toggleColumn('email'));
    contacts.unmount();

    const campaigns = renderHook(() =>
      useColumnPreferences({ tableId: 'campaigns', allColumns: columns, defaultVisible: 6 }),
    );
    expect(campaigns.result.current.visible).toContain('email');
  });

  it('starší zápis se šířkami se přečte a šířky z úložiště zmizí', () => {
    window.localStorage.setItem(
      'mlain.table.contacts',
      JSON.stringify({ version: 1, hidden: ['tags'], widths: { email: 320 } }),
    );

    const { result, unmount } = renderHook(() =>
      useColumnPreferences({ tableId: 'contacts', allColumns: columns, defaultVisible: 6 }),
    );
    expect(result.current.visible).not.toContain('tags');
    unmount();

    const stored = JSON.parse(window.localStorage.getItem('mlain.table.contacts') ?? '{}');
    expect(stored).toEqual({ version: 1, hidden: ['tags'] });
  });

  it('poškozený zápis v úložišti nezabije tabulku', () => {
    window.localStorage.setItem('mlain.table.contacts', '{ tohle není JSON');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useColumnPreferences({ tableId: 'contacts', allColumns: columns, defaultVisible: 6 }),
    );
    expect(result.current.visible).toHaveLength(6);
    spy.mockRestore();
  });
});
