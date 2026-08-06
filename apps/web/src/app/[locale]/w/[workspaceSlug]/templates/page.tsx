import { notFound } from 'next/navigation';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Alert } from '@mlain/ui/patterns/states';
import { getTranslations } from 'next-intl/server';
import { TemplateLibrary, type TemplateListItem } from '@/features/templates/template-library';
import { apiFetch } from '@/lib/api-client/fetch';
import { requireUser } from '@/lib/identity/require-user';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';
import { CategoryFilter, readCategory, type TemplateCategoryCounts } from './category-filter';
import { CreateTemplateButton, TemplatesEmpty } from './create-template';

/**
 * Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ.
 *
 * Bez tohohle ji Next při `next build` vykreslí a spadne, protože v době
 * sestavení žádná relace neexistuje:
 *
 *   TypeError: Cannot read properties of null (reading 'useContext')
 *   Export encountered an error on <cesta>, exiting the build.
 *
 * Chyba nemíří na příčinu, takže se hledá v komponentách. Statická podoba
 * téhle stránky přitom neexistuje: obsah je pro každého jiný.
 */
export const dynamic = 'force-dynamic';

/** Minimální seznam šablon (rozhodnutí R16): bez něj se do editoru nedá prokliknout. */
export default async function TemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
  /**
   * `undo` a `undo_name` sem přivádí detail šablony po smazání. Nabídka vrácení
   * zpět tak přežije odchod z editoru; bez nich by uživatel skončil v seznamu
   * bez cesty zpátky, kterou mu potvrzovací okno slíbilo.
   *
   * `category` drží zvolený filtr knihovny. Je v adrese, ne ve stavu
   * komponenty, aby fungovalo tlačítko zpět a dal se poslat odkaz.
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const t = await getTranslations('editor');

  const me = await requireUser(`/w/${workspaceSlug}/templates`);
  if (!me.ok) notFound();
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();

  /*
   * KNIHOVNA UKAZUJE JEN SKUTEČNÉ ŠABLONY.
   *
   * Čte se přes `GET /api/v1/templates`, ne přímým dotazem do tabulky.
   * Ten dotaz totiž vypisoval VŠECHNY řádky `templates`, včetně pracovních
   * obsahů kampaní (`kind = 'system'`), které si vyrábí aplikace, aby měl
   * editor co upravovat. Uživatel je v knihovně nechtěl a měl pravdu:
   * nezaložil je a samostatně nic neznamenají.
   *
   * Vyloučení nedělá tahle obrazovka, dělá ho jádro v jediné podmínce obou
   * výpisů šablon. Filtr rozprostřený po obrazovkách stačí v jedné vynechat
   * a pomocné řádky jsou zpátky.
   *
   * `view=summary` vynechá `design`, což je zdaleka největší sloupec tabulky
   * a do seznamu odkazů není k ničemu. Odpověď šablon má tvar
   * `{ items, next_cursor }`, NE `{ data }` jako zbytek API; čtení `data.data`
   * by tu vrátilo `undefined` a knihovna by byla prázdná, aniž by co spadlo.
   */
  const category = readCategory(query.category);
  const response = await apiFetch<{
    items: TemplateListItem[];
    counts: TemplateCategoryCounts;
  }>('/api/v1/templates', {
    workspaceId: access.data.workspace.id,
    searchParams: { view: 'summary', ...(category === undefined ? {} : { category }) },
  });
  // Výpadek seznamu obrazovku neshodí, ale ani se netváří jako prázdná knihovna:
  // věta „Zatím nemáte žádnou šablonu" by u nedostupného API byla lež.
  const templates = response.ok ? response.data.items : [];
  const counts: TemplateCategoryCounts = response.ok
    ? response.data.counts
    : { all: 0, campaign: 0, form: 0, transactional: 0 };

  const undoId = typeof query.undo === 'string' ? query.undo : undefined;
  const undoName = typeof query.undo_name === 'string' ? query.undo_name : undefined;
  const deleted = undoId && undoName ? { id: undoId, name: undoName } : undefined;

  const basePath = `/w/${workspaceSlug}/templates`;
  /*
   * Prázdná knihovna se pozná z CELKOVÉHO počtu, ne z délky stránky. Kdyby se
   * poznávala z délky, vypadala by prázdně i knihovna se čtyřmi šablonami,
   * v jejíž zvolené kategorii žádná není, a nabídka „založte první šablonu"
   * by uživateli tvrdila, že o svoje šablony přišel.
   */
  const firstRun = response.ok && counts.all === 0 && deleted === undefined;

  /*
   * Vnitřní okraj stránky ani strop šířky si obrazovka nenastavuje: obojí
   * dodává skořápka (`AppShell`, 40 px). Dřívější `p-6` se s ním sčítalo,
   * takže knihovna začínala o 24 px jinde než ostatní obrazovky.
   *
   * Rytmus je stejný jako u výpisu kampaní a segmentů: hlavička s názvem,
   * mono řádkem a akcemi, pod ní filtr, pod ním jedna karta s obsahem.
   */
  return (
    <>
      <PageHeader
        title={t('list.title')}
        meta={t('list.countAll', { count: counts.all })}
        actions={
          firstRun ? null : (
            <CreateTemplateButton
              workspaceSlug={workspaceSlug}
              workspaceId={access.data.workspace.id}
            />
          )
        }
      />
      {response.ok ? null : (
        <Alert
          tone="error"
          className="mb-[var(--spacing-gutter)]"
          title={t('list.loadFailed')}
          data-testid="templates-load-failed"
        />
      )}
      {firstRun ? (
        <TemplatesEmpty workspaceSlug={workspaceSlug} workspaceId={access.data.workspace.id} />
      ) : (
        <div className="flex min-w-0 flex-col gap-[var(--spacing-gutter)]">
          <CategoryFilter basePath={basePath} active={category} counts={counts} />
          {/*
            Prázdná knihovna se nabídkou vrácení zpět NEPŘEBIJE: kdo právě smazal
            poslední šablonu, potřebuje hlavně cestu zpátky, ne pobídku založit
            novou. Proto se pruh a seznam vykreslí i s nulou položek.
          */}
          <TemplateLibrary
            workspaceSlug={workspaceSlug}
            workspaceId={access.data.workspace.id}
            templates={templates}
            canWrite={hasPermission(access.data, 'templates:write')}
            initialDeleted={deleted}
            {...(category === undefined ? {} : { category })}
          />
        </div>
      )}
    </>
  );
}
