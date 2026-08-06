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

/**
 * Prohlížející, opsaný z `ROLE_PERMISSIONS.viewer` v
 * `packages/core/src/identity/permissions.ts`. Opsaný, ne importovaný:
 * `@mlain/ui` na `@mlain/core` nezávisí a kvůli jednomu testu se ta vrstva
 * obracet nebude. Celý seznam, ne jen dvě oprávnění, aby tvrzení „prohlížející
 * nedosáhne na žádnou podpoložku Nastavení" bylo doopravdy o prohlížejícím.
 */
const viewer = [
  'workspace:read',
  'domains:read',
  'contacts:read',
  'lists:read',
  'segments:read',
  'suppressions:read',
  'templates:read',
  'assets:read',
  'campaigns:read',
  'forms:read',
  'reports:read',
  'timeline:read',
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

  /**
   * ZMĚNA ZE 6. 8. 2026, ať to nevypadá jako omylem zmizelá sekce.
   *
   * Do té doby měla sekce Nastavení podpoložku „Můj účet" bez oprávnění, takže
   * prohlížejícímu zbyla aspoň ona. Zadavatel účet z Nastavení odebral, protože
   * profil je osobní, ne projektový, a vede k němu nabídka v pravém horním rohu.
   * Prohlížející tím Nastavení ztratil celé, a je to ZÁMĚR: na žádnou zbylou
   * podpoložku nemá oprávnění a sekce sama míří na `/settings/general`, kam
   * potřebuje `workspace:update`. Ukazovat mu rozbalovací sekci, pod kterou nic
   * není a která po kliknutí odmítne, je horší než ji nenabízet.
   *
   * Test drží obojí naráz: že Nastavení zmizelo A že prohlížející ostatní sekce
   * pořád vidí. Bez druhé půlky by prošel i tehdy, kdyby se rozbilo filtrování
   * a zmizelo mu z menu všechno.
   */
  it('prohlížející nevidí Nastavení vůbec, protože nemá ani jednu podpoložku', () => {
    const ids = visibleNavigation({ permissions: viewer }).map((section) => section.id);
    expect(ids).not.toContain('settings');
    expect(ids).toContain('contacts');
    expect(ids).toContain('campaigns');
  });

  /**
   * ZMĚNA ZE 6. 8. 2026, druhá téhož dne: Nastavení se v bočním menu nerozbaluje.
   *
   * Zadavatel: „Sidebar má nastavení submenu, ale to se pak objevuje samostatně
   * na každé stránce v nastavení. Není potřeba to duplikovat."
   *
   * Test drží obojí půlky naráz, protože právě jejich rozpojení je ta chyba,
   * která se nabízí sama: podpoložky v DATECH zůstávají, jen si je boční menu
   * nevykreslí. Kdo je smaže z registru, dostane sekci bez dětí, ta se řídí
   * vlastním oprávněním, Nastavení nemá žádné, a uviděli by ho úplně všichni.
   * Přesně to hlídá druhá polovina, tedy prohlížející.
   */
  it('Nastavení nese příznak sidebarSubmenu, ale podpoložky si v datech nechává', () => {
    const settings = visibleNavigation({ permissions: owner }).find(
      (section) => section.id === 'settings',
    );
    expect(settings?.sidebarSubmenu).toBe(false);
    // Bez nich by zmizela navigace uvnitř Nastavení, která je čte.
    expect((settings?.children ?? []).length).toBeGreaterThan(1);
    // `settings-brand`, ne `settings-general`: seznam `owner` výš nemá
    // `workspace:update`, takže „Projekt" mu registr odfiltruje.
    expect(settings?.children?.map((child) => child.id)).toContain('settings-brand');

    // A prohlížející Nastavení dál nevidí vůbec, protože se počítá z dětí.
    expect(visibleNavigation({ permissions: viewer }).map((section) => section.id)).not.toContain(
      'settings',
    );
  });

  it('sidebarSubmenu nese jen Nastavení, ostatní sekce se rozbalují dál', () => {
    // Brána proti tichému rozšíření příznaku na sekce, kde druhá úroveň
    // nikde jinde není. Kontakty ji mají jen v bočním menu.
    const ids = NAVIGATION.filter((section) => section.sidebarSubmenu === false).map(
      (section) => section.id,
    );
    expect(ids).toEqual(['settings']);
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

describe('podmenu o jedné položce', () => {
  it('Kampaně ani Šablony podmenu nemají, jejich jediná podpoložka vede na tutéž cestu', () => {
    const visible = visibleNavigation({ permissions: owner });
    for (const id of ['campaigns', 'templates']) {
      const section = visible.find((item) => item.id === id);
      expect(section, id).toBeDefined();
      expect(section?.children, id).toBeUndefined();
    }
  });

  it('Kontaktům podmenu zůstává, mají víc podpoložek', () => {
    const visible = visibleNavigation({ permissions: owner });
    const contacts = visible.find((item) => item.id === 'contacts');
    expect((contacts?.children ?? []).length).toBeGreaterThan(1);
  });

  /**
   * TENHLE PŘÍPAD V APLIKACI PRÁVĚ TEĎ NENASTÁVÁ. Nemazat.
   *
   * Vstup je sestavený schválně: žádná role nemá `audit:read` samotné. Kdo na
   * audit log dosáhne, je správce nebo vlastník a spolu s ním má i klíče k API,
   * webhooky a další podpoložky Nastavení, takže mu podmenu vyjde o víc než
   * jedné položce a pravidlo se ho netýká.
   *
   * Živý doklad tu do 6. 8. 2026 byl: Nastavení mělo podpoložku „Můj účet" bez
   * oprávnění, takže prohlížejícímu zbyla jediná, a mířila jinam než sekce.
   * Ta položka se přesunula do nabídky vpravo nahoře a doklad zmizel s ní.
   *
   * Pravidlo tím ale platit nepřestalo a ZŮSTÁVÁ ÚZKÉ, tedy „jedna A na téže
   * cestě", ne „jedna". Jediná podpoložka, která míří JINAM než sekce, je pro
   * uživatele jediná cesta na tu obrazovku: sekce vede jinam a bez podmenu by
   * se na ni nedostal nijak. První registr nebo první sada oprávnění, které
   * takovou sekci zase vyrobí, na tomhle rozdílu stojí. Proto se testuje na
   * sestaveném vstupu, ne na roli.
   */
  it('jediná podpoložka mířící JINAM než sekce zůstane, jinak by byla nedosažitelná', () => {
    const visible = visibleNavigation({ permissions: ['audit:read'] });
    const settings = visible.find((item) => item.id === 'settings');

    // Sekce míří na `/settings/general`, podpoložka na `/settings/audit`.
    expect(settings?.href).toBe('/w/{slug}/settings/general');
    expect(settings?.children?.map((child) => child.id)).toEqual(['settings-audit']);
    expect(settings?.children?.[0]?.href).toBe('/w/{slug}/settings/audit');
  });
});
