/**
 * Registr navigace, celý dopředu (uzávěr S5 řídicího dokumentu).
 *
 * Doménový plán tenhle soubor **nerozšiřuje**. Jeho úkolem je naplnit
 * cestu obsahem, ne přidat položku. Nová položka menu je rozhodnutí,
 * které dělá uživatel, takže se zavádí jen za samostatnou úlohu
 * s vlastním životním cyklem.
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
        id: 'contacts-forms',
        labelKey: 'common.nav.contactsForms',
        path: '/forms',
        permission: 'contacts:read',
        // Správa formulářů zatím neexistuje: v `apps/web/src/app` je jen veřejná
        // strana (`(public)/f/[slug]`), kam se odesílá přihlášení, žádná
        // obrazovka pro jejich zakládání. Odkaz vracel 404, ověřeno v prohlížeči.
        // Skryté je lepší než mrtvé: mrtvý odkaz slibuje funkci, kterou produkt
        // nemá. Až obrazovka vznikne, brána `registry-screens.test.ts` si
        // vynutí přepnutí zpátky.
        mvp0: false,
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
      {
        id: 'templates-brand',
        labelKey: 'common.nav.templatesBrand',
        path: '/brand',
        permission: 'templates:read',
        mvp0: true,
      },
    ],
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
      {
        id: 'settings-sending',
        labelKey: 'common.nav.settingsSending',
        path: '/settings/sending',
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
        mvp0: false,
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
