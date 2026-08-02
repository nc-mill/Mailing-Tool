import { describe, expect, it } from 'vitest';
import { NAVIGATION, type NavigationItem } from './registry';
import { visibleNavigation } from './visible-navigation';

const owner = [
  'contacts:read',
  'campaigns:read',
  'templates:read',
  'reports:read',
  'providers:read',
  'api_keys:read',
  'webhooks:read',
  'audit:read',
  'backups:read',
  'members:read',
];

describe('registr navigace', () => {
  it('obsahuje šest viditelných míst a jedno rezervované', () => {
    expect(NAVIGATION).toHaveLength(7);
    expect(NAVIGATION.filter((section) => section.reservedFor === undefined)).toHaveLength(6);
  });

  it('sedmá položka je rezervovaná pro Automatizace a v MVP 0 se nezobrazuje', () => {
    const automations = NAVIGATION.find((section) => section.id === 'automations');
    expect(automations?.reservedFor).toBe('MVP2');
    expect(visibleNavigation({ permissions: owner }).map((section) => section.id)).not.toContain(
      'automations',
    );
  });

  it('hloubka stromu nikde nepřekročí tři úrovně', () => {
    for (const section of NAVIGATION) {
      for (const child of section.children ?? []) {
        expect(child.children ?? []).toHaveLength(0);
      }
    }
  });

  it('vlastník vidí všech šest sekcí', () => {
    expect(visibleNavigation({ permissions: owner })).toHaveLength(6);
  });

  it('prohlížející nevidí Nastavení kromě profilu', () => {
    const visible = visibleNavigation({ permissions: ['contacts:read', 'campaigns:read'] });
    const settings = visible.find((section) => section.id === 'settings');
    expect(settings?.children?.map((child) => child.id)).toEqual(['settings-account']);
  });

  it('editor nevidí Zálohy, Audit log, Klíče k API ani Webhooky', () => {
    const visible = visibleNavigation({
      permissions: [
        'contacts:read',
        'campaigns:read',
        'templates:read',
        'reports:read',
        'members:read',
      ],
    });
    const settings = visible.find((section) => section.id === 'settings');
    const ids = settings?.children?.map((child) => child.id) ?? [];
    expect(ids).not.toContain('settings-backups');
    expect(ids).not.toContain('settings-audit');
    expect(ids).not.toContain('settings-api-keys');
    expect(ids).not.toContain('settings-webhooks');
  });

  it('sekce bez jediné viditelné podpoložky zmizí celá', () => {
    const visible = visibleNavigation({ permissions: [] });
    expect(visible.map((section) => section.id)).not.toContain('statistics');
  });

  it('cesta se skládá ze slugu projektu', () => {
    const visible = visibleNavigation({ permissions: owner, workspaceSlug: 'eshop-kolo' });
    const contacts = visible.find((section) => section.id === 'contacts');
    expect(contacts?.href).toBe('/w/eshop-kolo/contacts');
    expect(contacts?.children?.[0]?.href).toBe('/w/eshop-kolo/contacts');
  });

  it('obrazovky Nastavení, které nikdo nedodal, se nezobrazí', () => {
    // Bez příznaku by menu nabídlo cesty končící na prázdné stránce.
    //
    // Seznam se ZKRACUJE, jak obrazovky přibývají. `settings-ai`,
    // `settings-sending` a `settings-backups` z něj už zmizely, protože jejich
    // obrazovky existují a byly jen skryté; `settings-sending` kvůli tomu
    // nešlo připojit odesílání jinak než přímou adresou.
    //
    // Že příznak odpovídá skutečnosti, hlídá `registry-screens.test.ts`:
    // skrytá položka nesmí mít hotovou obrazovku.
    const visible = visibleNavigation({ permissions: owner });
    const settings = visible.find((section) => section.id === 'settings');
    const ids = settings?.children?.map((child) => child.id) ?? [];
    for (const hidden of ['settings-fields', 'settings-consent', 'settings-tracking']) {
      expect(ids, `${hidden} se v MVP 0 nemá zobrazit`).not.toContain(hidden);
    }
  });

  it('P15 přehodil mvp0 u settings-ai, položka se tedy v MVP 0 zobrazuje', () => {
    const visible = visibleNavigation({ permissions: [...owner, 'ai:configure'] });
    const settings = visible.find((section) => section.id === 'settings');
    expect(settings?.children?.map((child) => child.id)).toContain('settings-ai');
  });

  it('po přehození příznaku se položka objeví, aniž se registr rozšiřuje', () => {
    const visible = visibleNavigation({ permissions: owner, includeNonMvp0: true });
    const settings = visible.find((section) => section.id === 'settings');
    expect(settings?.children?.map((child) => child.id)).toContain('settings-sending');
  });

  it('každá položka má příznak mvp0 vyplněný, žádná se nezapomněla', () => {
    const walk = (items: readonly NavigationItem[]) => {
      for (const item of items) {
        expect(typeof item.mvp0, `${item.id} nemá mvp0`).toBe('boolean');
        if (item.children) walk(item.children);
      }
    };
    walk(NAVIGATION);
  });

  it('žádná položka nemá prázdný překladový klíč', () => {
    const walk = (items: typeof NAVIGATION) => {
      for (const item of items) {
        expect(item.labelKey).toMatch(/^common\.nav\./);
        if (item.children) walk(item.children as typeof NAVIGATION);
      }
    };
    walk(NAVIGATION);
  });
});
