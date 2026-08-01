'use client';

import { Link, usePathname, useRouter } from '@mlain/i18n/navigation';
import { workspaceAccent } from '@mlain/ui/lib/workspace-accent';
import { visibleNavigation } from '@mlain/ui/patterns/navigation';
import { AppShell, Sidebar, Topbar, WorkspaceSwitcher } from '@mlain/ui/patterns/shell';
import type { SystemBarState } from '@mlain/ui/patterns/shell';
import { useTheme } from '@mlain/ui/theme';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * Skořápka projektu: topbar, boční menu, přepínač projektů a systémový pruh.
 * Obrazovky pod ní dodávají doménové plány, skořápka je pro ně jediná.
 *
 * Relace, oprávnění a seznam projektů dodá vrstva identity (plán jádra API).
 * Do té doby drží skořápka hodnoty níž, aby se dala spustit a proklikat.
 */
const PLACEHOLDER_PERMISSIONS = [
  'contacts:read',
  'contacts:write',
  'campaigns:read',
  'templates:read',
  'reports:read',
  'api_keys:read',
  'webhooks:read',
  'audit:read',
  'members:invite',
  'workspace:update',
];

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ workspaceSlug: string }>();
  const { resolved } = useTheme();
  const workspaceSlug = params.workspaceSlug;

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

  // Identifikátor projektu zatím není načtený, barva se proto odvozuje ze
  // slugu. Jakmile skořápka dostane relaci, dosadí se `workspace_id`.
  const workspace = { id: workspaceSlug, slug: workspaceSlug, name: workspaceSlug };
  const items = visibleNavigation({ permissions: PLACEHOLDER_PERMISSIONS, workspaceSlug });
  const accent = workspaceAccent(workspace.id);
  const systemBarStates: SystemBarState[] = offline
    ? [{ kind: 'offline', message: t('systemBar.offline') }]
    : [];

  return (
    <AppShell
      topbar={
        <Topbar
          workspaceSwitcher={
            <WorkspaceSwitcher
              workspaces={[workspace]}
              currentId={workspace.id}
              theme={resolved}
              onSwitch={(slug) => router.push(`/w/${slug}`)}
              labels={{
                switcher: t('shell.projectSwitcher'),
                current: (name) => t('shell.currentProject', { name }),
              }}
            />
          }
          // Paletu příkazů a nápovědu napojí plán zkratek a plán nápovědy,
          // skořápka pro ně drží místo na stejné pozici na všech stránkách.
          onOpenSearch={() => {}}
          onOpenHelp={() => {}}
          jobsBadge={null}
          userMenu={null}
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
  );
}
