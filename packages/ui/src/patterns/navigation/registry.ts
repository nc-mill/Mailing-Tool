/**
 * Registr navigace, celý dopředu (uzávěr S5 řídicího dokumentu).
 *
 * Doménový plán tenhle soubor **nerozšiřuje**. Jeho úkolem je naplnit
 * cestu obsahem, ne přidat položku. Nová položka menu je rozhodnutí,
 * které dělá uživatel, takže se zavádí jen za samostatnou úlohu
 * s vlastním životním cyklem.
 *
 * ROZHODNUTÍ ZADAVATELE ze 4. 8. 2026, dvě přesunutí. Doslova:
 * „Značka projektu patří do Nastavení. Ne pod šablony." a „Knihovna médií
 * patří na hlavní úroveň side menu, ne pod šablony." Je to přesně ten druh
 * rozhodnutí, které si pravidlo výš vyhrazuje pro uživatele, takže se provádí,
 * a zapisuje se sem, aby bylo za rok dohledatelné, proč sekce Šablony zhubla
 * na jedinou položku:
 *
 *   - `templates-brand` → `settings-brand`, cesta `/brand` → `/settings/brand`
 *     (obě stránky existovaly už dřív a renderovaly totéž tělo, e2e i P15
 *     mířily na tu pod Nastavením; `/brand` teď jen přesměrovává).
 *   - `templates-media` → `media` na hlavní úrovni, cesta `/assets` beze změny.
 *
 * Hloubka nejvýš tři úrovně. Co je hlouběji, se otevírá jako panel
 * nebo dialog nad kontextem, ne jako další stránka.
 */
export type NavigationItem = {
  id: string;
  /** Plná cesta klíče v katalogu. Klíče se nikdy neskládají za běhu. */
  labelKey: string;
  /** Cesta bez slugu projektu, doplní ho `visibleNavigation`. */
  path: string;
  /** Oprávnění, bez kterého se položka vůbec nezobrazí. */
  permission?: string;
  /**
   * Je obrazovka hotová v MVP 0?
   *
   * Registr je celý dopředu (uzávěr S5), ale polovinu obrazovek Nastavení
   * v MVP 0 nikdo nedodá. Bez tohohle příznaku by menu nabízelo šest cest,
   * které skončí na prázdné stránce. Pozdější plán, který svou obrazovku
   * dodá, **přehodí tenhle jeden boolean** jako deklarovanou úzkou výjimku
   * ve svém plánu. Registr se tím nerozšiřuje, takže S5 platí dál.
   */
  mvp0: boolean;
  children?: NavigationItem[];
  /** Rezervované místo, které se v MVP 0 nezobrazuje. */
  reservedFor?: 'MVP2';
};

