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

  it('uloží šířku sloupce', () => {
    const { result } = renderHook(() =>
      useColumnPreferences({ tableId: 'contacts', allColumns: columns, defaultVisible: 6 }),
    );
    act(() => result.current.setWidth('email', 320));
    expect(result.current.widths.email).toBe(320);
  });

  it('nastavení je vázané na tabulku, ne globálně', () => {
    const contacts = renderHook(() =>
      useColumnPreferences({ tableId: 'contacts', allColumns: columns, defaultVisible: 6 }),
    );
    act(() => contacts.result.current.setWidth('email', 320));

    const campaigns = renderHook(() =>
      useColumnPreferences({ tableId: 'campaigns', allColumns: columns, defaultVisible: 6 }),
    );
    expect(campaigns.result.current.widths.email).toBeUndefined();
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
