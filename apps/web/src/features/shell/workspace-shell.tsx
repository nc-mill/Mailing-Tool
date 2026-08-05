'use client';

import { Link, usePathname, useRouter } from '@mlain/i18n/navigation';
import { workspaceAccent } from '@mlain/ui/lib/workspace-accent';
import { visibleNavigation } from '@mlain/ui/patterns/navigation';
import { AppShell, Sidebar, Topbar, WorkspaceSwitcher } from '@mlain/ui/patterns/shell';
import type { SystemBarState, WorkspaceSummary } from '@mlain/ui/patterns/shell';
import { TooltipProvider } from '@mlain/ui/components/tooltip';
import { ToastProvider } from '@mlain/ui/patterns/toast';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import type { ActionState } from '@/lib/feedback/action-result';
import { CreateWorkspaceDialog } from './create-workspace-dialog';
import { UserMenu } from './user-menu';

export type WorkspaceShellProps = {
  /** Všechny projekty přihlášeného, ne jen ten otevřený. */
  workspaces: WorkspaceSummary[];
  currentWorkspaceId: string;
  /** Skutečná oprávnění role aktéra, spočítaná na serveru. Klient matici nezná. */
  permissions: readonly string[];
  user: { name: string; email: string };
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
  createWorkspace,
  children,
}: WorkspaceShellProps) {
  const t = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);

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
  const items = visibleNavigation({ permissions: [...permissions], workspaceSlug });
  const accent = workspaceAccent(currentWorkspaceId);
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
   * Sedmá obrazovka by spadla stejně a spadla by celá.
   *
   * Vnořené providery nevadí, ty obcházky můžou zmizet postupně.
   *
   * Sedí tady, a ne v serverové části skořápky, protože `ToastProvider` bere
   * mezi popisky FUNKCE (odpočet, opakovaná hláška). Funkci ze serverové
   * komponenty do klientské předat nejde, takže providery musí montovat
   * komponenta, která je sama klientská.
   */
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
          topbar={
            <Topbar
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
              jobsBadge={null}
              userMenu={<UserMenu user={user} />}
              labels={{
                search: t('shell.search'),
                help: t('shell.help'),
                skipToContent: t('shell.skipToContent'),
              }}
            />
          }
          sidebar={
            <Sidebar
              items={items}
              currentPath={pathname}
              collapsed={false}
              accentColor={accent}
              translate={(labelKey) => t(labelKey.replace(/^common\./, ''))}
              renderLink={({ href, label, active, children: linkChildren }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  aria-label={label}
                >
                  {linkChildren}
                </Link>
              )}
              labels={{ mainNavigation: t('shell.mainNavigation') }}
            />
          }
          systemBarStates={systemBarStates}
        >
          {children}
        </AppShell>
        <CreateWorkspaceDialog
          open={creating}
          onOpenChange={setCreating}
          action={createWorkspace}
        />
      </TooltipProvider>
    </ToastProvider>
  );
}
