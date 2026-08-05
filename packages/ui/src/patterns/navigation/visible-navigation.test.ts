import { describe, expect, it } from 'vitest';
import { NAVIGATION, type NavigationItem } from './registry';
import { visibleNavigation } from './visible-navigation';

const owner = [
  'contacts:read',
  'campaigns:read',
  'templates:read',
  // `templates:write` a `assets:read` tu jsou od přesunu ze 4. 8. 2026: bez nich
  // by vlastník neviděl ani Knihovnu médií (hlavní úroveň), ani Značku projektu
  // (Nastavení) a testy níž by procházely, aniž by o obou položkách cokoli
  // tvrdily. Seznam má popisovat vlastníka, ne jen ta oprávnění, která se zrovna
  // hodí.
  'templates:write',
  'assets:read',
  'reports:read',
  'providers:read',
  'api_keys:read',
  'webhooks:read',
  'audit:read',
  'backups:read',
  'members:read',
];

describe('registr navigace', () => {
  it('obsahuje osm viditelných míst a jedno rezervované', () => {
    // Osm, ne šest: Knihovna médií se 4. 8. 2026 přesunula z podpoložky Šablon
    // na hlavní úroveň a Formuláře tamtéž z podpoložky Kontaktů (obojí
    // rozhodnutí zadavatele, zapsané v registru).
    expect(NAVIGATION).toHaveLength(9);
    expect(NAVIGATION.filter((section) => section.reservedFor === undefined)).toHaveLength(8);
  });

  it('Formuláře jsou na hlavní úrovni, ne pod Kontakty', () => {
    // Brána proti tichému vrácení přesunu. Zadavatel ho vyžádal doslova:
    // formuláře jako vlastní položka na hlavní úrovni.
    const contacts = NAVIGATION.find((section) => section.id === 'contacts');
    expect(contacts?.children?.map((child) => child.id)).not.toContain('contacts-forms');

    const forms = NAVIGATION.find((section) => section.id === 'forms');
    expect(forms?.path).toBe('/forms');
    expect(forms?.permission).toBe('contacts:read');
    expect(forms?.mvp0).toBe(true);
  });

  it('Značka projektu je v Nastavení a Knihovna médií na hlavní úrovni', () => {
    // Brána proti tichému vrácení přesunu. Zadavatel obojí vyžádal doslova:
    // „Značka projektu patří do Nastavení. Ne pod šablony." a „Knihovna médií
    // patří na hlavní úroveň side menu, ne pod šablony."
    const templates = NAVIGATION.find((section) => section.id === 'templates');
    expect(templates?.children?.map((child) => child.id)).toEqual(['templates-library']);

    const media = NAVIGATION.find((section) => section.id === 'media');
    expect(media?.path).toBe('/assets');
    expect(media?.permission).toBe('assets:read');

    const settings = NAVIGATION.find((section) => section.id === 'settings');
    const brand = settings?.children?.find((child) => child.id === 'settings-brand');
    expect(brand?.path).toBe('/settings/brand');
    expect(brand?.permission).toBe('templates:write');
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

  it('vlastník vidí všech osm sekcí', () => {
    expect(visibleNavigation({ permissions: owner })).toHaveLength(8);
    const ids = visibleNavigation({ permissions: owner }).map((section) => section.id);
    expect(ids).toContain('media');
    expect(ids).toContain('forms');
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

  /**
   * Vypnuté oslovení skrývá obrazovku `/contacts/vocative-review`. Kdyby zůstala
   * položka v menu, byl by to odkaz na obrazovku, která vrací 404, tedy mrtvé
   * tlačítko. Podmínka je vlastnost PROJEKTU, takže se rozhoduje tady, ne
   * příznakem v registru.
   */
  it('hiddenIds vyřadí položku, aniž by se sáhlo do registru', () => {
    // Kontrola oslovení chce `contacts:write`, seznam `owner` výš má jen čtení.
    const writer = [...owner, 'contacts:write'];

    const visible = visibleNavigation({ permissions: writer });
    const contacts = visible.find((section) => section.id === 'contacts');
    expect(contacts?.children?.map((child) => child.id)).toContain('contacts-greeting-queue');

    const hidden = visibleNavigation({
      permissions: writer,
      hiddenIds: ['contacts-greeting-queue'],
    });
    const contactsHidden = hidden.find((section) => section.id === 'contacts');
    expect(contactsHidden?.children?.map((child) => child.id)).not.toContain(
      'contacts-greeting-queue',
    );
    // Sekce nezmizí, ostatní podpoložky zůstávají.
    expect(contactsHidden?.children?.map((child) => child.id)).toContain('contacts-all');
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
