'use client';

import { cn } from '../../lib/cn';
import type { VisibleNavigationItem } from '../navigation/visible-navigation';

/**
 * Boční menu. Sbalitelné na ikony, stav sbalení se pamatuje na uživatele.
 * Barevný proužek projektu se propíše do levého okraje, aby bylo poznat
 * na první pohled, kde uživatel je.
 */
export function Sidebar({
  items,
  currentPath,
  collapsed,
  accentColor,
  translate,
  renderLink,
  labels,
}: {
  items: VisibleNavigationItem[];
  currentPath: string;
  collapsed: boolean;
  accentColor: string;
  translate: (labelKey: string) => string;
  /** Odkaz dodává aplikace, aby `packages/ui` nezáviselo na routeru. */
  renderLink: (input: {
    href: string;
    label: string;
    active: boolean;
    children: React.ReactNode;
  }) => React.ReactNode;
  labels: { mainNavigation: string };
}) {
  return (
    <nav
      aria-label={labels.mainNavigation}
      style={{ borderLeftColor: accentColor }}
      className={cn(
        'flex shrink-0 flex-col gap-1 overflow-y-auto border-l-4 border-r border-r-border bg-surface p-2',
        collapsed ? 'w-[var(--size-sidebar-collapsed)]' : 'w-[var(--size-sidebar)]',
      )}
    >
      {items.map((section) => {
        const label = translate(section.labelKey);
        const active = currentPath === section.href || currentPath.startsWith(`${section.href}/`);
        return (
          <div key={section.id}>
            {renderLink({
              href: section.href,
              label,
              active,
              children: (
                <span
                  className={cn(
                    'flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm',
                    active ? 'bg-accent-surface font-medium text-accent-text' : 'text-text',
                  )}
                >
                  {collapsed ? label.slice(0, 1) : label}
                </span>
              ),
            })}
            {!collapsed && active && section.children ? (
              <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
                {section.children.map((child) =>
                  renderLink({
                    href: child.href,
                    label: translate(child.labelKey),
                    active: currentPath === child.href,
                    children: (
                      <span
                        className={cn(
                          'flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm',
                          currentPath === child.href ? 'text-accent-text' : 'text-text-muted',
                        )}
                      >
                        {translate(child.labelKey)}
                      </span>
                    ),
                  }),
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
