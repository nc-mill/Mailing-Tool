'use client';

import { Link, usePathname, useRouter } from '@mlain/i18n/navigation';
import { Menu } from '@mlain/ui/icons';
import { cn } from '@mlain/ui/lib/cn';
import { visibleNavigation } from '@mlain/ui/patterns/navigation';
import { AppShell, NavDrawer, Sidebar, Topbar, WorkspaceSwitcher } from '@mlain/ui/patterns/shell';
import type { SystemBarState, WorkspaceSummary } from '@mlain/ui/patterns/shell';
import { TooltipProvider } from '@mlain/ui/components/tooltip';
import { ToastProvider } from '@mlain/ui/patterns/toast';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import type { ActionState } from '@/lib/feedback/action-result';
import { JobsBadgeLive } from '@/features/jobs/jobs-badge-live';
import { CreateWorkspaceDialog } from './create-workspace-dialog';
import { UserMenu } from './user-menu';

/** Klíč, pod kterým si prohlížeč pamatuje zabalené boční menu. */
const SIDEBAR_STORAGE_KEY = 'mlain.sidebar';

/**
 * Šířka okna, pod kterou je rozbalené boční menu neúnosné.
 *
 * Rozbalené menu si bere 236 px. Na tabletu na výšku (768 px) by hlavnímu
 * sloupci zbylo 532 px, tedy o čtvrtinu displeje míň než se zabaleným menu,
 * které má 76 px.
 *
 * Hranice je 1024 px, ne 640: menu se nezmenšuje kvůli displeji telefonu,
 * ale kvůli poměru, a na tabletu na výšku je stejně nepříznivý.
 *
 * POD 768 px UŽ TAHLE ÚVAHA NEPLATÍ, protože tam se menu z rozvržení
 * neodstraňuje zúžením, ale úplně (`hidden md:block` níž) a otevírá se
 * vysouvacím panelem. Media query se tam nedostane ke slovu.
 */
const SIDEBAR_AUTO_COLLAPSE = '(max-width: 1023px)';

/**
 * Šířka, od které je boční menu v rozvržení, a vysouvací panel tedy nemá
 * co ukazovat. Musí sedět s `hidden md:block` níž: `md` je v Tailwindu 768 px.
 */
const NAV_DRAWER_LIMIT = '(min-width: 768px)';

export type WorkspaceShellProps = {
  /** Všechny projekty přihlášeného, ne jen ten otevřený. */
  workspaces: WorkspaceSummary[];
  currentWorkspaceId: string;
  /** Skutečná oprávnění role aktéra, spočítaná na serveru. Klient matici nezná. */
  permissions: readonly string[];
  user: { name: string; email: string };
  /**
   * Řeší projekt oslovení a 5. pád? Když ne, zmizí z menu položka „Kontrola
   * oslovení": obrazovka, na kterou míří, je v tom případě také skrytá a odkaz
   * na skrytou obrazovku je mrtvé tlačítko.
   */
  greetingEnabled: boolean;
  /** Serverová akce se předává shora, aby klientský strom nesahal na `server-only`. */
  createWorkspace: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
};

/**
 * Skořápka projektu: topbar, boční menu, přepínač projektů a systémový pruh.
 * Obrazovky pod ní dodávají doménové plány, skořápka je pro ně jediná.
 *
 * VŠECHNA DATA CHODÍ SHORA, ze serverové části skořápky
 * (`app/[locale]/w/[workspaceSlug]/layout.tsx`). Tenhle soubor si nesmí
 * vymyslet ani jedno: dřív si seznam projektů, oprávnění i název projektu
 * držel sám jako zástupné hodnoty a výsledkem bylo, že přepínač nabízel jediný
 * projekt, v hlavičce svítil slug místo názvu a z menu chyběly položky, na
 * které uživatel oprávnění měl.
 */
