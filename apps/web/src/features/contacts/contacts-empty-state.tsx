'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
// S1 a S2 z katalogu stavů 7.1 části 6. Komponenty vlastní P05.
import { EmptyState, FilteredEmptyState } from '@mlain/ui/patterns/states';
import { useFilterChips } from './filter-chips';
import { contactsHref, type ContactListFilters, type FilterNames } from './filters';

/**
 * Prázdný stav S1. Struktura je normativní: vysvětlení pojmu, primární akce, sekundární
 * cesty. Znění je od chvíle, kdy je v katalogu, zdrojem pravdy katalog, ne specifikace.
 *
 * ODCHYLKA OD PLÁNU: `EmptyState` z P05 bere akce jako `{ label, onClick, description }[]`,
 * ne jako odkazy v children. Tři cesty ven jsou proto tlačítka, která navigují routerem,
 * a jejich vysvětlující věty jdou do `description` téže akce, ne do samostatného seznamu.
 */
export function ContactsEmptyState({
  basePath,
  workspaceId,
}: {
  basePath: string;
  /** Bez něj vrací `POST /api/v1/demo-data` 404, viz `lib/api/authenticate.ts`. */
  workspaceId: string;
}) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const workspacePath = basePath.replace(/\/contacts$/, '');

  /**
   * Čtvrtá cesta ven: ukázková data.
   *
   * Katalog pro ni měl znění (`contacts.list.emptySample`) od začátku, ale
   * NIKDO ho nepoužíval: `grep -rn "emptySample" apps/web/src` nevracelo nic.
   * Nahrát ukázková data tedy z rozhraní nešlo vůbec, přestože
   * `POST /api/v1/demo-data` existuje a dialog o jejich odstranění uživateli
   * slibuje „Ukázková data si můžete kdykoli nahrát znovu."
   *
   * Banner na přehledu to neřešil: ten se vykresluje jedině tehdy, když už
   * ukázková data v projektu JSOU (`if (!state.present) return null`), takže
   * uměl jen odstranit, ne nahrát.
   */
  async function loadDemoData() {
    const response = await fetch('/api/v1/demo-data', {
      method: 'POST',
      headers: { 'X-Workspace-Id': workspaceId },
    });
    if (response.ok) router.refresh();
  }

  return (
    <EmptyState
      variant="first"
      title={t('list.emptyTitle')}
      explanation={t('list.emptyBody')}
      hint={t('list.emptyHowTo')}
      actions={[
        {
          label: t('list.emptyAction'),
          onClick: () => router.push(`${basePath}/import`),
          description: t('list.emptyImportHint'),
        },
        {
          label: t('list.emptyFormAction'),
          onClick: () => router.push(`${workspacePath}/forms/new`),
          description: t('list.emptyFormHint'),
        },
        {
          label: t('list.emptyManualAction'),
          onClick: () => router.push(`${basePath}/new`),
          description: t('list.emptyManualHint'),
        },
        {
          label: t('list.emptySample'),
          onClick: () => void loadDemoData(),
          description: t('list.emptySampleHint'),
        },
      ]}
    />
  );
}

/**
 * Prázdný stav S2. Filtr se vypisuje slovy, protože uživatel často nevidí, že má
 * zapnuté hledání z minula. Nabízí se dvě různá zrušení: celý filtr a jen hledání.
 */
export function ContactsFilteredEmptyState({
  basePath,
  filters,
  names,
}: {
  basePath: string;
  filters: ContactListFilters;
  names: FilterNames;
}) {
  const t = useTranslations('contacts');
  const format = useFormatter();
  const router = useRouter();
  const chips = useFilterChips()(filters, names);

  const withoutSearch: ContactListFilters = { ...filters };
  delete withoutSearch.q;

  return (
    <FilteredEmptyState
      title={t('list.filteredTitle')}
      explanation={t('list.filteredTip')}
      filterDescription={t('list.filteredFilter', { filter: format.list(chips) })}
      clearFiltersLabel={t('list.filteredClearAll')}
      onClearFilters={() => router.push(contactsHref(basePath, {}))}
      actions={
        filters.q
          ? [
              {
                label: t('list.filteredClearSearch'),
                onClick: () => router.push(contactsHref(basePath, withoutSearch)),
              },
            ]
          : []
      }
    />
  );
}
