import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { FormEditor } from '@/features/forms/form-editor';
import type {
  ContactFieldOption,
  FormView,
  ListOption,
  TemplateOption,
} from '@/features/forms/types';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string; id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('forms.title') };
}

export default async function FormDetailPage({ params }: PageProps) {
  const { workspaceSlug, id } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  const [form, lists, templates, pages, contactFields] = await Promise.all([
    apiFetch<{ data: FormView }>(`/api/v1/forms/${id}`, { workspaceId }),
    apiFetch<{ data: ListOption[] }>('/api/v1/lists', { workspaceId }),
    /*
     * Nabídka e-mailů, které jde formuláři přiřadit.
     *
     * Výpis šablon vrací `items`, NE `data`. Doména šablon má vlastní tvar odpovědi
     * (`items`, `next_cursor`, `counts`) a čtení `data` tu tiše vracelo prázdno:
     * nabídka byla vždycky prázdná a nastavený e-mail se v ní neukázal, i když
     * v databázi byl. Naměřeno v prohlížeči.
     *
     * `view=summary` vynechá dokument `design`, který je největší sloupec tabulky
     * a do nabídky k ničemu.
     */
    /*
     * `limit` je 100, protože VÍC TA TRASA NEDOVOLÍ. Schéma výpisu šablon má
     * `max(100)` (`templates.routes.ts`), takže požadavek na 200 skončil na 422
     * `validation_failed` a stránka dostala `items: null`. Navenek to vypadalo
     * úplně stejně jako prázdná knihovna: nabídka e-mailu u formuláře byla
     * prázdná i tehdy, když v ní připojená šablona byla, a po přejmenování se
     * nový název „neprojevil", protože se nezobrazovala vůbec žádná položka.
     * Naměřeno proti běžící aplikaci: `limit=200` vrátí 422, `limit=100` vrátí
     * osm položek.
     *
     * Strop trasy se kvůli tomu nezvedal schválně. Sto šablon je rozumná mez
     * pro rozbalovací nabídku a projekt s víc šablonami potřebuje hledání, ne
     * delší seznam.
     */
    apiFetch<{ items: (TemplateOption & { category?: string })[] }>('/api/v1/templates', {
      workspaceId,
      searchParams: { limit: 100, view: 'summary' },
    }),
    /*
     * Knihovna veřejných stránek, tedy šablony druhu `page`.
     *
     * VLASTNÍ POŽADAVEK, ne filtr nad předchozím výpisem. Je to sice zúžení
     * téhož výpisu, ale zúžení na serveru: nabídka stránek se tím nemůže
     * rozejít s tím, co jádro za stránku považuje.
     */
    apiFetch<{ items: TemplateOption[] }>('/api/v1/templates', {
      workspaceId,
      searchParams: { limit: 100, view: 'summary', kind: 'page' },
    }),
    // Katalog vlastních polí kontaktu. Stavitel z něj nabízí cíle a nová pole
    // se do něj zakládají rovnou z formuláře.
    apiFetch<{ data: ContactFieldOption[] }>('/api/v1/contact-fields', { workspaceId }),
  ]);

  if (!form.ok) {
    if (form.problem.status === 404) notFound();
    return <ContactsProblem problem={form.problem} />;
  }

  return (
    <FormEditor
      form={form.data.data}
      lists={lists.ok ? lists.data.data : []}
      // Selhání výpisu šablon obrazovku neshodí: nastavení formuláře má smysl
      // i bez nabídky e-mailů, jen v ní nepůjde jiný vybrat.
      /*
       * VEŘEJNÉ STRÁNKY SE Z NABÍDKY E-MAILU VYŘAZUJÍ TADY, u volajícího.
       *
       * Do 7. 8. 2026 je schovával výchozí výpis šablon, což chránilo tuhle
       * nabídku, ale zároveň způsobilo, že se nově založená stránka vůbec
       * neobjevila v knihovně a nešla najít ani smazat. Skrývat celou kategorii
       * všem kvůli jedné nabídce byla špatná výměna; kdo potřebuje zúžení, řekne
       * si o něj sám, a je to vidět na místě, kde na tom záleží.
       */
      templates={
        templates.ok ? templates.data.items.filter((item) => item.category !== 'page') : []
      }
      pages={pages.ok ? pages.data.items : []}
      contactFields={
        contactFields.ok
          ? contactFields.data.data.filter((field) => field.archived_at === null)
          : []
      }
      workspaceId={workspaceId}
      workspaceSlug={workspaceSlug}
      basePath={`/w/${workspaceSlug}/forms`}
      canEdit={access.data.permissions.includes('contacts:write')}
    />
  );
}