export const NAVIGATION: NavigationItem[] = [
  {
    id: 'overview',
    labelKey: 'common.nav.overview',
    path: '',
    mvp0: true,
  },
  {
    id: 'contacts',
    labelKey: 'common.nav.contacts',
    path: '/contacts',
    mvp0: true,
    permission: 'contacts:read',
    children: [
      {
        id: 'contacts-all',
        labelKey: 'common.nav.contactsAll',
        path: '/contacts',
        permission: 'contacts:read',
        mvp0: true,
      },
      {
        id: 'contacts-lists',
        labelKey: 'common.nav.contactsLists',
        path: '/lists',
        permission: 'contacts:read',
        mvp0: true,
      },
      {
        id: 'contacts-segments',
        labelKey: 'common.nav.contactsSegments',
        path: '/segments',
        permission: 'contacts:read',
        mvp0: true,
      },
      {
        id: 'contacts-tags',
        labelKey: 'common.nav.contactsTags',
        path: '/tags',
        permission: 'contacts:read',
        mvp0: true,
      },
      {
        id: 'contacts-import',
        labelKey: 'common.nav.contactsImport',
        path: '/contacts/import',
        permission: 'contacts:write',
        mvp0: true,
      },
      {
        id: 'contacts-suppressions',
        labelKey: 'common.nav.contactsSuppressions',
        path: '/suppressions',
        permission: 'contacts:read',
        mvp0: true,
      },
      {
        id: 'contacts-greeting-queue',
        labelKey: 'common.nav.contactsGreetingQueue',
        // Obrazovka leží na `/contacts/vocative-review`, ne na `/greeting-queue`.
        // Odkaz „Kontrola oslovení" v hlavní navigaci vracel 404, ověřeno
        // v prohlížeči. Na tutéž cestu míří i odkaz z výsledku importu
        // (`features/import/import-result.tsx`), takže zdroj pravdy je ona.
        path: '/contacts/vocative-review',
        permission: 'contacts:write',
        mvp0: true,
      },
    ],
  },
  {
    // Formuláře na HLAVNÍ ÚROVNI. Rozhodnutí zadavatele ze 4. 8. 2026, stejný
    // druh jako přesun Knihovny médií výš: „Formuláře chci jako vlastní položku
    // na hlavní úrovni, ne jako podpoložku Kontaktů."
    //
    // Sedí to i věcně. Podpoložka Kontaktů slibovala pohled na data, která už
    // mám. Formulář je naopak KANÁL, kterým kontakty teprve přicházejí, a stojí
    // vedle kampaní: kampaň je odchozí směr, formulář příchozí. Uživatel ho
    // nehledá v seznamu kontaktů, hledá ho tehdy, když chce sbírat adresy z webu.
    //
    // Původně tu byla podpoložka `contacts-forms` se `mvp0: false` a komentářem,
    // že správa formulářů neexistuje a odkaz vrací 404. Existuje: `/forms`,
    // `/forms/{id}` a `/forms/{id}/embed`. Položka se tedy přesouvá a odkrývá,
    // což si vynucuje i brána `registry-screens.test.ts`.
    //
    // Bez podpoložek, jako Knihovna médií: druhá úroveň by nabídla detail
    // konkrétního formuláře, což do menu nepatří.
    id: 'forms',
    labelKey: 'common.nav.forms',
    path: '/forms',
    permission: 'contacts:read',
    mvp0: true,
  },
  {
    id: 'campaigns',
    labelKey: 'common.nav.campaigns',
    path: '/campaigns',
    mvp0: true,
    permission: 'campaigns:read',
    children: [
      {
        id: 'campaigns-all',
        labelKey: 'common.nav.campaignsAll',
        path: '/campaigns',
        permission: 'campaigns:read',
        mvp0: true,
      },
      {
        id: 'campaigns-scheduled',
        labelKey: 'common.nav.campaignsScheduled',
        path: '/campaigns/scheduled',
        permission: 'campaigns:read',
        // Samostatný seznam naplánovaných kampaní neexistuje, odkaz vracel 404.
        // Naplánované kampaně jsou zatím vidět v hlavním seznamu podle stavu.
        mvp0: false,
      },
    ],
  },
  {
    id: 'templates',
    labelKey: 'common.nav.templates',
    path: '/templates',
    mvp0: true,
    permission: 'templates:read',
    children: [
      {
        id: 'templates-library',
        labelKey: 'common.nav.templatesLibrary',
        path: '/templates',
        permission: 'templates:read',
        mvp0: true,
      },
    ],
  },
  {
    // Knihovna médií na HLAVNÍ ÚROVNI. Registr pro ni místo neměl, takže je to
    // nová položka, ne přehození `mvp0`, a o jejím umístění rozhodl zadavatel
    // (viz hlavička souboru): „Knihovna médií patří na hlavní úroveň side menu,
    // ne pod šablony."
    //
    // Sedí to i věcně. Obrázek není součást šablony, je to samostatný obsah
    // projektu: tentýž soubor používá šablona, kampaň i logo značky, a odkud
    // se na něj sahá, se pozná až v knihovně (sloupec „Používá"). Položka
    // schovaná pod Šablonami slibovala opak.
    //
    // Oprávnění je `assets:read`, ne `templates:read`. Doména assetů má
    // vlastní dvojici oprávnění (`packages/core/src/identity/permissions.ts`)
    // a mazání obrázků je jiná pravomoc než čtení šablon: kdo smí číst
    // šablonu, nemá tím ještě smět zahodit obrázek z odeslané kampaně.
    //
    // Bez podpoložek. Knihovna je jedna obrazovka a druhá úroveň by nabídla
    // prázdno; `visibleNavigation` se sekcí bez dětí umí pracovat.
    id: 'media',
    labelKey: 'common.nav.media',
    path: '/assets',
    permission: 'assets:read',
    mvp0: true,
  },
  {
    id: 'statistics',
    labelKey: 'common.nav.statistics',
    // Celá sekce mířila pod `/statistics/**`, kde v aplikaci není ani jedna
    // stránka; „Statistiky" v hlavní navigaci proto vracely 404. Dvě z těch
    // obrazovek přitom existují, jen leží jinde, ověřeno v prohlížeči:
    //   /deliverability   → „Doručitelnost"
    //   /stats/campaigns  → „Vývoj v čase"
    // Sekce se tedy neschovává, jen se srovnávají cesty na skutečnost.
    // Rodičovská položka vede na první podpoložku, jako u ostatních sekcí.
    path: '/deliverability',
    mvp0: true,
    permission: 'reports:read',
    children: [
      {
        id: 'statistics-deliverability',
        labelKey: 'common.nav.statisticsDeliverability',
        path: '/deliverability',
        permission: 'reports:read',
        mvp0: true,
      },
      {
        id: 'statistics-over-time',
        labelKey: 'common.nav.statisticsOverTime',
        path: '/stats/campaigns',
        permission: 'reports:read',
        mvp0: true,
      },
      {
        // Provoz na webu, ne jeden člověk. Proto vlastní položka a ne naplnění
        // skryté `statistics-contacts`: ta se jmenuje „Kontakty" a přepsat jí
        // cestu by v navigaci nechalo jméno, které neodpovídá obsahu.
        id: 'statistics-web',
        labelKey: 'common.nav.statisticsWeb',
        path: '/stats/web',
        permission: 'reports:read',
        mvp0: true,
      },
      {
        id: 'statistics-contacts',
        labelKey: 'common.nav.statisticsContacts',
        path: '/statistics/contacts',
        permission: 'reports:read',
        // Jediná ze tří, která nikde neexistuje. Skrytá, ne mrtvá.
        mvp0: false,
      },
    ],
  },
  {
    id: 'settings',
    labelKey: 'common.nav.settings',
    path: '/settings/general',
    mvp0: true,
    children: [
      {
        id: 'settings-general',
        labelKey: 'common.nav.settingsGeneral',
        path: '/settings/general',
        permission: 'workspace:update',
        mvp0: true,
      },
      // Značka projektu. Sem ji přesunul zadavatel (viz hlavička souboru),
      // z „Šablony → Značka projektu" na „Nastavení → Značka projektu".
      // Barvy, logo a písmo nejsou jedna ze šablon, jsou to VÝCHOZÍ HODNOTY,
      // ze kterých šablony vznikají, a to je nastavení projektu.
      //
      // Cesta je `/settings/brand`, ne původní `/brand`. Obě stránky existovaly
      // vedle sebe už předtím a renderovaly totéž tělo; ta pod Nastavením
      // sedí do sekce (má levé menu Nastavení kolem sebe) a míří na ni i e2e
      // `apps/web/e2e/ai/brand-extraction.spec.ts`. `/brand` zůstává jako
      // přesměrování, aby staré odkazy nekončily na 404.
      //
      // Oprávnění je `templates:write`, ne `templates:read`: obrazovka značku
      // UPRAVUJE a `BrandScreen` se sama uzavírá pod `templates:write`. Kdo ho
      // nemá, viděl by v menu položku a za ní hlášku „Na tuhle část nemáte
      // oprávnění", což je mrtvý odkaz s mezikrokem.
      {
        id: 'settings-brand',
        labelKey: 'common.nav.settingsBrand',
        path: '/settings/brand',
        permission: 'templates:write',
        mvp0: true,
      },
      {
        id: 'settings-sending',
        labelKey: 'common.nav.settingsSending',
        path: '/settings/sending',
        permission: 'providers:read',
        mvp0: true,
      },
      // Předvolby odesílatele. Stojí VEDLE odesílání, ne uvnitř: obrazovka
      // odesílání je o účtech, doménách a DNS, tedy o nastavení, které se dělá
      // jednou. Předvolby jsou naopak věc, do které se uživatel vrací, kdykoli
      // mu přibude adresa. Oprávnění je `providers:read`, protože se předvolba
      // odkazuje na účet a doménu, a musí být EXISTUJÍCÍ jméno oprávnění:
      // vymyšlené by položku skrylo úplně všem a nic by přitom neselhalo.
      {
        id: 'settings-senders',
        labelKey: 'common.nav.settingsSenders',
        path: '/settings/senders',
        permission: 'providers:read',
        mvp0: true,
      },
      // Stav systémové pošty. Vlastní položka, ne odstavec v Odesílání, protože
      // je to jiná věc než rozesílka kampaní a uživatel ji hledá tehdy, když
      // něco nedorazilo: pozvánka, obnova hesla, ověření adresy.
      {
        id: 'settings-system-mail',
        labelKey: 'common.nav.settingsSystemMail',
        path: '/settings/system-mail',
        permission: 'providers:read',
        mvp0: true,
      },
      {
        id: 'settings-fields',
        labelKey: 'common.nav.settingsFields',
        path: '/settings/fields',
        permission: 'contacts:write',
        mvp0: false,
      },
      {
        id: 'settings-members',
        labelKey: 'common.nav.settingsMembers',
        path: '/settings/members',
        permission: 'members:invite',
        mvp0: true,
      },
      {
        id: 'settings-api-keys',
        labelKey: 'common.nav.settingsApiKeys',
        path: '/settings/api-keys',
        permission: 'api_keys:read',
        mvp0: true,
      },
      {
        id: 'settings-webhooks',
        labelKey: 'common.nav.settingsWebhooks',
        path: '/settings/webhooks',
        permission: 'webhooks:read',
        mvp0: true,
      },
      {
        id: 'settings-consent',
        // `gdpr:export`, ne neexistující `gdpr:read`. Skutečná oprávnění domény
        // jsou `gdpr:erase` a `gdpr:export`; kdo smí vyexportovat data subjektu,
        // smí vidět i jeho souhlasy. Neexistující jméno by znamenalo, že
        // kontrola nikdy neprojde a položku neuvidí NIKDO, aniž by co selhalo.
        labelKey: 'common.nav.settingsConsent',
        path: '/settings/consent',
        permission: 'gdpr:export',
        mvp0: false,
      },
      {
        id: 'settings-tracking',
        // `workspace:update`, ne neexistující `tracking:read`. Nastavení měření
        // mění chování celého projektu, takže patří k tomu, kdo projekt
        // spravuje. Doména `tracking` vlastní oprávnění nemá.
        labelKey: 'common.nav.settingsTracking',
        path: '/settings/tracking',
        permission: 'workspace:update',
        // Odkryto ve chvíli, kdy obrazovka `settings/tracking` doopravdy vznikla.
        // Do té doby byla položka schválně skrytá: odkaz na neexistující obrazovku
        // slibuje funkci, kterou produkt nemá, a vrací 404. Hlídá to
        // `registry-screens.test.ts`, který spadne v obou směrech, tedy i kdyby
        // se obrazovka zase ztratila.
        mvp0: true,
      },
      {
        id: 'settings-ai',
        labelKey: 'common.nav.settingsAi',
        path: '/settings/ai',
        permission: 'ai:configure',
        mvp0: true,
      },
      {
        id: 'settings-audit',
        labelKey: 'common.nav.settingsAudit',
        path: '/settings/audit',
        permission: 'audit:read',
        mvp0: true,
      },
      {
        id: 'settings-backups',
        labelKey: 'common.nav.settingsBackups',
        path: '/settings/backups',
        permission: 'backups:read',
        mvp0: true,
      },
      // Můj účet vidí každý, je to jeho vlastní profil.
      {
        id: 'settings-account',
        labelKey: 'common.nav.settingsAccount',
        path: '/settings/account',
        mvp0: true,
      },
    ],
  },
  {
    // Sedmé místo. Existuje v registru, aby si ho nikdo nezabral,
    // ale v MVP 0 se nezobrazuje.
    id: 'automations',
    labelKey: 'common.nav.automations',
    path: '/automations',
    mvp0: false,
    reservedFor: 'MVP2',
  },
];