export function WorkspaceShell({
  workspaces,
  currentWorkspaceId,
  permissions,
  user,
  greetingEnabled,
  createWorkspace,
  children,
}: WorkspaceShellProps) {
  const t = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);

  /**
   * Zabalení bočního menu si pamatuje prohlížeč.
   *
   * Server o té volbě neví, takže první vykreslení je vždycky ROZBALENÉ menu
   * a teprve po připojení se přepne. Kdyby si stav četl už první render,
   * server a klient by vykreslily jiné menu a React by hlásil nesoulad
   * hydratace, který sám neopraví.
   */
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed');
  }, []);

  /**
   * Úzké okno menu zabalí, ať si prohlížeč pamatuje cokoli.
   *
   * Uloženou volbu to NEPŘEPÍŠE: po zvětšení okna se menu vrátí do stavu, který
   * si uživatel vybral. Kdyby se `narrow` zapisovalo do `localStorage`, jedno
   * otevření na telefonu by zabalilo menu i na monitoru a uživatel by nevěděl proč.
   */
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(SIDEBAR_AUTO_COLLAPSE);
    const update = (event: MediaQueryList | MediaQueryListEvent) => setNarrow(event.matches);
    update(query);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  /**
   * Vysouvací menu na úzkém displeji.
   *
   * ZAVÍRÁ SE PŘI PŘECHODU NA JINOU STRÁNKU, jinak by po kliknutí na položku
   * zůstalo otevřené přes obsah, na který uživatel právě šel, a musel by ho
   * zavírat ručně. Řídí se to cestou, ne obsluhou kliknutí na odkaz: cesta se
   * změní i po tlačítku Zpět a po přesměrování ze serverové akce, kdežto
   * obsluha kliknutí ne.
   */
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  /**
   * Rozšíření okna nad 768 px panel zavře.
   *
   * Od té šířky stojí menu v rozvržení, takže by otevřený panel ukazoval TOTÉŽ
   * menu podruhé: dvě navigace se stejným popiskem vedle sebe, z toho jedna
   * v pasti na fokus. Stane se to jen při změně velikosti okna na počítači,
   * ale je to stav, do kterého se uživatel dostane omylem a sám z něj neví ven.
   */
  useEffect(() => {
    const query = window.matchMedia(NAV_DRAWER_LIMIT);
    const update = (event: MediaQueryList | MediaQueryListEvent) => {
      if (event.matches) setNavOpen(false);
    };
    update(query);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((previous) => {
      const next = !previous;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? 'collapsed' : 'expanded');
      return next;
    });
  };

  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const current = workspaces.find((workspace) => workspace.id === currentWorkspaceId);
  const workspaceSlug = current?.slug ?? '';
  const items = visibleNavigation({
    permissions: [...permissions],
    workspaceSlug,
    ...(greetingEnabled ? {} : { hiddenIds: ['contacts-greeting-queue'] }),
  });
  /**
   * Šířka hlavního sloupce se rozhoduje TADY, ve skořápce, ne na obrazovce.
   *
   * Obrazovka na to nedosáhne: `<main>` i jeho vnitřní okraj patří skořápce
   * a stránka se vykresluje až uvnitř něj. Kdyby si strop nastavovala sama,
   * musela by ho každá z dvanácti obrazovek nastavit znovu a jedna by se
   * spletla.
   *
   * ŠIROKÁ JE VÝCHOZÍ. Šest ze sedmi návrhů má hlavní sloupec 1560 px, jen
   * Přehled 1320. Tabulka kontaktů má deset sloupců a při 1320 px se e-maily
   * ořezávají třemi tečkami tam, kde se v návrhu vejdou celé.
   */
  const isOverview = pathname === `/w/${workspaceSlug}`;

  const systemBarStates: SystemBarState[] = offline
    ? [{ kind: 'offline', message: t('systemBar.offline') }]
    : [];

  /**
   * Providery montuje SKOŘÁPKA, ne jednotlivé domény.
   *
   * `useToast` mimo `ToastProvider` a `Tooltip` mimo `TooltipProvider` vyhodí
   * výjimku. Chyba v klientské komponentě přitom neshodí tu komponentu, ale
   * **celý strom po nejbližší error boundary**, takže uživatel místo obrazovky
   * uvidí „Aplikace se neočekávaně zastavila". Naměřeno na Přehledu: zapojení
   * jednoho panelu shodilo i dlaždice, které předtím fungovaly.
   *
   * Dokud to skořápka nedělala, obcházely to domény samy vlastními `layout.tsx`
   * (kontakty, seznamy, štítky, zablokované adresy) a nakonec i komponenty.
   * Šest míst, každé s poznámkou „až je skořápka dostane, tenhle soubor zmizí".
   * Sedmá obrazovka by spadla stejně a spadla by celá. Všech šest obcházek je
   * od 5. 8. 2026 pryč, tenhle soubor je jediné místo, kde se providery montují.
   *
   * ZPÁTKY UŽ JE NEPŘIDÁVEJ. Druhý `ToastProvider` v podstromu se nezdvojí
   * viditelně, ale založí si VLASTNÍ skladiště, takže strop tří viditelných
   * oznámení a slučování opakovaných hlášek přestane platit napříč obrazovkou:
   * uživateli se jich naskládá šest tam, kde měly být tři.
   *
   * Sedí tady, a ne v serverové části skořápky, protože `ToastProvider` bere
   * mezi popisky FUNKCE (odpočet, opakovaná hláška). Funkci ze serverové
   * komponenty do klientské předat nejde, takže providery musí montovat
   * komponenta, která je sama klientská.
   */
  /**
   * Menu se kreslí NA DVOU MÍSTECH: v rozvržení stránky (od 768 px výš)
   * a uvnitř vysouvacího panelu (pod 768 px). Položky, odkazy i popisky mají
   * být na obou místech stejné, proto je dodává jedna funkce. Kdyby se
   * `Sidebar` psalo dvakrát, jedna kopie by časem dostala položku navíc.
   */
  const renderNavigation = (options: {
    collapsed: boolean;
    className: string;
    onToggleCollapse?: (() => void) | undefined;
  }) => (
    <Sidebar
      items={items}
      currentPath={pathname}
      collapsed={options.collapsed}
      className={options.className}
      {...(options.onToggleCollapse ? { onToggleCollapse: options.onToggleCollapse } : {})}
      translate={(labelKey) => t(labelKey.replace(/^common\./, ''))}
      renderLink={({ href, label, active, children: linkChildren }) => (
        <Link key={href} href={href} aria-current={active ? 'page' : undefined} aria-label={label}>
          {linkChildren}
        </Link>
      )}
      labels={{
        mainNavigation: t('shell.mainNavigation'),
        collapse: t('shell.collapseSidebar'),
        expand: t('shell.expandSidebar'),
        toggleSection: (section: string) => t('shell.toggleSection', { section }),
      }}
    />
  );

  return (
    <ToastProvider
      labels={{
        undo: t('actions.undo'),
        close: t('actions.close'),
        notifications: t('a11y.notifications'),
        countdown: (seconds: number) => t('feedback.undoCountdown', { seconds }),
        repeated: (message: string, count: number) => t('feedback.repeated', { message, count }),
      }}
    >
      <TooltipProvider>
        <AppShell
          wide={!isOverview}
          topbar={
            <Topbar
              // Tlačítko hlavního menu jen pod 768 px. Nad tou šířkou stojí
              // menu v rozvržení a tlačítko by otevíralo panel s tímtéž
              // obsahem, který je vedle vidět.
              navToggle={
                <button
                  type="button"
                  onClick={() => setNavOpen(true)}
                  aria-label={t('shell.openNavigation')}
                  aria-expanded={navOpen}
                  className={cn(
                    'inline-flex size-[var(--size-target-min)] shrink-0 items-center justify-center md:hidden',
                    'rounded-[var(--radius-control)] text-text hover:bg-surface-muted',
                  )}
                >
                  <Menu aria-hidden className="icon-lg" />
                </button>
              }
              workspaceSwitcher={
                <WorkspaceSwitcher
                  workspaces={workspaces}
                  currentId={currentWorkspaceId}
                  onSwitch={(slug) => router.push(`/w/${slug}`)}
                  onCreate={() => setCreating(true)}
                  labels={{
                    switcher: t('shell.projectSwitcher'),
                    current: (name) => t('shell.currentProject', { name }),
                    create: t('shell.newProject'),
                  }}
                />
              }
              // Paletu příkazů a nápovědu napojí plán zkratek a plán nápovědy.
              // Do té doby se tlačítka NENABÍZEJÍ: prázdná funkce z nich dělala
              // atrapu, která po kliknutí neudělala nic. `Topbar` je proto bere
              // jako nepovinné a místo po nich se drží samo pořadím prvků.
              //
              // Odznak úloh naopak od 7. 8. 2026 zapojený JE a vede do Centra
              // úloh. Počet běžících si načte sám v prohlížeči, aby serverová
              // skořápka nepřidala sedmé volání na API do každé stránky.
              jobsBadge={
                workspaceSlug ? (
                  <JobsBadgeLive
                    workspaceId={currentWorkspaceId}
                    jobsHref={`/w/${workspaceSlug}/jobs`}
                  />
                ) : null
              }
              userMenu={<UserMenu user={user} workspaceSlug={workspaceSlug} />}
              labels={{
                search: t('shell.search'),
                help: t('shell.help'),
                skipToContent: t('shell.skipToContent'),
              }}
            />
          }
          sidebar={renderNavigation({
            collapsed: narrow || collapsed,
            // POD 768 px MENU V ROZVRŽENÍ NENÍ VŮBEC, ne jen zabalené. I zabalené
            // si bere 76 px z 375, tedy pětinu displeje, a hlavnímu sloupci pak
            // zbývá 269 px obsahu, do kterých se nevejdou tlačítka pruhu akcí
            // ani nadpis s e-mailem (naměřeno 7. 8. 2026 na Přehledu, Kontaktech
            // a v detailu kontaktu). `display: none` je tady správný nástroj:
            // menu je celé ve vysouvacím panelu níž, takže se navigace neztrácí.
            className: 'hidden md:block',
            // Na úzkém okně se tlačítko zabalení NENABÍZÍ. Menu je zabalené
            // z donucení, takže by kliknutí neudělalo nic viditelného,
            // a tlačítko bez následku je horší než chybějící tlačítko.
            // Zabalené menu má u každé položky popisek v bublině a druhou
            // úroveň ve vysouvacím panelu, takže se navigace neztrácí.
            ...(narrow ? {} : { onToggleCollapse: toggleCollapsed }),
          })}
          systemBarStates={systemBarStates}
        >
          {children}
        </AppShell>

        {/* Menu na úzkém displeji. Kreslí se ROZBALENÉ, s popisky: panel má
            plnou šířku menu, takže není důvod ukazovat samotné ikony, a na
            dotykovém displeji není kam najet myší pro bublinu s názvem. */}
        <NavDrawer
          open={navOpen}
          onOpenChange={setNavOpen}
          title={t('shell.mainNavigation')}
          closeLabel={t('shell.closeNavigation')}
        >
          {/* `top-0` je povinné. Obal menu má v rozvržení `sticky top-[70px]`,
              aby stálo pod hlavičkou; v panelu je `relative`, kde by týž `top`
              menu posunul o 70 px dolů a dole by o tolik přetekl. */}
          {renderNavigation({ collapsed: false, className: 'relative top-0 h-full w-full' })}
        </NavDrawer>
        <CreateWorkspaceDialog
          open={creating}
          onOpenChange={setCreating}
          action={createWorkspace}
        />
      </TooltipProvider>
    </ToastProvider>
  );
}
